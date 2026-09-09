import {
  KotasApiError,
  KotasAuthError,
  KotasHttpError,
  RateLimitError,
  STATUS_HINTS,
} from "./errors.js";
import type { Logger } from "./logger.js";
import { isExpired } from "../session/jwt.js";
import type { SessionData, SessionStore } from "../session/store.js";

// The single funnel to the Kotas API. It exists to enforce, in ONE place:
//   - strictly serial requests, so concurrent tool calls never overlap;
//   - a minimum gap plus random jitter between requests (the terms of use ask
//     for human-like volume, so this is politeness, not just safety);
//   - exponential backoff on transient failures (network, 429, 5xx);
//   - the token lifecycle: the access token lives 15 minutes, so it is
//     refreshed proactively before it expires and reactively on a 401.
// It knows nothing about endpoints — that lives in src/kotas/api.ts. Every
// temporal collaborator (fetch, sleep, now, random) is injectable so the tests
// are deterministic without fake timers.

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
export const MAX_ATTEMPTS = 4;
/** Path of the refresh endpoint, relative to the base URL. */
export const REFRESH_PATH = "autenticacao/refresh-token";

export const backoffMs = (attempt: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);

const isTransient = (status: number): boolean => status === 429 || status >= 500;

export type QueryValue = string | number | boolean | undefined | null;

export type HttpRequest = {
  method: "GET" | "POST" | "PUT";
  /** Relative to the base URL, without a leading slash. */
  path: string;
  query?: Record<string, QueryValue>;
  /** Serialized as JSON when present. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Short label for logs. Never an id: log lines must not identify the account. */
  label?: string;
  /** `none` skips the Authorization header entirely (login, version probe). */
  auth?: "session" | "none";
};

export type HttpResponse = { status: number; headers: Headers; text: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpState = {
  authDead: boolean;
  requests: number;
  refreshes: number;
  lastRequestAt: number | null;
};

export type Http = {
  /** Runs `fn` with no other request in flight. Used by multi-step reads. */
  serial<T>(fn: () => Promise<T>): Promise<T>;
  send(request: HttpRequest): Promise<HttpResponse>;
  /** JSON GET. Throws {@link KotasApiError} on a business error. */
  get<T>(path: string, query?: Record<string, QueryValue>, label?: string): Promise<T>;
  /** JSON POST. */
  post<T>(path: string, body?: unknown, options?: Partial<HttpRequest>): Promise<T>;
  /** Persists a session captured elsewhere (login, browser import) and clears the dead flag. */
  adopt(data: SessionData): void;
  resetSession(): void;
  markAuthDead(message: string): never;
  state(): HttpState;
};

export type HttpOptions = {
  session: SessionStore;
  baseUrl: string;
  apiToken: string;
  appVersion: string;
  minIntervalMs: number;
  jitterMs: number;
  timeoutMs: number;
  log: Logger;
};

export type HttpDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

export function createHttp(opts: HttpOptions, deps: HttpDeps = {}): Http {
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const { session, log } = opts;

  let jar: SessionData | null = null;
  let loadedMtime: number | null = null;
  let authDead = false;
  let requests = 0;
  let refreshes = 0;
  let lastRequestAt: number | null = null;
  /** The single in-flight refresh, so N waiting calls trigger exactly one. */
  let refreshing: Promise<SessionData> | null = null;

  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  function markAuthDead(message: string): never {
    authDead = true;
    throw new KotasAuthError(message);
  }

  /**
   * Loads the session lazily and reloads it after the user ran `kotas login` in
   * another terminal (the file changed under us) — no MCP restart needed.
   */
  function ensureSession(): SessionData {
    const mtime = session.mtimeMs();
    if (jar === null || (authDead && mtime !== loadedMtime)) {
      jar = session.load();
      loadedMtime = mtime;
      authDead = false;
    }
    if (jar === null) markAuthDead("Nenhuma sessão do Kotas salva.");
    if (authDead) markAuthDead("A sessão do Kotas expirou ou foi recusada.");
    return jar;
  }

  async function gap(): Promise<void> {
    const earliest = (lastRequestAt ?? 0) + opts.minIntervalMs + random() * opts.jitterMs;
    const wait = earliest - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
  }

  function url(request: HttpRequest): string {
    const target = new URL(request.path.replace(/^\/+/, ""), `${opts.baseUrl}/`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
    return target.toString();
  }

  /**
   * The four headers the API demands on every call (spec §2.1). `token` is the
   * front-end's static API key, not a user secret; `hashDispositivo` is the
   * device identity and must never change between requests.
   */
  function headersFor(request: HttpRequest, current: SessionData | null): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      token: opts.apiToken,
      versao: opts.appVersion,
      hashDispositivo: current?.hashDispositivo ?? "",
      ...(current && request.auth !== "none"
        ? { authorization: `Bearer ${current.accessToken}` }
        : {}),
      ...request.headers,
    };
  }

  /** One network round-trip, outside the serial chain so a refresh can nest. */
  async function dispatch(
    request: HttpRequest,
    current: SessionData | null,
  ): Promise<HttpResponse> {
    const label = request.label ?? request.path;
    const target = url(request);
    const started = now();

    for (let attempt = 1; ; attempt += 1) {
      await gap();
      let response: Response;
      try {
        response = await doFetch(target, {
          method: request.method,
          headers: headersFor(request, current),
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          redirect: "manual",
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (error) {
        requests += 1;
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt < MAX_ATTEMPTS) {
          log.warn(`${label} network error on attempt ${attempt}: ${reason}`);
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new KotasHttpError(0, `Falha de rede ao chamar o Kotas em ${label}: ${reason}`);
      }
      requests += 1;

      if (isTransient(response.status) && attempt < MAX_ATTEMPTS) {
        log.warn(`${label} HTTP ${response.status} on attempt ${attempt}; backing off`);
        await sleep(backoffMs(attempt));
        continue;
      }
      if (isTransient(response.status)) {
        throw new RateLimitError(
          attempt,
          `O Kotas respondeu HTTP ${response.status} em ${label} após ${attempt} tentativas. Espere alguns minutos.`,
        );
      }

      // Never log headers (the Authorization header is the account) and never
      // log the full URL (query strings carry ids).
      log.debug(`${label} ${response.status} ${now() - started}ms`);
      return { status: response.status, headers: response.headers, text: await response.text() };
    }
  }

  /**
   * Exchanges the refresh token for a new access token. The response body is
   * the raw JWT *string*, not an object, and the refresh token itself is not
   * rotated — it stays valid for the next refresh (spec §2.4).
   */
  async function doRefresh(current: SessionData): Promise<SessionData> {
    const response = await dispatch(
      {
        method: "POST",
        path: REFRESH_PATH,
        // The endpoint is the one place that wants this extra header.
        headers: { role: "refresh-token" },
        body: { token: current.accessToken, refreshToken: current.refreshToken },
        label: "autenticacao/refresh-token",
      },
      current,
    );
    if (response.status !== 200) {
      markAuthDead(`O Kotas recusou o refresh token (HTTP ${response.status}).`);
    }
    const token = parseRefreshBody(response.text);
    if (!token) markAuthDead("O refresh do Kotas devolveu um corpo que não é um token.");
    refreshes += 1;
    const next: SessionData = { ...current, accessToken: token, savedAt: now() };
    session.save(next);
    jar = next;
    loadedMtime = session.mtimeMs();
    log.debug("access token refreshed");
    return next;
  }

  /** Deduplicates concurrent refreshes onto one promise, like the front does. */
  function refresh(current: SessionData): Promise<SessionData> {
    if (!refreshing) {
      refreshing = doRefresh(current).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  /** Refreshes before the request when the token is expired or about to be. */
  async function ensureToken(): Promise<SessionData> {
    const current = ensureSession();
    if (!isExpired(current.accessToken, now())) return current;
    return refresh(current);
  }

  async function send(request: HttpRequest): Promise<HttpResponse> {
    if (request.auth === "none") return serial(() => dispatch(request, jar));
    return serial(async () => {
      let current = await ensureToken();
      let response = await dispatch(request, current);
      if (response.status === 401) {
        // Not a transient failure: refresh and replay once, with no backoff.
        // A second 401 means the refresh token is gone too.
        current = await refresh(current);
        response = await dispatch(request, current);
        if (response.status === 401) {
          markAuthDead("O Kotas recusou a sessão mesmo depois de renovar o token.");
        }
      }
      return response;
    });
  }

  async function json<T>(request: HttpRequest): Promise<T> {
    const label = request.label ?? request.path;
    const response = await send(request);
    const parsed = parseJson(response.text);
    if (response.status >= 400) {
      throw new KotasApiError(
        response.status,
        messageOf(parsed) ?? response.text.slice(0, 200),
        label,
        STATUS_HINTS[response.status],
        parsed,
      );
    }
    return parsed as T;
  }

  return {
    serial,
    send,
    get: <T,>(path: string, query?: Record<string, QueryValue>, label?: string) =>
      json<T>({ method: "GET", path, ...(query ? { query } : {}), label: label ?? path }),
    post: <T,>(path: string, body?: unknown, options: Partial<HttpRequest> = {}) =>
      json<T>({ method: "POST", path, body, label: path, ...options }),
    adopt(data) {
      jar = data;
      loadedMtime = session.mtimeMs();
      authDead = false;
    },
    resetSession() {
      jar = null;
      loadedMtime = null;
      authDead = false;
    },
    markAuthDead,
    state: () => ({ authDead, requests, refreshes, lastRequestAt }),
  };
}

/**
 * The refresh endpoint answers with the JWT as a bare JSON string. Accepts the
 * object shape too, in case the API ever normalizes it.
 */
export function parseRefreshBody(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = parseJson(trimmed);
  if (typeof parsed === "string") return parsed.trim() || null;
  if (parsed && typeof parsed === "object") {
    const token = (parsed as { token?: unknown }).token;
    if (typeof token === "string" && token !== "") return token;
    return null;
  }
  // Not JSON at all: some proxies hand the token back unquoted.
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(trimmed) ? trimmed : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function messageOf(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === "object") {
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return undefined;
}

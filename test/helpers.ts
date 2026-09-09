import { Database } from "bun:sqlite";
import { migrate } from "../src/cache/db.js";
import { loadConfig, type Config } from "../src/config.js";
import { createContext, type ContextDeps, type Ctx } from "../src/context.js";
import type { Logger } from "../src/core/logger.js";
import { createMemorySessionStore, type SessionData } from "../src/session/store.js";

// The seam kit: plain typed objects, nothing global patched. A test that needs
// a clock, a network or a database gets a fake one through `createContext`.

/**
 * Fake clock: `sleep` records the duration and advances time instead of
 * waiting, so pacing and backoff are asserted in microseconds.
 */
export function fakeClock(start = 1_757_000_000_000) {
  let current = start;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      slept.push(ms);
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
    slept,
  };
}

export const silentLogger = (): Logger => ({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

/** A syntactically real JWT. The signature is never verified by this project. */
export function jwt(claims: Record<string, unknown>, expSecondsFromNow = 900, now = 1_757_000_000_000): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(now / 1000);
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ iat, exp: iat + expSecondsFromNow, ...claims }),
    "c2lnbmF0dXJl",
  ].join(".");
}

export function sessionData(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: 1,
    accessToken: jwt({ TX_EMAIL_USUARIO: "conta@exemplo.com", ID_USUARIO: "u-1" }),
    refreshToken: "refresh-token-opaco-0123456789",
    hashDispositivo: "a".repeat(32),
    email: "conta@exemplo.com",
    savedAt: 1_757_000_000_000,
    ...overrides,
  };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export type ScriptedCall = { url: string; init: RequestInit };

/**
 * A fetch made of a queue of handlers. Records every call so a test can assert
 * on the headers and on the ORDER, which is what proves the funnel is serial.
 */
export function scriptedFetch(
  handlers: Array<(call: ScriptedCall) => Response | Promise<Response>>,
) {
  const calls: ScriptedCall[] = [];
  let index = 0;
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const call = { url, init };
    calls.push(call);
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    if (!handler) throw new Error(`scriptedFetch: no handler for call ${index}`);
    return handler(call);
  };
  return { fetch: fetchImpl, calls, get count() {
    return calls.length;
  } };
}

export const headerOf = (call: ScriptedCall, name: string): string | undefined =>
  (call.init.headers as Record<string, string> | undefined)?.[name];

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      KOTAS_CONFIG_DIR: "/tmp/kotas-mcp-tests-does-not-exist",
      KOTAS_BASE_URL: "https://api.test.invalid",
      // No pacing in tests: the fake clock would otherwise record every gap.
      KOTAS_MIN_INTERVAL_MS: "0",
      KOTAS_JITTER_MS: "0",
    }),
    ...overrides,
  };
}

/** A context wired to an in-memory database and a memory session. */
export function testContext(
  deps: ContextDeps = {},
  configOverrides: Partial<Config> = {},
): Ctx {
  const db = deps.db ?? new Database(":memory:");
  if (!deps.db) {
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db);
  }
  return createContext(testConfig(configOverrides), {
    db,
    session: deps.session ?? createMemorySessionStore(sessionData()),
    log: deps.log ?? silentLogger(),
    sleep: deps.sleep ?? (async () => undefined),
    now: deps.now ?? (() => 1_757_000_000_000),
    random: deps.random ?? (() => 0),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

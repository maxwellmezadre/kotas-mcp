import { describe, expect, test } from "bun:test";
import { backoffMs, createHttp, MAX_ATTEMPTS, parseRefreshBody } from "../src/core/http.js";
import { KotasApiError, KotasAuthError, RateLimitError } from "../src/core/errors.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { fakeClock, headerOf, jsonResponse, jwt, scriptedFetch, sessionData, silentLogger } from "./helpers.js";

const NOW = 1_757_000_000_000;
const BASE = "https://api.test.invalid";

function make(
  handlers: Parameters<typeof scriptedFetch>[0],
  session = createMemorySessionStore(sessionData()),
  clock = fakeClock(NOW),
) {
  const net = scriptedFetch(handlers);
  const http = createHttp(
    {
      session,
      baseUrl: BASE,
      apiToken: "chave-estatica-do-front",
      appVersion: "1.127.0.0",
      minIntervalMs: 0,
      jitterMs: 0,
      timeoutMs: 1000,
      log: silentLogger(),
    },
    { fetch: net.fetch, sleep: clock.sleep, now: clock.now, random: () => 0 },
  );
  return { http, net, session, clock };
}

describe("http headers", () => {
  test("sends the four headers the API demands, on every call", async () => {
    const { http, net } = make([() => jsonResponse({ ok: true })]);
    await http.get("credito");
    const call = net.calls[0]!;
    expect(headerOf(call, "authorization")).toMatch(/^Bearer eyJ/);
    expect(headerOf(call, "token")).toBe("chave-estatica-do-front");
    expect(headerOf(call, "versao")).toBe("1.127.0.0");
    expect(headerOf(call, "hashDispositivo")).toBe("a".repeat(32));
  });

  test("auth:none omits the Authorization header but keeps the static token", async () => {
    const { http, net } = make([() => jsonResponse({ token: "x" })]);
    await http.send({ method: "POST", path: "autenticacao/token", auth: "none", body: {} });
    expect(headerOf(net.calls[0]!, "authorization")).toBeUndefined();
    expect(headerOf(net.calls[0]!, "token")).toBe("chave-estatica-do-front");
  });

  test("query values are serialized and nullish ones dropped", async () => {
    const { http, net } = make([() => jsonResponse([])]);
    await http.get("fatura/obterlista", { page: 1, pageSize: 50, statusId: 13, extra: undefined });
    const url = new URL(net.calls[0]!.url);
    expect(url.pathname).toBe("/fatura/obterlista");
    expect(url.searchParams.get("statusId")).toBe("13");
    expect(url.searchParams.has("extra")).toBe(false);
  });
});

describe("token lifecycle", () => {
  test("refreshes proactively when the token is about to expire, then sends", async () => {
    const expired = createMemorySessionStore(sessionData({ accessToken: jwt({}, -10, NOW) }));
    const fresh = jwt({}, 900, NOW);
    const { http, net, session } = make(
      [() => jsonResponse(fresh), () => jsonResponse({ ok: true })],
      expired,
    );
    await http.get("credito");
    expect(net.count).toBe(2);
    expect(new URL(net.calls[0]!.url).pathname).toBe("/autenticacao/refresh-token");
    // The refresh endpoint is the one place that wants this header.
    expect(headerOf(net.calls[0]!, "role")).toBe("refresh-token");
    expect(session.data?.accessToken).toBe(fresh);
    // The refresh token does not rotate; it must survive untouched.
    expect(session.data?.refreshToken).toBe("refresh-token-opaco-0123456789");
    expect(headerOf(net.calls[1]!, "authorization")).toBe(`Bearer ${fresh}`);
  });

  test("two concurrent calls on an expired token trigger exactly ONE refresh", async () => {
    const expired = createMemorySessionStore(sessionData({ accessToken: jwt({}, -10, NOW) }));
    let refreshes = 0;
    const { http, net } = make(
      [
        (call) => {
          if (call.url.includes("refresh-token")) refreshes += 1;
          return jsonResponse(jwt({}, 900, NOW));
        },
      ],
      expired,
    );
    await Promise.all([http.get("credito"), http.get("grupo/usuario/")]);
    expect(refreshes).toBe(1);
    expect(net.count).toBe(3); // one refresh + two reads
  });

  test("a 401 refreshes and replays the request once, with no backoff", async () => {
    const fresh = jwt({}, 900, NOW);
    const clock = fakeClock(NOW);
    const { http, net } = make(
      [
        () => jsonResponse({ message: "expirado" }, 401),
        () => jsonResponse(fresh),
        () => jsonResponse({ valorDisponivel: 54.35 }),
      ],
      createMemorySessionStore(sessionData()),
      clock,
    );
    const body = await http.get<{ valorDisponivel: number }>("credito");
    expect(body.valorDisponivel).toBe(54.35);
    expect(net.count).toBe(3);
    expect(headerOf(net.calls[2]!, "authorization")).toBe(`Bearer ${fresh}`);
    // A 401 is not a transient failure, so it must not sleep.
    expect(clock.slept).toEqual([]);
  });

  test("a second 401 after the refresh kills the session instead of looping", async () => {
    const { http, net } = make([
      () => jsonResponse({}, 401),
      () => jsonResponse(jwt({}, 900, NOW)),
      () => jsonResponse({}, 401),
    ]);
    await expect(http.get("credito")).rejects.toThrow(KotasAuthError);
    expect(net.count).toBe(3);
    // The dead flag spends no further request.
    await expect(http.get("credito")).rejects.toThrow(KotasAuthError);
    expect(net.count).toBe(3);
  });

  test("the refresh body is a bare JWT string, not an object", () => {
    const token = jwt({}, 900, NOW);
    expect(parseRefreshBody(JSON.stringify(token))).toBe(token);
    expect(parseRefreshBody(JSON.stringify({ token }))).toBe(token);
    expect(parseRefreshBody(token)).toBe(token);
    expect(parseRefreshBody("")).toBeNull();
    expect(parseRefreshBody("{}")).toBeNull();
  });

  test("no session at all is an actionable auth error, not a crash", async () => {
    const { http } = make([() => jsonResponse({})], createMemorySessionStore(null));
    await expect(http.get("credito")).rejects.toThrow(/Nenhuma sessão do Kotas salva.*kotas login/s);
  });

  test("a fresh login in another terminal is picked up without restarting", async () => {
    const session = createMemorySessionStore(sessionData());
    const { http, net } = make(
      [() => jsonResponse({}, 401), () => jsonResponse({}, 401), () => jsonResponse({}, 401)],
      session,
    );
    await expect(http.get("credito")).rejects.toThrow(KotasAuthError);
    const before = net.count;
    // `kotas login` writes a new session file; the mtime change clears the flag.
    session.save(sessionData({ accessToken: jwt({ NOME: "novo" }, 900, NOW) }));
    await expect(http.get("credito")).rejects.toThrow(KotasAuthError);
    expect(net.count).toBeGreaterThan(before);
  });
});

describe("resilience", () => {
  test("backs off on 5xx and gives up as a rate-limit error", async () => {
    const clock = fakeClock(NOW);
    const { http, net } = make(
      [() => jsonResponse({}, 503)],
      createMemorySessionStore(sessionData()),
      clock,
    );
    await expect(http.get("credito")).rejects.toThrow(RateLimitError);
    expect(net.count).toBe(MAX_ATTEMPTS);
    expect(clock.slept).toEqual([backoffMs(1), backoffMs(2), backoffMs(3)]);
  });

  test("backoff doubles and is capped", () => {
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(10)).toBe(60_000);
  });

  test("a business error carries the API message and the decoded body", async () => {
    const { http } = make([() => jsonResponse({ message: "algo de errado não está certo :P" }, 400)]);
    const error = (await http.get("grupo/membro/1").catch((issue) => issue)) as KotasApiError;
    expect(error).toBeInstanceOf(KotasApiError);
    expect(error.status).toBe(400);
    expect(error.message).toContain("algo de errado");
    // 400 is also how the API says "this group no longer exists".
    expect(error.message).toContain("grupo encerrado");
  });

  test("requests never overlap, even when fired concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    const { http } = make([
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return jsonResponse({});
      },
    ]);
    await Promise.all([http.get("a/b"), http.get("c/d"), http.get("e/f")]);
    expect(peak).toBe(1);
  });

  test("pacing waits the minimum interval between requests", async () => {
    const clock = fakeClock(NOW);
    const net = scriptedFetch([() => jsonResponse({})]);
    const http = createHttp(
      {
        session: createMemorySessionStore(sessionData()),
        baseUrl: BASE,
        apiToken: "t",
        appVersion: "1",
        minIntervalMs: 300,
        jitterMs: 200,
        timeoutMs: 1000,
        log: silentLogger(),
      },
      { fetch: net.fetch, sleep: clock.sleep, now: clock.now, random: () => 1 },
    );
    await http.get("a/b");
    await http.get("c/d");
    expect(clock.slept.at(-1)).toBe(500);
  });
});

import { describe, expect, test } from "bun:test";
import { createLogger, MIN_SECRET_LENGTH, redactSecrets } from "../src/core/logger.js";
import { createMemorySessionStore } from "../src/session/store.js";
import { sessionData } from "./helpers.js";

// The two tokens and the device hash are the account. They must not reach a log
// line, and redaction has to keep working after a refresh replaces the token.

describe("redaction", () => {
  test("replaces every occurrence of a secret", () => {
    expect(redactSecrets("token=abcdefghij e de novo abcdefghij", ["abcdefghij"])).toBe(
      "token=*** e de novo ***",
    );
  });

  test("a short value is not treated as a secret", () => {
    // A one-character secret would erase every "s" in every message.
    expect(MIN_SECRET_LENGTH).toBeGreaterThan(1);
    expect(redactSecrets("sessao", ["s"])).toBe("sessao");
  });

  test("the secret list is a provider, so it follows the token refresh", () => {
    const session = createMemorySessionStore(
      sessionData({ accessToken: "token-antigo-0123456789" }),
    );
    session.load();
    const lines: string[] = [];
    const log = createLogger({
      secrets: () => session.peekSecrets(),
      sink: (line) => lines.push(line),
    });

    log.info("usando token-antigo-0123456789");
    session.save(sessionData({ accessToken: "token-novo-9876543210" }));
    log.info("usando token-novo-9876543210");

    expect(lines.join("")).not.toContain("token-antigo");
    expect(lines.join("")).not.toContain("token-novo");
    expect(lines.every((line) => line.includes("***"))).toBe(true);
  });

  test("the device hash and the refresh token are redacted too", () => {
    const data = sessionData();
    const session = createMemorySessionStore(data);
    session.load();
    const lines: string[] = [];
    const log = createLogger({
      secrets: () => session.peekSecrets(),
      sink: (line) => lines.push(line),
    });
    log.warn(`falhou com ${data.refreshToken} e ${data.hashDispositivo}`);
    expect(lines[0]).not.toContain(data.refreshToken);
    expect(lines[0]).not.toContain(data.hashDispositivo);
  });

  test("every line carries its level and ends with a newline", () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (line) => lines.push(line) });
    log.error("quebrou");
    expect(lines[0]).toBe("[error] quebrou\n");
  });
});

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  DEFAULT_API_TOKEN,
  DEFAULT_APP_VERSION,
  DEFAULT_BASE_URL,
  loadConfig,
  MAX_PAGE_SIZE,
} from "../src/config.js";

describe("config", () => {
  test("defaults land under ~/.config/kotas-mcp and the real API host", () => {
    const config = loadConfig({});
    expect(config.configDir).toBe(join(homedir(), ".config", "kotas-mcp"));
    expect(config.sessionPath).toBe(join(config.configDir, "session.enc"));
    expect(config.dbPath).toBe(join(config.configDir, "cache.db"));
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.readOnly).toBe(false);
  });

  test("the static front token and the version header ship as defaults", () => {
    const config = loadConfig({});
    // Hardcoded in the Kotas bundle, identical for every user, required on
    // every request — so it is a default, not something the user must find.
    expect(config.apiToken).toBe(DEFAULT_API_TOKEN);
    expect(config.appVersion).toBe(DEFAULT_APP_VERSION);
    expect(loadConfig({ KOTAS_APP_VERSION: "1.128.0.0" }).appVersion).toBe("1.128.0.0");
  });

  test("`~/` is expanded by hand: an MCP config is JSON, not a shell", () => {
    const config = loadConfig({ KOTAS_CONFIG_DIR: "~/kotas-teste" });
    expect(config.configDir).toBe(join(homedir(), "kotas-teste"));
  });

  test("the pacing default stays well under the ceiling the terms ask for", () => {
    const config = loadConfig({});
    expect(config.minIntervalMs).toBeGreaterThanOrEqual(200);
    expect(1000 / (config.minIntervalMs + config.jitterMs / 2)).toBeLessThan(5);
    expect(MAX_PAGE_SIZE).toBe(50);
  });

  test("booleans accept the usual spellings and refuse the rest", () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(loadConfig({ KOTAS_READ_ONLY: value }).readOnly).toBe(true);
    }
    for (const value of ["0", "false", "no", "off"]) {
      expect(loadConfig({ KOTAS_READ_ONLY: value }).readOnly).toBe(false);
    }
    expect(() => loadConfig({ KOTAS_READ_ONLY: "talvez" })).toThrow(ConfigError);
  });

  test("every problem is collected so the user fixes them in one go", () => {
    const error = (() => {
      try {
        loadConfig({ KOTAS_READ_ONLY: "talvez", KOTAS_MIN_INTERVAL_MS: "-5", KOTAS_BASE_URL: "ftp://x" });
      } catch (issue) {
        return issue as ConfigError;
      }
      return null;
    })();
    expect(error?.problems.length).toBe(3);
  });

  test("a session key must be 32 bytes of base64", () => {
    expect(() => loadConfig({ KOTAS_SESSION_KEY: "curta" })).toThrow(/32 bytes/);
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(loadConfig({ KOTAS_SESSION_KEY: key }).sessionKey).toBe(key);
  });

  test("credentials come from the environment only for bootstrap", () => {
    const config = loadConfig({ KOTAS_EMAIL: "a@b.c", KOTAS_SENHA: "segredo" });
    expect(config.email).toBe("a@b.c");
    expect(config.password).toBe("segredo");
    // The English alias exists because half the env vars around it are English.
    expect(loadConfig({ KOTAS_PASSWORD: "outra" }).password).toBe("outra");
  });
});

import { homedir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// TypeBox is the single source of truth for the config. Every value comes from
// the environment (12-factor, `KOTAS_` prefix); no `.env` files are read. The
// schema describes the *parsed* object (booleans, ints, absolute paths), not
// the raw strings.

/** Chromium-based browsers whose localStorage can be imported (macOS). */
export const IMPORT_BROWSERS = ["dia", "arc", "chrome", "chromium", "brave", "edge"] as const;
export type ImportBrowser = (typeof IMPORT_BROWSERS)[number];

/** The only backend the MCP needs (spec §1). */
export const DEFAULT_BASE_URL = "https://api-front.kotas.com.br";
/** The SPA the session comes from — the localStorage origin. */
export const APP_ORIGIN = "https://app.kotas.com.br";

/**
 * Static front-end API key, hardcoded in the Kotas bundle (`getChaveAPIToken()`).
 * It is the same for every user and is required on every request; it is not a
 * user secret, so it ships as a default and is overridable when the front
 * rotates it.
 */
export const DEFAULT_API_TOKEN =
  "72a69d5467f157206616b46624597607424c05bdabcbf83ddbe79625d46efcd1";
/** `versao` header. Too far from the published one and the API answers 426. */
export const DEFAULT_APP_VERSION = "1.127.0.0";

export const SESSION_KEY_BYTES = 32;
/** The API rejects anything above this with a generic error (spec §3.1). */
export const MAX_PAGE_SIZE = 50;

export const ConfigSchema = Type.Object({
  /** Everything the tool persists lives under this directory. */
  configDir: Type.String({ minLength: 1 }),
  sessionPath: Type.String({ minLength: 1 }),
  keyPath: Type.String({ minLength: 1 }),
  dbPath: Type.String({ minLength: 1 }),
  /** The only directory `export` may write to. */
  exportDir: Type.String({ minLength: 1 }),
  /** Base64 of 32 bytes. When absent the key file under configDir is used/created. */
  sessionKey: Type.Optional(Type.String({ minLength: 1 })),
  readOnly: Type.Boolean(),
  compact: Type.Boolean(),
  logFile: Type.Optional(Type.String({ minLength: 1 })),
  /** When set, `login` imports the session from this browser instead of asking for a password. */
  importBrowser: Type.Optional(
    Type.Union([
      Type.Literal("dia"),
      Type.Literal("arc"),
      Type.Literal("chrome"),
      Type.Literal("chromium"),
      Type.Literal("brave"),
      Type.Literal("edge"),
    ]),
  ),
  /** Bootstrap credentials for `login`; never persisted. */
  email: Type.Optional(Type.String({ minLength: 3 })),
  password: Type.Optional(Type.String({ minLength: 1 })),
  apiToken: Type.String({ minLength: 1 }),
  appVersion: Type.String({ minLength: 1 }),
  /** Minimum gap between two Kotas requests (plus random jitter). */
  minIntervalMs: Type.Integer({ minimum: 0 }),
  jitterMs: Type.Integer({ minimum: 0 }),
  httpTimeoutMs: Type.Integer({ minimum: 1000 }),
  /** Overridable for tests (fake server). */
  baseUrl: Type.String({ minLength: 1 }),
});

export type Config = Static<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Configuração inválida do kotas-mcp:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function readOptional(env: Env, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
}

/** MCP client configs are JSON, not shell: `~/` has to be expanded by hand. */
function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function readBool(problems: string[], env: Env, key: string, fallback: boolean): boolean {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  problems.push(`${key} deve ser boolean (1/0, true/false, yes/no, on/off), veio "${raw}"`);
  return fallback;
}

function readInt(problems: string[], env: Env, key: string, fallback: number, min: number): number {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    problems.push(`${key} deve ser inteiro >= ${min}, veio "${raw}"`);
    return fallback;
  }
  return parsed;
}

function readEnum<T extends string>(
  problems: string[],
  env: Env,
  key: string,
  allowed: readonly T[],
  fallback: T | undefined,
): T | undefined {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if ((allowed as readonly string[]).includes(value)) return value as T;
  problems.push(`${key} deve ser ${allowed.join("|")}, veio "${raw}"`);
  return fallback;
}

function readSessionKey(problems: string[], env: Env): string | undefined {
  const raw = readOptional(env, "KOTAS_SESSION_KEY");
  if (raw === undefined) return undefined;
  if (Buffer.from(raw, "base64").length !== SESSION_KEY_BYTES) {
    problems.push(
      `KOTAS_SESSION_KEY deve ser base64 de ${SESSION_KEY_BYTES} bytes (gere com: openssl rand -base64 32)`,
    );
    return undefined;
  }
  return raw;
}

function readUrl(problems: string[], env: Env, key: string, fallback: string): string {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    problems.push(`${key} deve ser uma URL http(s), veio "${raw}"`);
    return fallback;
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Loads and validates the config from the environment (fail-fast). Every
 * problem is collected so the user fixes all of them in one go. Nothing is
 * required: a missing session fails at call time with an actionable
 * `KotasAuthError`, not at boot.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const configDir = expandHome(
    readOptional(env, "KOTAS_CONFIG_DIR") ?? join(homedir(), ".config", "kotas-mcp"),
  );

  const config: Config = {
    configDir,
    sessionPath: join(configDir, "session.enc"),
    keyPath: join(configDir, "session.key"),
    dbPath: join(configDir, "cache.db"),
    exportDir: expandHome(
      readOptional(env, "KOTAS_EXPORT_DIR") ?? join(homedir(), "Downloads", "kotas-export"),
    ),
    sessionKey: readSessionKey(problems, env),
    readOnly: readBool(problems, env, "KOTAS_READ_ONLY", false),
    compact: readBool(problems, env, "KOTAS_COMPACT", false),
    logFile: readOptional(env, "KOTAS_LOG_FILE"),
    importBrowser: readEnum(problems, env, "KOTAS_IMPORT_BROWSER", IMPORT_BROWSERS, undefined),
    email: readOptional(env, "KOTAS_EMAIL"),
    password: readOptional(env, "KOTAS_SENHA") ?? readOptional(env, "KOTAS_PASSWORD"),
    apiToken: readOptional(env, "KOTAS_API_TOKEN") ?? DEFAULT_API_TOKEN,
    appVersion: readOptional(env, "KOTAS_APP_VERSION") ?? DEFAULT_APP_VERSION,
    // The spec asks for "close to human volume"; ~2 req/s, well under the 5 req/s ceiling.
    minIntervalMs: readInt(problems, env, "KOTAS_MIN_INTERVAL_MS", 300, 0),
    jitterMs: readInt(problems, env, "KOTAS_JITTER_MS", 200, 0),
    httpTimeoutMs: readInt(problems, env, "KOTAS_HTTP_TIMEOUT_MS", 30_000, 1000),
    baseUrl: readUrl(problems, env, "KOTAS_BASE_URL", DEFAULT_BASE_URL),
  };

  // Safety net: the parsed object must match the schema (catches any drift
  // between the readers above and the declared shape).
  if (!Value.Check(ConfigSchema, config)) {
    for (const error of Value.Errors(ConfigSchema, config)) {
      problems.push(`${error.path || "/"}: ${error.message}`);
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

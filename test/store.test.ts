import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionError } from "../src/core/errors.js";
import { loadConfig, SESSION_KEY_BYTES } from "../src/config.js";
import { createSessionStore, decrypt, encrypt, resolveKey } from "../src/session/store.js";
import { sessionData } from "./helpers.js";

// The refresh token does not rotate, so it is the long-lived secret: the file
// that holds it is encrypted, 0600, and written atomically.

const dir = mkdtempSync(join(tmpdir(), "kotas-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const configFor = (name: string) => loadConfig({ KOTAS_CONFIG_DIR: join(dir, name) });

describe("encryption", () => {
  test("round-trips through AES-256-GCM", () => {
    const key = Buffer.alloc(SESSION_KEY_BYTES, 7);
    const blob = encrypt(key, Buffer.from("segredo"));
    expect(decrypt(key, blob).toString()).toBe("segredo");
  });

  test("a tampered blob does not decrypt into something usable", () => {
    const key = Buffer.alloc(SESSION_KEY_BYTES, 7);
    const blob = encrypt(key, Buffer.from("segredo"));
    blob[blob.length - 1] = (blob[blob.length - 1] as number) ^ 0xff;
    expect(() => decrypt(key, blob)).toThrow(SessionError);
  });

  test("another key is refused with a message that names the fix", () => {
    const blob = encrypt(Buffer.alloc(SESSION_KEY_BYTES, 7), Buffer.from("x"));
    expect(() => decrypt(Buffer.alloc(SESSION_KEY_BYTES, 8), blob)).toThrow(/KOTAS_SESSION_KEY/);
  });
});

describe("key resolution", () => {
  test("the env key wins over the file", () => {
    const key = Buffer.alloc(SESSION_KEY_BYTES, 3).toString("base64");
    const resolved = resolveKey({ sessionKey: key, keyPath: join(dir, "nope.key") }, false);
    expect(resolved?.toString("base64")).toBe(key);
  });

  test("no key and no permission to create it answers null instead of inventing one", () => {
    expect(resolveKey({ keyPath: join(dir, "missing.key") }, false)).toBeNull();
  });

  test("a key file of the wrong size is refused, not silently padded", () => {
    const keyPath = join(dir, "short.key");
    writeFileSync(keyPath, Buffer.alloc(8).toString("base64"));
    expect(() => resolveKey({ keyPath }, false)).toThrow(/inválida/);
  });
});

describe("the session file", () => {
  test("saves 0600, reloads, and never keeps the password", () => {
    const config = configFor("a");
    const store = createSessionStore(config);
    expect(store.load()).toBeNull();

    const data = sessionData();
    store.save(data);
    expect(statSync(config.sessionPath).mode & 0o777).toBe(0o600);
    expect(statSync(config.keyPath).mode & 0o777).toBe(0o600);

    const reloaded = store.load()!;
    expect(reloaded).toEqual(data);
    expect(JSON.stringify(reloaded)).not.toContain("senha");
  });

  test("peekSecrets covers both tokens and the device hash", () => {
    const store = createSessionStore(configFor("b"));
    const data = sessionData();
    store.save(data);
    const secrets = store.peekSecrets();
    expect(secrets).toContain(data.accessToken);
    expect(secrets).toContain(data.refreshToken);
    expect(secrets).toContain(data.hashDispositivo);
  });

  test("mtime changes on every save: it is the re-login signal", () => {
    const store = createSessionStore(configFor("c"));
    expect(store.mtimeMs()).toBeNull();
    store.save(sessionData());
    const first = store.mtimeMs();
    expect(first).not.toBeNull();
    store.save(sessionData({ savedAt: 2 }));
    expect(store.mtimeMs()).not.toBeNull();
  });

  test("clear removes the session but keeps the key, so a re-login reuses it", () => {
    const config = configFor("d");
    const store = createSessionStore(config);
    store.save(sessionData());
    store.clear();
    expect(store.load()).toBeNull();
    expect(statSync(config.keyPath).isFile()).toBe(true);
    expect(store.peekSecrets()).toHaveLength(0);
  });

  test("a session in an unknown shape is refused instead of half-read", () => {
    const config = configFor("e");
    const store = createSessionStore(config);
    store.save(sessionData());
    const key = resolveKey(config, false) as Buffer;
    writeFileSync(config.sessionPath, encrypt(key, Buffer.from(JSON.stringify({ version: 9 }))));
    expect(() => store.load()).toThrow(/versão não suportada/);
  });
});

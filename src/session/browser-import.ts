import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_ORIGIN, type ImportBrowser } from "../config.js";
import { LoginError } from "../core/errors.js";
import type { SessionData } from "./store.js";

// Importing an existing browser session. The sibling MCPs read the Chromium
// cookie SQLite; the Kotas keeps nothing in a cookie — the SPA stores the two
// tokens and the device hash in `localStorage` (spec §2.6), which Chromium
// keeps in a LevelDB directory, not in SQLite.
//
// LevelDB is read by scanning the raw records rather than through a library:
// every JS LevelDB binding is a native addon, and a native addon cannot be
// embedded by `bun build --compile`. The scan is made safe by *validating the
// shape* of what it finds — a JWT, an opaque token, 32 hex characters — so a
// torn read or a coincidental byte match is rejected instead of saved.

/** localStorage keys the Kotas front writes (spec §2.6). */
export const STORAGE_KEYS = {
  accessToken: "@chave",
  refreshToken: "@c08cbbfd6eefc83ac6d23c4c791277e4",
  /** btoa("HASH_DISPOSITIVO"). */
  deviceHash: "SEFTSF9ESVNQT1NJVElWTw==",
} as const;

const LOCATIONS: Record<ImportBrowser, { label: string; dir: string }> = {
  arc: { label: "Arc", dir: "Arc/User Data" },
  chrome: { label: "Google Chrome", dir: "Google/Chrome" },
  chromium: { label: "Chromium", dir: "Chromium" },
  brave: { label: "Brave", dir: "BraveSoftware/Brave-Browser" },
  edge: { label: "Microsoft Edge", dir: "Microsoft Edge" },
};

/** `_<origin>` + NUL + SOH — the prefix every localStorage record for a site carries. */
export const originPrefix = (origin: string): Buffer =>
  Buffer.from(`_${origin}\u0000\u0001`, "latin1");

const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
const OPAQUE = /^[A-Za-z0-9+/=_.-]{16,4096}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const PRINTABLE = /^[ -~]+$/;

export function readUvarint(data: Buffer, at: number): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  let index = at;
  while (index < data.length) {
    const byte = data[index] as number;
    result |= (byte & 0x7f) << shift;
    index += 1;
    if ((byte & 0x80) === 0) return { value: result >>> 0, next: index };
    shift += 7;
    if (shift > 28) return null;
  }
  return null;
}

/** Decodes `count` varints that end exactly at `end`, or null. */
export function varintsEndingAt(data: Buffer, end: number, count: number): number[] | null {
  for (let width = count; width <= count * 5; width += 1) {
    const start = end - width;
    if (start < 0) continue;
    const values: number[] = [];
    let cursor = start;
    let ok = true;
    for (let n = 0; n < count; n += 1) {
      const read = readUvarint(data, cursor);
      if (!read) {
        ok = false;
        break;
      }
      values.push(read.value);
      cursor = read.next;
    }
    if (ok && cursor === end) return values;
  }
  return null;
}

/** Chromium prefixes the stored string with its encoding: 0 = UTF-16LE, 1 = Latin-1. */
export function decodeValue(raw: Buffer): string | null {
  if (raw.length < 2) return null;
  const body = raw.subarray(1);
  if (raw[0] === 0) return body.toString("utf16le");
  if (raw[0] === 1) return body.toString("latin1");
  return null;
}

export type Candidate = { name: string; value: string };

/**
 * Pulls every localStorage entry for `origin` out of one LevelDB file. Two
 * record framings appear: the write-ahead log stores `type|keyLen|key|valLen|value`,
 * and a table block stores `shared|nonShared|valueLen` before the key.
 */
export function scanFile(data: Buffer, origin: string): Candidate[] {
  const prefix = originPrefix(origin);
  const found: Candidate[] = [];
  let at = data.indexOf(prefix);
  while (at !== -1) {
    for (const candidate of framings(data, at, prefix.length)) found.push(candidate);
    at = data.indexOf(prefix, at + 1);
  }
  return found;
}

function framings(data: Buffer, at: number, prefixLength: number): Candidate[] {
  const out: Candidate[] = [];
  const push = (nameEnd: number, valueStart: number, valueLength: number) => {
    if (nameEnd <= at + prefixLength || valueStart + valueLength > data.length) return;
    const name = data.subarray(at + prefixLength, nameEnd).toString("latin1");
    if (!PRINTABLE.test(name)) return;
    const value = decodeValue(data.subarray(valueStart, valueStart + valueLength));
    if (value !== null) out.push({ name, value });
  };

  const log = varintsEndingAt(data, at, 1);
  const keyLength = log?.[0];
  if (keyLength !== undefined && keyLength >= prefixLength) {
    const keyEnd = at + keyLength;
    const valueLength = readUvarint(data, keyEnd);
    if (valueLength) push(keyEnd, valueLength.next, valueLength.value);
  }

  const table = varintsEndingAt(data, at, 3);
  if (table && table[0] === 0 && table[1] !== undefined && table[2] !== undefined) {
    // A table entry appends an 8-byte sequence trailer to the key; some files
    // are written without it, so both are tried and the shape check decides.
    for (const trailer of [8, 0]) {
      push(at + table[1] - trailer, at + table[1], table[2]);
    }
  }
  return out;
}

function leveldbFiles(profileDir: string): string[] {
  const dir = join(profileDir, "Local Storage", "leveldb");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".log") || name.endsWith(".ldb"))
    .map((name) => join(dir, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
}

/** Every profile of a Chromium install, so a second profile is not missed. */
export function profileDirs(browser: ImportBrowser, home = homedir()): string[] {
  const base = join(home, "Library", "Application Support", LOCATIONS[browser].dir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => name === "Default" || /^Profile \d+$/.test(name))
    .map((name) => join(base, name));
}

export type ImportResult = { session: SessionData; browser: string; profile: string };

/**
 * Reads the Kotas session out of a locally installed browser. Nothing is
 * decrypted and nothing is written: localStorage is stored in the clear, which
 * is precisely why the tokens must not stay only there.
 */
export function importFromBrowser(
  browser: ImportBrowser,
  now: number,
  options: { home?: string; origin?: string } = {},
): ImportResult {
  const origin = options.origin ?? APP_ORIGIN;
  const label = LOCATIONS[browser].label;
  const dirs = profileDirs(browser, options.home);
  if (dirs.length === 0) {
    throw new LoginError(
      `Não achei um perfil do ${label} nesta máquina. Rode \`kotas login\` (e-mail e senha) ou \`kotas login --paste\`.`,
    );
  }

  // Later files and later offsets are newer writes, so the last plausible value
  // for each key wins.
  const best: Record<string, string> = {};
  let profile = "";
  for (const dir of dirs) {
    for (const file of leveldbFiles(dir)) {
      let data: Buffer;
      try {
        data = readFileSync(file);
      } catch {
        continue; // ponytail: a file the browser is rewriting is simply skipped.
      }
      for (const { name, value } of scanFile(data, origin)) {
        if (!accept(name, value)) continue;
        best[name] = value;
        profile = dir;
      }
    }
  }

  const accessToken = best[STORAGE_KEYS.accessToken];
  const refreshToken = best[STORAGE_KEYS.refreshToken];
  if (!accessToken || !refreshToken) {
    throw new LoginError(
      `Não encontrei uma sessão do Kotas no ${label}. Abra ${origin}, entre na conta e rode de novo — ` +
        "ou use `kotas login` (e-mail e senha), que não depende do navegador.",
    );
  }
  return {
    browser: label,
    profile,
    session: {
      version: 1,
      accessToken,
      refreshToken,
      hashDispositivo: best[STORAGE_KEYS.deviceHash] ?? "",
      savedAt: now,
    },
  };
}

/** The shape gate: this is what makes a raw byte scan safe to trust. */
export function accept(name: string, value: string): boolean {
  if (name === STORAGE_KEYS.accessToken) return JWT.test(value);
  if (name === STORAGE_KEYS.refreshToken) return OPAQUE.test(value);
  if (name === STORAGE_KEYS.deviceHash) return HEX32.test(value);
  return false;
}

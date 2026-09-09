import { describe, expect, test } from "bun:test";
import {
  accept,
  decodeValue,
  originPrefix,
  readUvarint,
  scanFile,
  STORAGE_KEYS,
  varintsEndingAt,
} from "../src/session/browser-import.js";

// LevelDB is read by scanning raw records, so these tests build records in both
// framings Chromium writes and prove the reader gets them back — and, just as
// importantly, that the shape gate rejects a coincidental byte match.

const ORIGIN = "https://app.kotas.com.br";
const FAKE_JWT = `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(40)}.c2ln`;

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

/** Write-ahead log framing: type, keyLen, key, valueLen, encoding, value. */
function logRecord(name: string, value: string, origin = ORIGIN): Buffer {
  const key = Buffer.concat([originPrefix(origin), Buffer.from(name, "latin1")]);
  const body = Buffer.concat([Buffer.from([1]), Buffer.from(value, "latin1")]);
  return Buffer.concat([Buffer.from([1]), varint(key.length), key, varint(body.length), body]);
}

/** Table-block framing: shared, nonShared, valueLen, key(+trailer), value. */
function tableRecord(name: string, value: string, trailer = 8): Buffer {
  const key = Buffer.concat([originPrefix(ORIGIN), Buffer.from(name, "latin1")]);
  const full = Buffer.concat([key, Buffer.alloc(trailer)]);
  const body = Buffer.concat([Buffer.from([1]), Buffer.from(value, "latin1")]);
  return Buffer.concat([varint(0), varint(full.length), varint(body.length), full, body]);
}

const pick = (data: Buffer, name: string): string | undefined =>
  scanFile(data, ORIGIN).find((entry) => entry.name === name && accept(entry.name, entry.value))
    ?.value;

describe("varints", () => {
  test("reads multi-byte varints", () => {
    expect(readUvarint(varint(33), 0)).toEqual({ value: 33, next: 1 });
    expect(readUvarint(varint(1686), 0)).toEqual({ value: 1686, next: 2 });
    expect(readUvarint(Buffer.from([0x80]), 0)).toBeNull();
  });

  test("decodes varints backwards from a known end", () => {
    const data = Buffer.concat([varint(0), varint(51), varint(24), Buffer.from("KEY")]);
    expect(varintsEndingAt(data, 3, 3)).toEqual([0, 51, 24]);
    expect(varintsEndingAt(data, 3, 1)).toEqual([24]);
  });
});

describe("value encoding", () => {
  test("byte 1 is Latin-1 and byte 0 is UTF-16LE", () => {
    expect(decodeValue(Buffer.concat([Buffer.from([1]), Buffer.from("abc", "latin1")]))).toBe("abc");
    expect(decodeValue(Buffer.concat([Buffer.from([0]), Buffer.from("abc", "utf16le")]))).toBe(
      "abc",
    );
    expect(decodeValue(Buffer.from([2, 65]))).toBeNull();
    expect(decodeValue(Buffer.from([1]))).toBeNull();
  });
});

describe("scanFile", () => {
  test("reads the three Kotas keys out of the log framing", () => {
    const data = Buffer.concat([
      Buffer.from("ruido antes"),
      logRecord(STORAGE_KEYS.accessToken, FAKE_JWT),
      logRecord(STORAGE_KEYS.refreshToken, "R".repeat(44)),
      logRecord(STORAGE_KEYS.deviceHash, "f".repeat(32)),
      Buffer.from("ruido depois"),
    ]);
    expect(pick(data, STORAGE_KEYS.accessToken)).toBe(FAKE_JWT);
    expect(pick(data, STORAGE_KEYS.refreshToken)).toBe("R".repeat(44));
    expect(pick(data, STORAGE_KEYS.deviceHash)).toBe("f".repeat(32));
  });

  test("reads the table framing, with and without the sequence trailer", () => {
    for (const trailer of [8, 0]) {
      const data = tableRecord(STORAGE_KEYS.accessToken, FAKE_JWT, trailer);
      expect(pick(data, STORAGE_KEYS.accessToken)).toBe(FAKE_JWT);
    }
  });

  test("another site's records are never read as the Kotas ones", () => {
    const data = Buffer.concat([
      logRecord(STORAGE_KEYS.accessToken, "nao-e-nosso", "https://outro.site"),
      logRecord(STORAGE_KEYS.accessToken, FAKE_JWT),
    ]);
    expect(scanFile(data, "https://outro.site")).toHaveLength(1);
    expect(pick(data, STORAGE_KEYS.accessToken)).toBe(FAKE_JWT);
  });

  test("the newest write wins when a key was stored more than once", () => {
    const data = Buffer.concat([
      logRecord(STORAGE_KEYS.deviceHash, "a".repeat(32)),
      logRecord(STORAGE_KEYS.deviceHash, "b".repeat(32)),
    ]);
    const hits = scanFile(data, ORIGIN).filter((entry) => accept(entry.name, entry.value));
    expect(hits.at(-1)?.value).toBe("b".repeat(32));
  });

  test("a truncated record yields nothing instead of a wrong value", () => {
    const full = logRecord(STORAGE_KEYS.accessToken, FAKE_JWT);
    expect(pick(full.subarray(0, full.length - 20), STORAGE_KEYS.accessToken)).toBeUndefined();
  });
});

describe("the shape gate", () => {
  test("only a real JWT is accepted as the access token", () => {
    expect(accept(STORAGE_KEYS.accessToken, FAKE_JWT)).toBe(true);
    expect(accept(STORAGE_KEYS.accessToken, "lixo aleatorio")).toBe(false);
    expect(accept(STORAGE_KEYS.accessToken, "eyJhbGci")).toBe(false);
  });

  test("the device hash must be 32 lowercase hex characters", () => {
    expect(accept(STORAGE_KEYS.deviceHash, "f".repeat(32))).toBe(true);
    expect(accept(STORAGE_KEYS.deviceHash, "F".repeat(32))).toBe(false);
    expect(accept(STORAGE_KEYS.deviceHash, "f".repeat(31))).toBe(false);
  });

  test("unknown keys are never adopted, however plausible they look", () => {
    expect(accept("mautic_device_id", FAKE_JWT)).toBe(false);
  });

  test("a torn value that decoded into garbage is rejected by shape, not stored", () => {
    const data = logRecord(STORAGE_KEYS.accessToken, " nao e um jwt");
    expect(pick(data, STORAGE_KEYS.accessToken)).toBeUndefined();
  });
});

#!/usr/bin/env bun
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Turns the raw captures in task/captures/ into the fixtures committed under
// test/fixtures/. The repository is public, so this is the only path by which
// real account data may become a test.
//
// Design rules:
//  - DETERMINISTIC (salted hash): the same id always maps to the same fake id,
//    so the joins survive — the group id inside "Fatura grupo SetApp #327356"
//    is still the id of the group in groups.json, which is what makes the
//    history reconstruction meaningful in a test.
//  - MONEY, QUANTITIES AND DATES ARE NEVER TOUCHED. Ids are remapped by FIELD
//    NAME plus the `#<id>` pattern, never by "any long digit run": that is what
//    keeps `valorTotal4Casas` and `dataPagamento` true, and the financial
//    identities with them.
//  - ENUM IDS ARE NOT IDS. `statusId`, `tipoId` and `formaAcessoId` carry
//    meaning; remapping them would make every fixture describe a different fact.
//  - LEAK GUARD: the script fails if any value it replaced survives anywhere.

const ROOT = join(import.meta.dir, "..");
const CAPTURES = join(ROOT, "task", "captures");
const OUT = join(ROOT, "test", "fixtures");
const SALT_FILE = join(ROOT, "task", "anonymize.salt");
const SECRETS_FILE = join(ROOT, "task", "anonymize.secrets");

/** Field names carrying an id: remapped, keeping the shape. */
const ID_FIELDS = new Set([
  "id",
  "idHash",
  "idHashAssinar",
  "grupoId",
  "grupoPaiId",
  "grupoUsuarioId",
  "faturaId",
  "servicoId",
  "idServico",
  "planoId",
  "adminId",
  "usuarioId",
  "idUsuario",
  "keyGatewayPagamento",
  "codIndicacao",
  "cupom",
]);

/**
 * Ids that are ENUMS, not identifiers. Remapping `statusId` would turn a paid
 * invoice into a cancelled one and every assertion in the fixtures would be
 * describing something that never happened.
 */
const ENUM_FIELDS = new Set([
  "statusId",
  "tipoId",
  "formaAcessoId",
  "formaContatoId",
  "idCategoria",
  "categoriaId",
  "idGatewayPagamento",
  "gatewayId",
  "tipoPlano",
  "tipoRelacionamento",
  "statusServico",
  "tipoApostaLoteria",
  "idMeioPagamento",
  "quantidade",
  "qtdKotas",
  "fidelidade",
]);

/** Pure personal data: the string value is replaced wholesale. */
const REPLACEMENTS: Record<string, string> = {
  adminNome: "Fulano",
  adminNomeCompleto: "Fulano de Tal",
  adminEmail: "admin@exemplo.test",
  email: "conta@exemplo.test",
  nomeCompleto: "Fulano de Tal",
  nickname: "fulano_000000",
  txNickname: "fulano_000000",
  telefone: "11999999999",
  participante: "Participante Exemplo",
  adminImagem: "https://exemplo.test/avatar.png",
  imagem: "https://exemplo.test/avatar.png",
  urlImagemPerfil: "https://exemplo.test/avatar.png",
  infoAdicional: "",
  formaContato: "",
};

/**
 * The participant list names people, and a group is named after its admin
 * ("Google One de Fulano"). `nome` is therefore personal in one context and a
 * label in another — it is handled below, by context, not by this map.
 */
const PERSON_NAME_KEYS = new Set(["nome"]);

/** Free text an administrator typed: could say anything. */
const TEXT_FIELDS = new Set(["descricao", "regras", "informacoes", "observacao", "mensagem"]);

/** Free text that must NOT be scrambled: the parsers read these. */
const KEEP_TEXT = new Set([
  "servico",
  "plano",
  "status",
  "statusDescricao",
  "tipoDescricao",
  "categoriaDescricao",
  "descricaoPlano",
  "formaAcessoDescricao",
  "moedaValorPlano",
  "site",
  "nomeCategoria",
  "nomeUrl",
]);

/** Bulky blocks no test reads. */
const DROPPED = new Set(["selosGrupo", "selosAdministrador", "tags", "relacionamentos", "relacionamentosPermitidos"]);

/** The group id travels inside descriptions: "Fatura grupo SetApp #327356". */
const HASH_ID = /#(\d{4,})/g;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Below this a numeric `id` is an enum, not an identifier. */
const MIN_REAL_ID = 9_999;

const WORDS = [
  "Alfa", "Bravo", "Cabo", "Delta", "Eco", "Fenix", "Gama", "Hidra", "Indigo", "Jade",
  "Kilo", "Lima", "Micro", "Nano", "Omega", "Pixel", "Quartzo", "Rubi", "Sigma", "Tango",
];

function loadSalt(): string {
  if (existsSync(SALT_FILE)) return readFileSync(SALT_FILE, "utf8").trim();
  const salt = randomBytes(16).toString("hex");
  mkdirSync(join(ROOT, "task"), { recursive: true, mode: 0o700 });
  writeFileSync(SALT_FILE, `${salt}\n`, { mode: 0o600 });
  return salt;
}

const salt = loadSalt();
const digest = (value: string): string =>
  createHash("sha256").update(`${salt}${value}`).digest("hex");

/** Extra strings the user knows are private, one per line. */
const extraSecrets = existsSync(SECRETS_FILE)
  ? readFileSync(SECRETS_FILE, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  : [];

/** Every original value that was replaced; the leak guard hunts for all of them. */
const secrets = new Set<string>(extraSecrets);
/** Which field a secret came from — a leak has to name the culprit to be fixable. */
const secretOrigin = new Map<string, string>();
/** original → what it must become, applied to the WHOLE output at the end. */
const globalMap = new Map<string, string>();

const remember = (value: string, key: string, replacement: string): void => {
  if (value.trim() === "") return;
  secrets.add(value);
  if (!secretOrigin.has(value)) secretOrigin.set(value, key);
  // A name replaced in `adminNome` also shows up inside the group's own name
  // ("Google One de Fulano"). One global pass at the end is what makes
  // "replaced somewhere" mean "replaced everywhere".
  if (value.length >= 5 && !globalMap.has(value)) globalMap.set(value, replacement);
};

const idCache = new Map<string, string>();
const wordCache = new Map<string, string>();

/** Keeps the shape: same length for a number, same layout for a GUID. */
function fakeId(value: string): string {
  const cached = idCache.get(value);
  if (cached) return cached;
  const hex = digest(value);
  let mapped: string;
  if (GUID.test(value)) {
    mapped = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
  } else if (/^\d+$/.test(value)) {
    const digits = hex.replace(/\D/g, "").padEnd(value.length, "7");
    // Never start with 0: the value has to survive a round-trip through Number.
    mapped = (digits[0] === "0" ? "1" : digits[0]) + digits.slice(1, value.length);
  } else {
    mapped = hex.slice(0, Math.max(8, value.length));
  }
  idCache.set(value, mapped);
  if (value.length >= 4) remember(value, "id", mapped);
  return mapped;
}

function fakeWord(word: string): string {
  const key = word.toLowerCase();
  let mapped = wordCache.get(key);
  if (!mapped) {
    mapped = WORDS[Number.parseInt(digest(key).slice(0, 8), 16) % WORDS.length] as string;
    wordCache.set(key, mapped);
  }
  if (word === word.toUpperCase()) return mapped.toUpperCase();
  if (word === word.toLowerCase()) return mapped.toLowerCase();
  return mapped;
}

/** Ids travelling inside free text, so a description still joins to its group. */
const scrub = (text: string): string =>
  text.replace(HASH_ID, (_match, id: string) => `#${fakeId(id)}`);

/**
 * A description is the load-bearing text of this API: it is where the product
 * name and the group id of a cancelled subscription survive. So it is scrubbed
 * for ids but NOT scrambled — the shape `Fatura grupo <produto> #<id>` is
 * exactly what the parser is being tested against.
 */
const fakeText = (text: string): string =>
  scrub(text).replace(/\p{L}{4,}/gu, (word) => fakeWord(word));

type Json = unknown;

function walk(node: Json, key = "", path: string[] = []): Json {
  if (Array.isArray(node)) return node.map((item) => walk(item, key, path));
  if (node !== null && typeof node === "object") {
    const out: Record<string, Json> = {};
    for (const [childKey, value] of Object.entries(node as Record<string, Json>)) {
      if (DROPPED.has(childKey)) continue;
      out[childKey] = walk(value, childKey, [...path, key]);
    }
    return out;
  }

  if (typeof node === "string") {
    if (node === "") return node;
    if (ENUM_FIELDS.has(key) || KEEP_TEXT.has(key)) return node;
    if (ID_FIELDS.has(key)) return fakeId(node);
    if (key in REPLACEMENTS) {
      remember(node, key, REPLACEMENTS[key] as string);
      return REPLACEMENTS[key] as string;
    }
    if (PERSON_NAME_KEYS.has(key)) {
      // Inside `participantes[]` it is a person; on a group it is the label
      // "<serviço> de <pessoa>", whose person half the global pass removes.
      if (path.includes("participantes")) {
        const placeholder = `Participante ${fakeWord(node)}`;
        remember(node, key, placeholder);
        return placeholder;
      }
      return scrub(node);
    }
    if (TEXT_FIELDS.has(key)) {
      // `descricao` is the one text the parsers read; it keeps its shape.
      return key === "descricao" ? scrub(node) : fakeText(node);
    }
    return scrub(node);
  }

  if (typeof node === "number") {
    if (ENUM_FIELDS.has(key)) return node;
    if (ID_FIELDS.has(key) && Math.abs(node) > MIN_REAL_ID) return Number(fakeId(String(node)));
  }
  return node;
}

function main(): void {
  if (!existsSync(CAPTURES)) {
    console.error(`Sem capturas em ${CAPTURES}. Rode antes: bun run scripts/capture-fixtures.ts --write`);
    process.exit(1);
  }
  const write = process.argv.includes("--write");
  const files = readdirSync(CAPTURES).filter((name) => name.endsWith(".json")).sort();

  const results: Array<{ name: string; text: string }> = [];
  for (const name of files) {
    const payload: unknown = JSON.parse(readFileSync(join(CAPTURES, name), "utf8"));
    results.push({ name, text: `${JSON.stringify(walk(payload), null, 2)}\n` });
  }

  // Longest first: a short value must never eat a longer one it is part of.
  const ordered = [...globalMap.entries()].sort(([a], [b]) => b.length - a.length);
  for (const item of results) {
    for (const [original, replacement] of ordered) {
      item.text = item.text.split(original).join(replacement);
    }
  }

  let leaks = 0;
  for (const item of results) {
    const found = [...secrets].filter(
      (secret) => secret.length >= 4 && item.text.includes(secret),
    );
    if (found.length > 0) {
      leaks += found.length;
      console.error(`LEAK em ${item.name}: ${found.length} valor(es) originais sobreviveram.`);
      for (const value of found.slice(0, 5)) {
        console.error(
          `  ${value.slice(0, 4)}… (${value.length} chars) veio do campo \`${secretOrigin.get(value) ?? "?"}\``,
        );
      }
    }
  }
  if (leaks > 0) process.exit(1);

  if (write) {
    mkdirSync(OUT, { recursive: true });
    for (const item of results) writeFileSync(join(OUT, item.name), item.text);
  }
  for (const item of results) console.error(`  ok  ${item.name.padEnd(26)} ${item.text.length} bytes`);
  console.error(
    `\n${idCache.size} ids remapeados, ${wordCache.size} palavras, ${secrets.size} valores no leak guard.`,
  );
  console.error(write ? `\nGravado em ${OUT}.` : "\nDry-run. Rode com --write para gravar.");
}

main();

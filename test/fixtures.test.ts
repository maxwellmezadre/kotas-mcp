import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeBalance,
  normalizeCredit,
  normalizeGroup,
  normalizeInvoice,
  normalizeParticipants,
  normalizePayout,
  normalizePayoutEntry,
} from "../src/domain/normalize.js";
import { toDecimal } from "../src/domain/money.js";

// The normalizers run over the REAL (anonymised) payloads. A unit test with an
// invented object proves the code does what the author expected; this proves it
// does what the Kotas actually sends.

const DIR = join(import.meta.dir, "fixtures");
const load = <T,>(name: string): T => JSON.parse(readFileSync(join(DIR, name), "utf8")) as T;

describe("faturas reais", () => {
  const paid = load<Array<Record<string, unknown>>>("invoices-paid.json");
  const cancelled = load<Array<Record<string, unknown>>>("invoices-cancelled.json");

  test("toda fatura paga normaliza, com total e data", () => {
    expect(paid.length).toBeGreaterThan(0);
    for (const raw of paid) {
      const invoice = normalizeInvoice(raw)!;
      expect(invoice).not.toBeNull();
      expect(invoice.statusId).toBe(13);
      expect(invoice.total).not.toBeNull();
      expect(invoice.paidDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("a descrição entrega produto e grupo, que é o histórico inteiro", () => {
    const subjects = paid.map((raw) => normalizeInvoice(raw)!).filter((i) => i.groupId !== null);
    expect(subjects.length).toBeGreaterThan(0);
    for (const invoice of subjects) {
      expect(invoice.product).toBeTruthy();
      expect(invoice.groupId).toBeGreaterThan(0);
      // "Compra de crédito" não tem grupo, e é assim que se distingue.
      expect(invoice.description).toContain("Fatura grupo");
    }
  });

  test("fatura cancelada existe e não é gasto", () => {
    expect(cancelled.length).toBeGreaterThan(0);
    for (const raw of cancelled) expect(normalizeInvoice(raw)!.statusId).toBe(19);
  });

  test("os itens vêm só do extrato: a listagem manda `itens: null`", () => {
    expect(paid.every((raw) => raw.itens === null || raw.itens === undefined)).toBe(true);
    const items = load<Array<Record<string, unknown>>>("invoice-statement.json");
    expect(Array.isArray(items)).toBe(true);
  });
});

describe("grupos reais", () => {
  test("a listagem diz o papel, e é a única que diz", () => {
    const groups = load<Array<Record<string, unknown>>>("groups.json");
    expect(groups.length).toBeGreaterThan(0);
    for (const raw of groups) {
      const group = normalizeGroup(raw)!;
      expect(group.id).toBeGreaterThan(0);
      expect(typeof group.isAdministrator).toBe("boolean");
      expect(group.amount).not.toBeNull();
    }
  });

  test("o detalhe de administrador traz os participantes e o que cada um paga", () => {
    const raw = load<Record<string, unknown>>("group-admin.json");
    const group = normalizeGroup(raw)!;
    const participants = normalizeParticipants(group.id, raw);
    expect(participants.length).toBeGreaterThan(0);
    for (const person of participants) expect(person.amount).not.toBeNull();
  });

  test("o detalhe de MEMBRO também traz participantes, ao contrário do documentado", () => {
    // A especificação dizia que `participantes[]` só existe em `grupo/admin`.
    // Existe nos dois, com o mesmo conjunto de campos — quem divide uma
    // assinatura enxerga com quem divide.
    const raw = load<Record<string, unknown>>("group-member.json");
    expect(normalizeGroup(raw)!.id).toBeGreaterThan(0);
    const participants = normalizeParticipants(1, raw);
    expect(participants.length).toBeGreaterThan(0);
    expect(participants[0]!.amount).not.toBeNull();
  });

  test("grupo encerrado é HTTP 400 com a mensagem que nomeia o motivo", () => {
    const closed = load<{ error?: string }>("group-closed.json");
    expect(closed.error).toContain("400");
    expect(closed.error).toMatch(/não está mais disponível/i);
  });
});

describe("créditos reais", () => {
  const active = load<Array<Record<string, unknown>>>("credits-active.json");
  const history = load<Array<Record<string, unknown>>>("credits-history.json");

  test("as duas metades do razão são conjuntos disjuntos", () => {
    const ids = new Set(active.map((raw) => raw.id));
    expect(history.some((raw) => ids.has(raw.id))).toBe(false);
  });

  test("o valor de face vem zerado; `valorDisponivel` é a cifra que existe", () => {
    for (const raw of history) expect(raw.valor4Casas).toBe(0);
    const withValue = active.map((raw) => normalizeCredit(raw)!).filter((c) => c.available !== null);
    expect(withValue.length).toBeGreaterThan(0);
    expect(withValue.every((credit) => credit.amount === 0)).toBe(true);
  });

  test("`grupoId` vem null no repasse; o id sai da descrição", () => {
    const transfers = active.filter((raw) => raw.tipoId === 97);
    expect(transfers.length).toBeGreaterThan(0);
    for (const raw of transfers) {
      expect(raw.grupoId).toBeNull();
      expect(normalizeCredit(raw)!.groupId).toBeGreaterThan(0);
    }
  });

  test("as cauções bloqueadas somam exatamente o saldo bloqueado", () => {
    // A invariante que provou que o modelo de dinheiro está certo.
    const blocked = active
      .map((raw) => normalizeCredit(raw)!)
      .filter((credit) => credit.typeId === 96 && credit.statusId === 33)
      .reduce((total, credit) => total + (credit.available ?? 0), 0);
    const balance = normalizeBalance(load("balance.json"), load("savings.json"));
    expect(balance.blocked).not.toBeNull();
    expect(blocked).toBe(balance.blocked as number);
    expect(toDecimal(blocked)).toBeGreaterThan(0);
  });
});

describe("recebimentos reais", () => {
  test("o `id` do repasse É o id do grupo", () => {
    const payouts = load<Array<Record<string, unknown>>>("payouts.json");
    const groups = new Set(
      load<Array<Record<string, unknown>>>("groups.json").map((raw) => raw.id),
    );
    const parsed = payouts.map((raw) => normalizePayout(raw)!);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.some((payout) => groups.has(payout.groupId))).toBe(true);
  });

  test("o extrato normaliza e traz valores", () => {
    const entries = load<Array<Record<string, unknown>>>("payout-statement.json");
    const parsed = entries.map((raw) => normalizePayoutEntry(1, raw)).filter(Boolean);
    expect(parsed.length).toBeGreaterThan(0);
  });
});

describe("o repositório não carrega dado pessoal", () => {
  // A guarda procura por PADRÃO, nunca por valor literal: escrever o dado real
  // aqui para conferir que ele sumiu seria justamente publicá-lo.
  const PATTERNS: Array<[string, RegExp]> = [
    ["e-mail", /[\w.+-]+@(?!exemplo\.test)[\w-]+\.[\w.]{2,}/],
    ["CPF", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
    ["telefone", /\b(?:\+55\s?)?\(?\d{2}\)?\s?9\d{4}-?\d{4}\b/],
    ["JWT", /\beyJ[\w-]{8,}\.[\w-]{8,}\./],
    ["CEP", /\b\d{5}-\d{3}\b/],
    ["cartão", /\b(?:\d[ -]?){13,16}\b/],
  ];

  const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));

  test("há fixtures para conferir", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const [label, pattern] of PATTERNS) {
    test(`nenhum fixture contém algo com forma de ${label}`, () => {
      for (const name of files) {
        const text = readFileSync(join(DIR, name), "utf8");
        const hit = pattern.exec(text);
        expect(hit === null ? "" : `${name}: ${hit[0].slice(0, 3)}…`).toBe("");
      }
    });
  }
});

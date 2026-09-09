import { describe, expect, test } from "bun:test";
import {
  INVOICE_SUBJECT,
  normalizeBalance,
  normalizeCredit,
  normalizeGroup,
  normalizeInvoice,
  normalizeParticipants,
  normalizePayout,
  parseSubject,
} from "../src/domain/normalize.js";
import { toDecimal } from "../src/domain/money.js";

// The invoice description is the only surviving record of a subscription once
// its group is cancelled, so the regex that reads it is load-bearing.

describe("parseSubject", () => {
  test("reads product and group id from a real description", () => {
    expect(parseSubject("Fatura grupo SetApp #327356")).toEqual({
      product: "SetApp",
      groupId: 327_356,
    });
  });

  test("keeps a product name that itself contains punctuation and a dash", () => {
    expect(parseSubject("Fatura grupo Claude Max 20× — Poder 20x do PRO #415083")).toEqual({
      product: "Claude Max 20× — Poder 20x do PRO",
      groupId: 415_083,
    });
  });

  test("splits at the LAST '#', so a product with its own '#' survives", () => {
    expect(parseSubject("Fatura grupo Plano #1 da casa #196386")).toEqual({
      product: "Plano #1 da casa",
      groupId: 196_386,
    });
  });

  test("a credit purchase has no product and no group", () => {
    expect(parseSubject("Compra de crédito")).toEqual({ product: null, groupId: null });
    expect(INVOICE_SUBJECT.test("Compra de crédito")).toBe(false);
  });
});

describe("normalizeInvoice", () => {
  const raw = {
    id: 415_083,
    descricao: "Fatura grupo 1Password #196386",
    statusId: 13,
    statusDescricao: "Pago",
    tipoId: 14,
    vencida: false,
    valor: 8.33,
    valor4Casas: 8.3325,
    valorTotal: 8.33,
    valorTotal4Casas: 8.3325,
    valorDesconto: 0,
    dataVencimento: "2026-09-08T00:00:00",
    dataPagamento: "2026-09-08T00:00:00",
    itens: null,
    ehInscricaoEmGrupo: true,
  };

  test("keeps four decimals and reads the day out of the timezone-less ISO", () => {
    const invoice = normalizeInvoice(raw)!;
    expect(invoice.total).toBe(83_325);
    expect(toDecimal(invoice.total as number)).toBe(8.3325);
    expect(invoice.paidDate).toBe("2026-09-08");
    expect(invoice.product).toBe("1Password");
    expect(invoice.groupId).toBe(196_386);
    expect(invoice.status).toBe("Pago");
  });

  test("a row with no id is dropped rather than stored half-parsed", () => {
    expect(normalizeInvoice({ descricao: "sem id" })).toBeNull();
  });

  test("an absent amount stays null; a zero amount stays zero", () => {
    const invoice = normalizeInvoice({ id: 1, descricao: "x", valorDesconto: 0 })!;
    expect(invoice.discount).toBe(0);
    expect(invoice.interest).toBeNull();
    expect(invoice.total).toBeNull();
  });

  test("falls back to the enum when the API omits the status text", () => {
    expect(normalizeInvoice({ id: 1, descricao: "x", statusId: 67 })!.status).toBe("estornado");
    // An unknown code survives as its number instead of crashing the sync.
    expect(normalizeInvoice({ id: 1, descricao: "x", statusId: 88 })!.status).toBe("88");
  });
});

describe("normalizeGroup", () => {
  test("merges the listing flag with the detail fields", () => {
    const group = normalizeGroup({
      id: 397_075,
      nome: "Google One",
      servico: "Google One",
      inAdministrador: true,
      valor: 8.33,
      valorTotalServico: 33.32,
      kotasTotais: 4,
      kotasAssinadas: 4,
      statusId: 4,
      plano: "2 TB",
      formaAcessoId: 240,
      dataCadastro: "2025-01-10T00:00:00",
    })!;
    expect(group.isAdministrator).toBe(true);
    expect(group.amount).toBe(83_300);
    expect(group.serviceTotal).toBe(333_200);
    expect(group.slotsFree).toBe(0);
    expect(group.status).toBe("ativo");
    expect(group.accessMethod).toBe("convite");
    expect(group.joinedAt).toBe("2025-01-10");
  });

  test("participants keep their own share, which is what reconciles the split", () => {
    const participants = normalizeParticipants(397_075, {
      participantes: [
        { nome: "A", valor4Casas: 8.33, qtdKotas: 1, dataInscricao: "2025-02-01T00:00:00" },
        { nome: "B", valor: 8.33, qtdKotas: 1 },
      ],
    });
    expect(participants).toHaveLength(2);
    expect(participants[0]!.amount).toBe(83_300);
    expect(participants[0]!.joinedAt).toBe("2025-02-01");
    expect(participants[1]!.waitingList).toBe(false);
  });
});

describe("normalizeCredit and friends", () => {
  test("the credit type gets the meaning the API never sends", () => {
    const credit = normalizeCredit({
      id: 1,
      descricao: "Recebimento adm. grupo #397075",
      tipoId: 97,
      statusId: 34,
      valor4Casas: 33.32,
      dataCredito: "2026-09-08T00:00:00",
      grupoId: 397_075,
    })!;
    expect(credit.type).toBe("repasseAdministrador");
    expect(credit.typeLabel).toContain("Repasse recebido");
    expect(credit.status).toBe("disponivel");
    expect(credit.amount).toBe(333_200);
  });

  test("the deposit type is the one that shows up as blocked balance", () => {
    expect(normalizeCredit({ id: 2, tipoId: 96 })!.type).toBe("caucaoDaInscricao");
  });

  test("the group is read from the description, because `grupoId` comes back null", () => {
    // Verified against the real account: every type-97 row has grupoId: null
    // and carries the id only in the text.
    const credit = normalizeCredit({
      id: 3,
      tipoId: 97,
      descricao: "Recebimento adm. grupo #397075",
      grupoId: null,
      valorDisponivel4Casas: 33.32,
    })!;
    expect(credit.groupId).toBe(397_075);
    expect(credit.available).toBe(333_200);
  });

  test("the listing zeroes the face value, so `available` is the figure that exists", () => {
    const credit = normalizeCredit({
      id: 4,
      tipoId: 96,
      descricao: "Inscrição em grupo cod. #442840",
      valor4Casas: 0,
      valorDisponivel4Casas: 23.2,
    })!;
    expect(credit.amount).toBe(0);
    expect(credit.available).toBe(232_000);
  });

  test("balance merges the savings call, which is a separate endpoint", () => {
    const balance = normalizeBalance(
      { valorDisponivel: 54.35, valorBloqueado: 42.91, valorPendente: 0 },
      { valorEconomizado: 16_303.92 },
    );
    expect(toDecimal(balance.available as number)).toBe(54.35);
    expect(toDecimal(balance.blocked as number)).toBe(42.91);
    expect(balance.pending).toBe(0);
    expect(toDecimal(balance.saved as number)).toBe(16_303.92);
  });

  test("a payout's `id` IS the group id — there is no payout id", () => {
    const payout = normalizePayout({
      id: 397_075,
      descricao: "Grupo Google One",
      vl_kota_membro: 8.33,
      valor4Casas: 33.32,
      statusId: 4,
      dataProximoPagamento: "2026-09-21T00:00:00",
    })!;
    expect(payout.groupId).toBe(397_075);
    expect(payout.memberShare).toBe(83_300);
    expect(payout.status).toBe("agendado");
    expect(payout.nextPaymentDate).toBe("2026-09-21");
  });
});

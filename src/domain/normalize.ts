import { toDay } from "./dates.js";
import {
  accessMethodOf,
  creditStatusOf,
  creditTypeOf,
  CREDIT_TYPE_LABEL,
  groupStatusOf,
  INVOICE_TYPE,
  invoiceStatusOf,
  labelOf,
  payoutStatusOf,
} from "./enums.js";
import { pickUnits, toUnits } from "./money.js";
import type {
  Balance,
  Credit,
  Group,
  GroupParticipant,
  Invoice,
  InvoiceItem,
  InvoiceSubject,
  Payout,
  PayoutEntry,
} from "./types.js";
import type {
  RawBalance,
  RawCredit,
  RawGroupDetail,
  RawGroupSummary,
  RawInvoice,
  RawInvoiceItem,
  RawPayout,
  RawPayoutEntry,
  RawSavings,
} from "../kotas/types.js";

// The ONLY file that knows Kotas field names. Everything above it works on the
// domain model, so when the API renames something exactly one file changes.

/**
 * The invoice description is the whole history: a cancelled group disappears
 * from the API (`grupo/membro/{id}` answers 400), so the product name and the
 * group id survive only here (spec §4.2).
 *
 *   "Fatura grupo Claude Max 20× — Poder 20x do PRO #415083"
 *
 * Greedy on the product so a service whose own name contains a "#" still splits
 * at the LAST one, which is the id ("Plano #1 da casa #196386").
 */
export const INVOICE_SUBJECT = /^Fatura grupo\s+(?<product>.+)\s+#(?<groupId>\d+)\s*$/;

export function parseSubject(description: string): InvoiceSubject {
  const match = INVOICE_SUBJECT.exec(description.trim());
  if (!match?.groups) return { product: null, groupId: null };
  const groupId = Number(match.groups.groupId);
  return {
    product: match.groups.product?.trim() || null,
    groupId: Number.isSafeInteger(groupId) ? groupId : null,
  };
}

/**
 * Credits reference their group in the description, not in a field: `grupoId`
 * comes back null on every transfer (type 97) and on some deposits, while the
 * text always carries "#<id>" (verified against the real account).
 */
export const GROUP_IN_TEXT = /#(\d+)/;

export function groupIdFrom(description: string): number | null {
  const match = GROUP_IN_TEXT.exec(description);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const bool = (value: unknown): boolean => value === true;

export function normalizeInvoice(raw: RawInvoice): Invoice | null {
  const id = num(raw.id);
  if (id === null) return null;
  const description = str(raw.descricao) ?? "";
  const statusId = num(raw.statusId);
  const typeId = num(raw.tipoId);
  return {
    id,
    description,
    ...parseSubject(description),
    statusId,
    status: str(raw.statusDescricao) ?? invoiceStatusOf(statusId),
    typeId,
    type:
      str(raw.tipoDescricao) ?? labelOf(INVOICE_TYPE as unknown as Record<number, string>, typeId),
    overdue: bool(raw.vencida),
    amount: pickUnits(raw.valor4Casas, raw.valor),
    interest: pickUnits(raw.valorJuros4Casas, raw.valorJuros),
    surcharge: pickUnits(raw.valorReajuste4Casas, raw.valorReajuste),
    discount: pickUnits(raw.valorDesconto4Casas, raw.valorDesconto),
    fee: toUnits(raw.valorTaxa),
    // `valorTotal` is what actually left the account: amount + interest +
    // surcharge − discount. It is the only figure that should ever be summed.
    total: pickUnits(raw.valorTotal4Casas, raw.valorTotal) ?? pickUnits(raw.valor4Casas, raw.valor),
    dueDate: toDay(raw.dataVencimento) ?? toDay(raw.dataVencimentoFormatada),
    paidDate: toDay(raw.dataPagamento) ?? toDay(raw.dataPagamentoFormatada),
    isGroupSubscription: bool(raw.ehInscricaoEmGrupo),
    gatewayId: num(raw.idGatewayPagamento),
  };
}

export function normalizeInvoiceItems(
  invoiceId: number,
  raws: readonly RawInvoiceItem[],
): InvoiceItem[] {
  return raws.map((raw, position) => ({
    invoiceId,
    position,
    id: num(raw.id),
    description: str(raw.descricao) ?? "",
    quantity: num(raw.quantidade) ?? 1,
    amount: pickUnits(raw.valor4Casas, raw.valor),
  }));
}

/**
 * Merges the listing row and, when present, the detail. The listing is the only
 * source for some fields (`inAdministrador`), the detail for others (`plano`,
 * the split breakdown), so neither alone is enough.
 */
export function normalizeGroup(raw: RawGroupSummary | RawGroupDetail): Group | null {
  const id = num(raw.id);
  if (id === null) return null;
  const detail = raw as RawGroupDetail;
  const statusId = num(raw.statusId);
  const slotsTotal = num(raw.kotasTotais);
  const slotsTaken = num(raw.kotasAssinadas);
  return {
    id,
    name: str(raw.nome) ?? str(raw.servico) ?? `Grupo #${id}`,
    service: str(raw.servico),
    serviceId: num(raw.servicoId),
    plan: str(detail.plano),
    categoryId: num(raw.idCategoria),
    category: str(detail.categoriaDescricao),
    statusId,
    status: str(raw.status) ?? groupStatusOf(statusId),
    isAdministrator: bool(raw.inAdministrador),
    adminName: str(raw.adminNome),
    amount: pickUnits(raw.valor4Casas, raw.valor),
    serviceTotal: pickUnits(detail.valorTotalServico4Casas, detail.valorTotalServico),
    amountWithoutFee: toUnits(detail.valorSemTaxa),
    fee: toUnits(detail.valorTaxa),
    slotsTotal,
    slotsTaken,
    slotsFree:
      num(raw.kotasDisponiveis) ??
      (slotsTotal !== null && slotsTaken !== null ? slotsTotal - slotsTaken : null),
    loyaltyMonths: num(raw.fidelidade),
    loyaltyEndsAt: toDay(detail.dataTerminoFidelidade),
    autoRenew: detail.renovacaoAutomatica === undefined ? null : bool(detail.renovacaoAutomatica),
    accessMethod: accessMethodOf(detail.formaAcessoId),
    joinedAt: toDay(raw.dataCadastro),
    cancelledAt: toDay(detail.dataCancelamento),
    scheduledCancellation: bool(raw.inCancelamentoAgendado),
    waitingList: bool(raw.inFilaEspera),
    private: bool(raw.privado),
  };
}

export function normalizeParticipants(groupId: number, raw: RawGroupDetail): GroupParticipant[] {
  const list = Array.isArray(raw.participantes) ? raw.participantes : [];
  return list.map((participant, position) => ({
    groupId,
    position,
    name: str(participant.nome),
    amount: pickUnits(participant.valor4Casas, participant.valor),
    slots: num(participant.qtdKotas),
    joinedAt: toDay(participant.dataInscricao),
    accessSentAt: toDay(participant.dataEnvioAcesso),
    leftAt: toDay(participant.dataDescadastro),
    waitingList: bool(participant.inFilaEspera),
  }));
}

export function normalizeCredit(raw: RawCredit): Credit | null {
  const id = num(raw.id);
  if (id === null) return null;
  const description = str(raw.descricao) ?? "";
  const statusId = num(raw.statusId);
  const typeId = num(raw.tipoId);
  // `valor` is 0 on EVERY row of the listing, including the ones still in
  // force; the figure that means something is `valorDisponivel`, and it is
  // what adds up to the balance the wallet reports. The face value only exists
  // in `credito/extrato`, one request per credit.
  const available = pickUnits(raw.valorDisponivel4Casas, raw.valorDisponivel);
  return {
    id,
    description,
    statusId,
    status: str(raw.statusDescricao) ?? creditStatusOf(statusId),
    typeId,
    type: creditTypeOf(typeId),
    typeLabel: typeId === null ? null : (CREDIT_TYPE_LABEL[typeId] ?? null),
    amount: pickUnits(raw.valor4Casas, raw.valor),
    available,
    fee: toUnits(raw.taxa),
    creditedAt: toDay(raw.dataCredito) ?? toDay(raw.dataCreditoFormatada),
    invoiceId: num(raw.faturaId),
    groupId: num(raw.grupoId) ?? groupIdFrom(description),
    refundable: bool(raw.disponivelParaEstorno),
  };
}

export function normalizeBalance(raw: RawBalance, savings: RawSavings | null): Balance {
  return {
    available: pickUnits(raw.valorDisponivel4Casas, raw.valorDisponivel),
    blocked: pickUnits(raw.valorBloqueado4Casas, raw.valorBloqueado),
    pending: pickUnits(raw.valorPendente4Casas, raw.valorPendente),
    saved: savings ? toUnits(savings.valorEconomizado) : null,
  };
}

/** In `recebimento/obtergrupos`, `id` IS the group id — there is no payout id. */
export function normalizePayout(raw: RawPayout): Payout | null {
  const groupId = num(raw.id);
  if (groupId === null) return null;
  const statusId = num(raw.statusId);
  return {
    groupId,
    description: str(raw.descricao) ?? `Grupo #${groupId}`,
    amount: pickUnits(raw.valor4Casas, raw.valor),
    memberShare: toUnits(raw.vl_kota_membro),
    statusId,
    status: str(raw.status) ?? payoutStatusOf(statusId),
    nextPaymentDate: toDay(raw.dataProximoPagamento) ?? toDay(raw.dataProximoPagamentoFormatada),
  };
}

export function normalizePayoutEntry(groupId: number, raw: RawPayoutEntry): PayoutEntry | null {
  const id = num(raw.id);
  if (id === null) return null;
  const statusId = num(raw.statusId);
  return {
    groupId,
    id,
    description: str(raw.descricao) ?? "",
    participant: str(raw.participante),
    amount: pickUnits(raw.valor4Casas, raw.valor),
    statusId,
    status: str(raw.statusDescricao) ?? payoutStatusOf(statusId),
    date: toDay(raw.data) ?? toDay(raw.dataFormatada),
  };
}

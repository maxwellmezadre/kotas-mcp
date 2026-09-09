// Every numeric enum the Kotas API uses, transcribed from the reverse
// engineering (spec §4). They live in one file because the API sends only the
// number in several payloads, and a wrong guess silently misclassifies money.
//
// Unknown codes are never an error: `labelOf` falls back to the raw number, so
// a new status shows up as `status: 88` instead of crashing a sync.

export const INVOICE_STATUS = {
  11: "pendente",
  13: "pago",
  19: "cancelado",
  63: "atraso",
  67: "estornado",
} as const;

/** The five ids `fatura/obterlista` accepts. It answers `[]` without one. */
export const INVOICE_STATUS_IDS = [11, 13, 19, 63, 67] as const;

/**
 * Statuses that never change again, so the invoice is fetched once and then
 * served from the cache forever.
 */
export const FINAL_INVOICE_STATUS_IDS: readonly number[] = [13, 19, 67];

/** Only a paid invoice is money that left the account. */
export const PAID_STATUS_ID = 13;

export const INVOICE_TYPE = {
  14: "Cobrança",
  37: "Compra de Credito Avulso",
} as const;

export const CREDIT_STATUS = {
  33: "bloqueado",
  34: "disponivel",
  35: "utilizado",
  36: "estornado",
  41: "pendentePagamento",
  46: "cancelado",
  65: "sacado",
} as const;

/**
 * What a credit entry means. 96 is the deposit held while the subscription
 * lasts (it shows as blocked balance, not as spend); 97 is what the
 * administrator receives back from the members.
 */
export const CREDIT_TYPE = {
  94: "adicaoDeSaldo",
  96: "caucaoDaInscricao",
  97: "repasseAdministrador",
  98: "estornoCancelamento",
} as const;

export const CREDIT_TYPE_LABEL: Record<number, string> = {
  94: "Adição de saldo",
  96: "Caução da inscrição (fica bloqueado enquanto a assinatura durar)",
  97: "Repasse recebido como administrador",
  98: "Estorno de cancelamento",
};

export const GROUP_STATUS = {
  1: "aguardandoMembros",
  3: "aguardandoAssinatura",
  4: "ativo",
  50: "pendenteAprovacao",
  51: "reprovado",
  52: "assinadoComVagas",
  55: "cancelado",
  68: "aguardandoEdicao",
  69: "aguardandoLiberacao",
  76: "filaEspera",
  77: "cancelamentoAgendado",
  110: "reprovadoAutomaticamente",
  111: "triagem",
} as const;

export const PAYOUT_STATUS = {
  4: "agendado",
  55: "cancelado",
} as const;

export const ACCESS_METHOD = {
  239: "loginSenha",
  240: "convite",
  241: "codigoAtivacao",
  242: "cookie",
  308: "combinar",
} as const;

export const GROUP_TYPE = { 5: "publico", 6: "privado", 999: "personalizado" } as const;
export const PLAN_TYPE = { 0: "comum", 1: "combo" } as const;

/** `{ KOTAS: 1, FACEBOOK: 2, GOOGLE: 3 }` — the login form's `socialAuth`. */
export const SOCIAL_AUTH = { kotas: 1, facebook: 2, google: 3 } as const;

/** `{ semSolicitacao: 0, dispositivo: 1, ip: 2 }` — the 412 challenge kind. */
export const CHALLENGE_KIND = { 0: "semSolicitacao", 1: "dispositivo", 2: "ip" } as const;

/** Looks a code up, falling back to the number so an unknown value survives. */
export function labelOf(table: Record<number, string>, code: unknown): string | null {
  if (code === null || code === undefined) return null;
  const key = Number(code);
  if (!Number.isFinite(key)) return null;
  return table[key] ?? String(key);
}

export const invoiceStatusOf = (code: unknown): string | null =>
  labelOf(INVOICE_STATUS as unknown as Record<number, string>, code);
export const creditStatusOf = (code: unknown): string | null =>
  labelOf(CREDIT_STATUS as unknown as Record<number, string>, code);
export const creditTypeOf = (code: unknown): string | null =>
  labelOf(CREDIT_TYPE as unknown as Record<number, string>, code);
export const groupStatusOf = (code: unknown): string | null =>
  labelOf(GROUP_STATUS as unknown as Record<number, string>, code);
export const payoutStatusOf = (code: unknown): string | null =>
  labelOf(PAYOUT_STATUS as unknown as Record<number, string>, code);
export const accessMethodOf = (code: unknown): string | null =>
  labelOf(ACCESS_METHOD as unknown as Record<number, string>, code);

export const isFinalInvoice = (statusId: number | null): boolean =>
  statusId !== null && FINAL_INVOICE_STATUS_IDS.includes(statusId);

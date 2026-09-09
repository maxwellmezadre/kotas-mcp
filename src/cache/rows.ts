import { money, type Money } from "../domain/money.js";

// Cache rows -> tool output. This is the ONLY place integer units become
// decimals, so nothing inside the system ever does float arithmetic on money.
// The row shapes live here too: they are the schema's projection, and the
// conversion is the only thing that ever reads them field by field.

export type InvoiceRow = {
  id: number;
  description: string;
  product: string | null;
  group_id: number | null;
  status_id: number | null;
  status: string | null;
  type_id: number | null;
  type: string | null;
  overdue: number;
  amount_units: number | null;
  interest_units: number | null;
  surcharge_units: number | null;
  discount_units: number | null;
  fee_units: number | null;
  total_units: number | null;
  due_date: string | null;
  paid_date: string | null;
  is_group_subscription: number;
  gateway_id: number | null;
  item_count: number;
  detail_fetched_at: string | null;
  detail_error: string | null;
};

export type InvoiceItemRow = {
  invoice_id: number;
  position: number;
  item_id: number | null;
  description: string;
  quantity: number;
  amount_units: number | null;
};

export type GroupRow = {
  id: number;
  name: string;
  service: string | null;
  service_id: number | null;
  plan: string | null;
  category: string | null;
  status_id: number | null;
  status: string | null;
  is_administrator: number;
  admin_name: string | null;
  amount_units: number | null;
  service_total_units: number | null;
  amount_without_fee_units: number | null;
  fee_units: number | null;
  slots_total: number | null;
  slots_taken: number | null;
  slots_free: number | null;
  loyalty_months: number | null;
  loyalty_ends_at: string | null;
  auto_renew: number | null;
  access_method: string | null;
  joined_at: string | null;
  cancelled_at: string | null;
  scheduled_cancellation: number;
  waiting_list: number;
  private: number;
  detail_fetched_at: string | null;
  detail_error: string | null;
};

export type ParticipantRow = {
  group_id: number;
  position: number;
  name: string | null;
  amount_units: number | null;
  slots: number | null;
  joined_at: string | null;
  access_sent_at: string | null;
  left_at: string | null;
  waiting_list: number;
};

export type CreditRow = {
  id: number;
  description: string;
  status_id: number | null;
  status: string | null;
  type_id: number | null;
  type: string | null;
  type_label: string | null;
  amount_units: number | null;
  available_units: number | null;
  fee_units: number | null;
  credited_at: string | null;
  invoice_id: number | null;
  group_id: number | null;
  refundable: number;
};

export type PayoutRow = {
  group_id: number;
  description: string;
  amount_units: number | null;
  member_share_units: number | null;
  status_id: number | null;
  status: string | null;
  next_payment_date: string | null;
};

export type PayoutEntryRow = {
  group_id: number;
  entry_id: number;
  description: string;
  participant: string | null;
  amount_units: number | null;
  status_id: number | null;
  status: string | null;
  date: string | null;
};

const yes = (value: number | null | undefined): boolean => value === 1;

export type InvoiceOut = {
  id: number;
  description: string;
  product: string | null;
  groupId: number | null;
  status: string | null;
  statusId: number | null;
  type: string | null;
  overdue: boolean;
  /** What actually left the account. The figure to sum. */
  total: Money | null;
  amount?: Money | null;
  interest?: Money | null;
  discount?: Money | null;
  fee?: Money | null;
  dueDate: string | null;
  paidDate: string | null;
  itemCount?: number;
  detailError?: string;
};

export function invoiceOut(row: InvoiceRow, compact = false): InvoiceOut {
  const base: InvoiceOut = {
    id: row.id,
    description: row.description,
    product: row.product,
    groupId: row.group_id,
    status: row.status,
    statusId: row.status_id,
    type: row.type,
    overdue: yes(row.overdue),
    total: money(row.total_units),
    dueDate: row.due_date,
    paidDate: row.paid_date,
  };
  if (compact) return base;
  return {
    ...base,
    amount: money(row.amount_units),
    interest: money(row.interest_units),
    discount: money(row.discount_units),
    fee: money(row.fee_units),
    itemCount: row.item_count,
    ...(row.detail_error ? { detailError: row.detail_error } : {}),
  };
}

export function invoiceItemOut(row: InvoiceItemRow) {
  return {
    position: row.position,
    description: row.description,
    quantity: row.quantity,
    amount: money(row.amount_units),
  };
}

export function groupOut(row: GroupRow, compact = false) {
  const base = {
    id: row.id,
    name: row.name,
    service: row.service,
    plan: row.plan,
    status: row.status,
    isAdministrator: yes(row.is_administrator),
    /** What this user pays per cycle. */
    amount: money(row.amount_units),
    slots: { total: row.slots_total, taken: row.slots_taken, free: row.slots_free },
  };
  if (compact) return base;
  return {
    ...base,
    category: row.category,
    adminName: row.admin_name,
    /** Full price of the subscription, before the split. */
    serviceTotal: money(row.service_total_units),
    amountWithoutFee: money(row.amount_without_fee_units),
    fee: money(row.fee_units),
    loyaltyMonths: row.loyalty_months,
    loyaltyEndsAt: row.loyalty_ends_at,
    autoRenew: row.auto_renew === null ? null : yes(row.auto_renew),
    accessMethod: row.access_method,
    joinedAt: row.joined_at,
    cancelledAt: row.cancelled_at,
    scheduledCancellation: yes(row.scheduled_cancellation),
    waitingList: yes(row.waiting_list),
    private: yes(row.private),
    ...(row.detail_error ? { detailError: row.detail_error } : {}),
  };
}

export function participantOut(row: ParticipantRow) {
  return {
    name: row.name,
    amount: money(row.amount_units),
    slots: row.slots,
    joinedAt: row.joined_at,
    accessSentAt: row.access_sent_at,
    leftAt: row.left_at,
    waitingList: yes(row.waiting_list),
  };
}

export function creditOut(row: CreditRow) {
  return {
    id: row.id,
    description: row.description,
    status: row.status,
    type: row.type,
    /** Plain-language meaning of `tipoId`, which the API does not send. */
    meaning: row.type_label,
    amount: money(row.amount_units),
    available: money(row.available_units),
    creditedAt: row.credited_at,
    invoiceId: row.invoice_id,
    groupId: row.group_id,
    refundable: yes(row.refundable),
  };
}

export function payoutOut(row: PayoutRow) {
  return {
    groupId: row.group_id,
    description: row.description,
    /** The whole cycle transfer to the administrator. */
    amount: money(row.amount_units),
    /** What each member pays into it. */
    memberShare: money(row.member_share_units),
    status: row.status,
    nextPaymentDate: row.next_payment_date,
  };
}

export function payoutEntryOut(row: PayoutEntryRow) {
  return {
    id: row.entry_id,
    description: row.description,
    participant: row.participant,
    amount: money(row.amount_units),
    status: row.status,
    date: row.date,
  };
}

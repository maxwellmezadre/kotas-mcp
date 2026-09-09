// The domain model. Money is integer units (see money.ts), dates are
// `YYYY-MM-DD` strings, and every field the API may omit is explicitly
// nullable — the Kotas payloads are wide and inconsistently filled.

/** What the invoice description says the charge was for. */
export type InvoiceSubject = {
  /** Service name as printed: "Claude Max 20× — Poder 20x do PRO". */
  product: string | null;
  /** Group id embedded in the description; the join key to `groups`. */
  groupId: number | null;
};

export type Invoice = {
  id: number;
  description: string;
  statusId: number | null;
  status: string | null;
  typeId: number | null;
  type: string | null;
  overdue: boolean;
  /** Integer units. `total` is what actually left the account. */
  amount: number | null;
  interest: number | null;
  surcharge: number | null;
  discount: number | null;
  fee: number | null;
  total: number | null;
  dueDate: string | null;
  paidDate: string | null;
  isGroupSubscription: boolean;
  gatewayId: number | null;
} & InvoiceSubject;

export type InvoiceItem = {
  invoiceId: number;
  position: number;
  id: number | null;
  description: string;
  quantity: number;
  amount: number | null;
};

export type Group = {
  id: number;
  name: string;
  service: string | null;
  serviceId: number | null;
  plan: string | null;
  categoryId: number | null;
  category: string | null;
  statusId: number | null;
  status: string | null;
  /** True when the user administers the group rather than only subscribing. */
  isAdministrator: boolean;
  adminName: string | null;
  /** Integer units: what THIS user pays per cycle. */
  amount: number | null;
  /** The full price of the subscription, before the split. */
  serviceTotal: number | null;
  amountWithoutFee: number | null;
  fee: number | null;
  /** Slots: total, taken, free. */
  slotsTotal: number | null;
  slotsTaken: number | null;
  slotsFree: number | null;
  loyaltyMonths: number | null;
  loyaltyEndsAt: string | null;
  autoRenew: boolean | null;
  accessMethod: string | null;
  joinedAt: string | null;
  cancelledAt: string | null;
  scheduledCancellation: boolean;
  waitingList: boolean;
  private: boolean;
};

export type GroupParticipant = {
  groupId: number;
  position: number;
  name: string | null;
  /** Integer units: what this participant pays. */
  amount: number | null;
  slots: number | null;
  joinedAt: string | null;
  accessSentAt: string | null;
  leftAt: string | null;
  waitingList: boolean;
};

export type Credit = {
  id: number;
  description: string;
  statusId: number | null;
  status: string | null;
  typeId: number | null;
  type: string | null;
  typeLabel: string | null;
  amount: number | null;
  available: number | null;
  fee: number | null;
  creditedAt: string | null;
  invoiceId: number | null;
  groupId: number | null;
  refundable: boolean;
};

/** A scheduled transfer to the administrator, one row per administered group. */
export type Payout = {
  groupId: number;
  description: string;
  /** Integer units: the whole cycle transfer. */
  amount: number | null;
  /** What each member pays into it. */
  memberShare: number | null;
  statusId: number | null;
  status: string | null;
  nextPaymentDate: string | null;
};

export type PayoutEntry = {
  groupId: number;
  id: number;
  description: string;
  participant: string | null;
  amount: number | null;
  statusId: number | null;
  status: string | null;
  date: string | null;
};

export type Balance = {
  available: number | null;
  blocked: number | null;
  pending: number | null;
  /** Lifetime savings, as the Kotas computes it. */
  saved: number | null;
};

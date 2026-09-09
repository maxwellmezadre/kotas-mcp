import type { Database } from "bun:sqlite";
import type { Group, Invoice } from "../domain/types.js";

// The SQL the repository runs, kept apart so repo.ts reads as an API instead of
// as a wall of statements.
//
// Every upsert COALESCEs the columns a listing may not carry: the invoice
// listing sends `itens: null` and drops the paid date on a pending row, so a
// second pass over the same invoice must never erase a detail already fetched.

const flag = (value: boolean): number => (value ? 1 : 0);

export function prepareStatements(db: Database, stamp: () => string) {
  const upsertInvoiceStmt = db.prepare(`
    INSERT INTO invoices (
      id, description, product, group_id, status_id, status, type_id, type, overdue,
      amount_units, interest_units, surcharge_units, discount_units, fee_units, total_units,
      due_date, paid_date, is_group_subscription, gateway_id, raw_list, parser_version, updated_at
    ) VALUES (
      $id, $description, $product, $group_id, $status_id, $status, $type_id, $type, $overdue,
      $amount_units, $interest_units, $surcharge_units, $discount_units, $fee_units, $total_units,
      $due_date, $paid_date, $is_group_subscription, $gateway_id, $raw_list, $parser_version, $updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      description = excluded.description,
      product = COALESCE(excluded.product, invoices.product),
      group_id = COALESCE(excluded.group_id, invoices.group_id),
      status_id = COALESCE(excluded.status_id, invoices.status_id),
      status = COALESCE(excluded.status, invoices.status),
      type_id = COALESCE(excluded.type_id, invoices.type_id),
      type = COALESCE(excluded.type, invoices.type),
      overdue = excluded.overdue,
      amount_units = COALESCE(excluded.amount_units, invoices.amount_units),
      interest_units = COALESCE(excluded.interest_units, invoices.interest_units),
      surcharge_units = COALESCE(excluded.surcharge_units, invoices.surcharge_units),
      discount_units = COALESCE(excluded.discount_units, invoices.discount_units),
      fee_units = COALESCE(excluded.fee_units, invoices.fee_units),
      total_units = COALESCE(excluded.total_units, invoices.total_units),
      due_date = COALESCE(excluded.due_date, invoices.due_date),
      paid_date = COALESCE(excluded.paid_date, invoices.paid_date),
      is_group_subscription = excluded.is_group_subscription,
      gateway_id = COALESCE(excluded.gateway_id, invoices.gateway_id),
      raw_list = COALESCE(excluded.raw_list, invoices.raw_list),
      parser_version = excluded.parser_version,
      updated_at = excluded.updated_at
  `);

  const upsertGroupStmt = db.prepare(`
    INSERT INTO groups (
      id, name, service, service_id, plan, category_id, category, status_id, status,
      is_administrator, admin_name, amount_units, service_total_units,
      amount_without_fee_units, fee_units, slots_total, slots_taken, slots_free,
      loyalty_months, loyalty_ends_at, auto_renew, access_method, joined_at, cancelled_at,
      scheduled_cancellation, waiting_list, private, raw_summary, updated_at
    ) VALUES (
      $id, $name, $service, $service_id, $plan, $category_id, $category, $status_id, $status,
      $is_administrator, $admin_name, $amount_units, $service_total_units,
      $amount_without_fee_units, $fee_units, $slots_total, $slots_taken, $slots_free,
      $loyalty_months, $loyalty_ends_at, $auto_renew, $access_method, $joined_at, $cancelled_at,
      $scheduled_cancellation, $waiting_list, $private, $raw_summary, $updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      service = COALESCE(excluded.service, groups.service),
      service_id = COALESCE(excluded.service_id, groups.service_id),
      plan = COALESCE(excluded.plan, groups.plan),
      category_id = COALESCE(excluded.category_id, groups.category_id),
      category = COALESCE(excluded.category, groups.category),
      status_id = COALESCE(excluded.status_id, groups.status_id),
      status = COALESCE(excluded.status, groups.status),
      is_administrator = excluded.is_administrator,
      admin_name = COALESCE(excluded.admin_name, groups.admin_name),
      amount_units = COALESCE(excluded.amount_units, groups.amount_units),
      service_total_units = COALESCE(excluded.service_total_units, groups.service_total_units),
      amount_without_fee_units =
        COALESCE(excluded.amount_without_fee_units, groups.amount_without_fee_units),
      fee_units = COALESCE(excluded.fee_units, groups.fee_units),
      slots_total = COALESCE(excluded.slots_total, groups.slots_total),
      slots_taken = COALESCE(excluded.slots_taken, groups.slots_taken),
      slots_free = COALESCE(excluded.slots_free, groups.slots_free),
      loyalty_months = COALESCE(excluded.loyalty_months, groups.loyalty_months),
      loyalty_ends_at = COALESCE(excluded.loyalty_ends_at, groups.loyalty_ends_at),
      auto_renew = COALESCE(excluded.auto_renew, groups.auto_renew),
      access_method = COALESCE(excluded.access_method, groups.access_method),
      joined_at = COALESCE(excluded.joined_at, groups.joined_at),
      cancelled_at = COALESCE(excluded.cancelled_at, groups.cancelled_at),
      scheduled_cancellation = excluded.scheduled_cancellation,
      waiting_list = excluded.waiting_list,
      private = excluded.private,
      raw_summary = COALESCE(excluded.raw_summary, groups.raw_summary),
      updated_at = excluded.updated_at
  `);

  const invoiceParams = (invoice: Invoice, raw: string | null, parserVersion: number) => ({
    $id: invoice.id,
    $description: invoice.description,
    $product: invoice.product,
    $group_id: invoice.groupId,
    $status_id: invoice.statusId,
    $status: invoice.status,
    $type_id: invoice.typeId,
    $type: invoice.type,
    $overdue: flag(invoice.overdue),
    $amount_units: invoice.amount,
    $interest_units: invoice.interest,
    $surcharge_units: invoice.surcharge,
    $discount_units: invoice.discount,
    $fee_units: invoice.fee,
    $total_units: invoice.total,
    $due_date: invoice.dueDate,
    $paid_date: invoice.paidDate,
    $is_group_subscription: flag(invoice.isGroupSubscription),
    $gateway_id: invoice.gatewayId,
    $raw_list: raw,
    $parser_version: parserVersion,
    $updated_at: stamp(),
  });

  const groupParams = (group: Group, raw: string | null) => ({
    $id: group.id,
    $name: group.name,
    $service: group.service,
    $service_id: group.serviceId,
    $plan: group.plan,
    $category_id: group.categoryId,
    $category: group.category,
    $status_id: group.statusId,
    $status: group.status,
    $is_administrator: flag(group.isAdministrator),
    $admin_name: group.adminName,
    $amount_units: group.amount,
    $service_total_units: group.serviceTotal,
    $amount_without_fee_units: group.amountWithoutFee,
    $fee_units: group.fee,
    $slots_total: group.slotsTotal,
    $slots_taken: group.slotsTaken,
    $slots_free: group.slotsFree,
    $loyalty_months: group.loyaltyMonths,
    $loyalty_ends_at: group.loyaltyEndsAt,
    $auto_renew: group.autoRenew === null ? null : flag(group.autoRenew),
    $access_method: group.accessMethod,
    $joined_at: group.joinedAt,
    $cancelled_at: group.cancelledAt,
    $scheduled_cancellation: flag(group.scheduledCancellation),
    $waiting_list: flag(group.waitingList),
    $private: flag(group.private),
    $raw_summary: raw,
    $updated_at: stamp(),
  });

  return { upsertInvoiceStmt, upsertGroupStmt, invoiceParams, groupParams };
}

export type Statements = ReturnType<typeof prepareStatements>;

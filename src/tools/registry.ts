import type { Config } from "../config.js";
import { purchaseHistory, spendingSummary } from "./analytics.js";
import { authStatus } from "./auth.js";
import { balance, listCredits } from "./credits.js";
import type { ToolDef } from "./define.js";
import { doctor } from "./doctor.js";
import { exportData } from "./export.js";
import { getInvoice, listInvoices } from "./invoices.js";
import { login } from "./login.js";
import { listPayouts } from "./payouts.js";
import { rawGet } from "./raw.js";
import { searchServices } from "./services.js";
import { getSubscription, listSubscriptions } from "./subscriptions.js";
import { sync } from "./sync.js";

// Flat registry shared by the MCP server and the CLI: the two surfaces cannot
// drift, because they resolve tools from this same array. The order here is the
// order clients see.
export const allTools: ToolDef[] = [
  // Session and diagnostics
  authStatus,
  login,
  doctor,
  // Cache
  sync,
  // Subscriptions
  listSubscriptions,
  getSubscription,
  // Money
  listInvoices,
  getInvoice,
  listCredits,
  balance,
  listPayouts,
  // Analytics
  purchaseHistory,
  spendingSummary,
  // Catalogue
  searchServices,
  exportData,
  // Escape hatch
  rawGet,
];

/**
 * Read-only mode: the tools that persist something (session, cache, files) are
 * simply not registered. A structural guarantee, not a runtime check.
 */
export function activeTools(config: Pick<Config, "readOnly">): ToolDef[] {
  return config.readOnly ? allTools.filter((tool) => tool.readOnly) : allTools;
}

export function toolByName(name: string): ToolDef | undefined {
  return allTools.find((tool) => tool.name === name);
}

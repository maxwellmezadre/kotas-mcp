#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";

// Captures the raw responses of the real account into task/captures/, which is
// gitignored. Nothing here reaches the repository: `scripts/anonymize-fixture.ts`
// is the only path from a capture to a committed fixture.
//
// Read-only and paced by the same funnel as everything else. About 15 requests.

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "task", "captures");

type Capture = { name: string; run: () => Promise<unknown> };

const ctx = createContext(loadConfig());

/** A closed group answers HTTP 400 — the error body is a fixture too. */
async function expectFailure(path: string): Promise<unknown> {
  try {
    const data = await ctx.api.getRaw(path);
    return { note: "não falhou", data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  mkdirSync(OUT, { recursive: true, mode: 0o700 });

  const paid = (await ctx.api.listInvoices(13, 1, 10)).items;
  const groups = (await ctx.api.listGroups(0, 10)).items;
  const payouts = (await ctx.api.listPayouts(0, 10)).items;

  const firstInvoice = paid[0]?.id ?? null;
  const admin = groups.find((group) => group.inAdministrador === true);
  const member = groups.find((group) => group.inAdministrador !== true);
  // A cancelled payout points at a group that no longer exists: the real
  // HTTP 400 case, which an invented id does NOT reproduce (it answers 500).
  const closedGroup = payouts.find((payout) => payout.statusId === 55)?.id ?? null;
  const payoutGroup = payouts[0]?.id ?? null;

  const captures: Capture[] = [
    { name: "invoices-paid.json", run: async () => paid },
    { name: "invoices-cancelled.json", run: async () => (await ctx.api.listInvoices(19, 1, 10)).items },
    { name: "groups.json", run: async () => groups },
    { name: "balance.json", run: () => ctx.api.getBalance() },
    { name: "savings.json", run: () => ctx.api.getSavings() },
    { name: "credits-active.json", run: async () => (await ctx.api.listCredits(1, 10, true)).items },
    { name: "credits-history.json", run: async () => (await ctx.api.listCredits(1, 10, false)).items },
    { name: "payouts.json", run: async () => payouts },
    { name: "services.json", run: () => ctx.api.searchServices("spotify") },
    ...(closedGroup === null
      ? []
      : // A subscription that no longer exists: the HTTP 400 the parsers must
        // recognise as "encerrado", not as a bug.
        [{ name: "group-closed.json", run: () => expectFailure(`grupo/membro/${closedGroup}`) }]),
  ];

  if (firstInvoice !== null) {
    captures.push({
      name: "invoice-statement.json",
      run: () => ctx.api.getInvoiceItems(firstInvoice),
    });
  }
  if (admin?.id !== undefined) {
    captures.push({ name: "group-admin.json", run: () => ctx.api.getGroup(admin.id as number, "admin") });
  }
  if (member?.id !== undefined) {
    captures.push({ name: "group-member.json", run: () => ctx.api.getGroup(member.id as number, "member") });
  }
  if (payoutGroup !== null) {
    captures.push({
      name: "payout-statement.json",
      run: () => ctx.api.getPayoutStatement(payoutGroup),
    });
  }

  for (const capture of captures) {
    let payload: unknown;
    try {
      payload = await capture.run();
    } catch (error) {
      console.error(`  ERR ${capture.name}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (write) writeFileSync(join(OUT, capture.name), text, { mode: 0o600 });
    console.error(`  ok  ${capture.name.padEnd(26)} ${text.length} bytes`);
  }

  console.error(
    write
      ? `\nGravado em ${OUT} (fora do git). Agora rode: bun run scripts/anonymize-fixture.ts --write`
      : "\nDry-run. Rode com --write para gravar.",
  );
  ctx.dispose();
}

await main();

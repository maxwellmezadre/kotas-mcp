import { Type } from "@sinclair/typebox";
import { payoutEntryOut, payoutOut } from "../cache/rows.js";
import { money, sumUnits } from "../domain/money.js";
import { compactObject, defineTool } from "./define.js";

// What the account RECEIVES as administrator of a group: the members pay their
// share into the group and the Kotas transfers the total on a schedule.

export const listPayouts = defineTool({
  name: "list_payouts",
  description:
    "Lista os recebimentos como administrador: quanto cada grupo repassa por ciclo, quanto cada membro " +
    "paga e a data do próximo pagamento. Lê o cache, não usa a rede. Com group_id devolve também o " +
    "extrato daquele grupo, participante por participante. Status `Cancelado` significa que o repasse " +
    "não vai mais acontecer — não some no previsto.",
  readOnly: true,
  input: Type.Object({
    group_id: Type.Optional(
      Type.Integer({ minimum: 1, description: "Também traz o extrato deste grupo" }),
    ),
    only_scheduled: Type.Optional(
      Type.Boolean({ description: "Só os repasses agendados (default false)" }),
    ),
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const all = cache.listPayouts();
    const rows = args.only_scheduled ? all.filter((row) => row.status_id === 4) : all;
    const scheduled = all.filter((row) => row.status_id === 4);

    return compactObject({
      total: rows.length,
      /** Only scheduled transfers are money still coming. */
      scheduledTotal: money(sumUnits(scheduled.map((row) => row.amount_units))),
      payouts: rows.map(payoutOut),
      ...(args.group_id
        ? { statement: cache.getPayoutEntries(args.group_id).map(payoutEntryOut) }
        : {}),
      ...(all.length === 0
        ? { note: "Nenhum recebimento no cache. Rode `sync` — ou você não administra nenhum grupo." }
        : {}),
    });
  },
});

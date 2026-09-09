import { Type } from "@sinclair/typebox";
import { purchaseHistory as buildHistory, spendingSummary as summarize } from "../cache/analytics.js";
import { compactObject, defineTool } from "./define.js";
import { dayField } from "./fields.js";

// The two questions that justify the whole project.

export const purchaseHistory = defineTool({
  name: "purchase_history",
  description:
    "Reconstrói a linha do tempo de TODAS as assinaturas já pagas, inclusive as encerradas, a partir " +
    "das faturas — que é a única fonte que sobra, porque um grupo cancelado some da API. Para cada " +
    "produto devolve a primeira e a última fatura, quantos meses foram pagos, o total pago, se ainda " +
    "está ativo, a caução retida e o que foi recebido como administrador. Grupos que o usuário " +
    "ADMINISTRA aparecem com `monthsPaid: 0` e `totalPaid: null`: neles não há fatura, o administrador " +
    "paga o serviço por fora e recebe o rateio dos membros. Não usa a rede.",
  readOnly: true,
  input: Type.Object({
    include_credit_purchases: Type.Optional(
      Type.Boolean({
        description:
          "Inclui as compras de crédito avulso, que não pertencem a nenhum grupo (default false)",
      }),
    ),
    active_only: Type.Optional(
      Type.Boolean({ description: "Só as assinaturas que ainda existem hoje (default false)" }),
    ),
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const all = buildHistory(cache, {
      includeCreditPurchases: args.include_credit_purchases === true,
    });
    const entries = args.active_only ? all.filter((entry) => entry.activeToday) : all;
    return compactObject({
      total: entries.length,
      active: all.filter((entry) => entry.activeToday).length,
      ended: all.filter((entry) => !entry.activeToday).length,
      history: entries,
      ...(all.length === 0 ? { note: "O cache está vazio. Rode `sync` antes de perguntar." } : {}),
    });
  },
});

export const spendingSummary = defineTool({
  name: "spending_summary",
  description:
    "Soma os gastos no Kotas agrupados por mês, ano, produto ou situação. Conta apenas faturas PAGAS " +
    "por padrão: cancelada e estornada não são dinheiro que saiu. Não usa a rede. A data usada é a do " +
    "pagamento e, na falta dela, a do vencimento.",
  readOnly: true,
  input: Type.Object({
    by: Type.Union(
      [Type.Literal("month"), Type.Literal("year"), Type.Literal("product"), Type.Literal("status")],
      { description: "Como agrupar" },
    ),
    from: dayField("Data inicial (YYYY-MM-DD)"),
    to: dayField("Data final (YYYY-MM-DD)"),
    include_unpaid: Type.Optional(
      Type.Boolean({
        description: "Inclui faturas não pagas — só faz sentido com by=status (default false)",
      }),
    ),
  }),
  run: (args, ctx) => {
    const result = summarize(
      ctx.cache(),
      compactObject({
        by: args.by,
        from: args.from,
        to: args.to,
        includeUnpaid: args.include_unpaid === true,
      }),
    );
    return compactObject({
      by: args.by,
      paidOnly: args.include_unpaid !== true,
      total: result.total,
      invoices: result.invoices,
      rows: result.rows,
      ...(result.invoices === 0
        ? { note: "Nenhuma fatura no período. Rode `sync` se o cache estiver vazio." }
        : {}),
    });
  },
});

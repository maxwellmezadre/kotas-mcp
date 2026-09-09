import { Type } from "@sinclair/typebox";
import { DEFAULT_MAX_REQUESTS, runSyncChunk } from "../cache/sync.js";
import { defineTool } from "./define.js";

export const sync = defineTool({
  name: "sync",
  description:
    "Baixa o histórico do Kotas para o cache local. Trabalha em blocos: faz até max_requests chamadas e " +
    "devolve `done: false` com um `hint`. CHAME DE NOVO com os mesmos parâmetros até `done: true`. " +
    "Nunca chame em paralelo nem dispare outras tools de rede junto. Varre as faturas dos cinco status " +
    "(é a única fonte do histórico), depois grupos, créditos e recebimentos. " +
    "`mode: reparse` reprocessa o que já está no cache sem usar a rede.",
  readOnly: false,
  input: Type.Object({
    mode: Type.Optional(
      Type.Union(
        [Type.Literal("incremental"), Type.Literal("full"), Type.Literal("reparse")],
        {
          description:
            "incremental (default depois do primeiro full) para no primeiro bloco sem novidade; full varre tudo; reparse não usa a rede",
        },
      ),
    ),
    max_requests: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 200,
        description: `Orçamento de requisições do bloco (default ${DEFAULT_MAX_REQUESTS})`,
      }),
    ),
    with_groups: Type.Optional(Type.Boolean({ description: "Também sincroniza os grupos (default true)" })),
    with_credits: Type.Optional(Type.Boolean({ description: "Também sincroniza os créditos (default true)" })),
    with_payouts: Type.Optional(
      Type.Boolean({ description: "Também sincroniza os recebimentos de administrador (default true)" }),
    ),
    with_invoice_items: Type.Optional(
      Type.Boolean({ description: "Também busca os itens de cada fatura, 1 requisição por fatura (default true)" }),
    ),
  }),
  run: (args, ctx) =>
    runSyncChunk(ctx, {
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.max_requests === undefined ? {} : { maxRequests: args.max_requests }),
      ...(args.with_groups === undefined ? {} : { withGroups: args.with_groups }),
      ...(args.with_credits === undefined ? {} : { withCredits: args.with_credits }),
      ...(args.with_payouts === undefined ? {} : { withPayouts: args.with_payouts }),
      ...(args.with_invoice_items === undefined
        ? {}
        : { withInvoiceItems: args.with_invoice_items }),
    }),
});

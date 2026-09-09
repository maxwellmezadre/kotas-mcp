import { Type } from "@sinclair/typebox";
import { creditOut } from "../cache/rows.js";
import { CREDIT_TYPE_LABEL } from "../domain/enums.js";
import { money } from "../domain/money.js";
import { normalizeBalance } from "../domain/normalize.js";
import { compactObject, defineTool } from "./define.js";
import { limitField } from "./fields.js";

// The Kotas wallet. Two entry types carry most of the meaning and neither is
// obvious from the payload: type 96 is the deposit held while a subscription
// lasts (it shows as *blocked* balance, and is not spend), and type 97 is the
// transfer an administrator receives back from the members.

export const balance = defineTool({
  name: "balance",
  description:
    "Saldo da carteira Kotas ao vivo (1–2 requisições): disponível, bloqueado (as cauções das " +
    "inscrições) e pendente, mais a economia acumulada que a própria Kotas calcula. O saldo bloqueado " +
    "não é dinheiro perdido: volta quando a assinatura é encerrada.",
  readOnly: true,
  input: Type.Object({
    with_savings: Type.Optional(
      Type.Boolean({ description: "Também busca a economia acumulada (1 requisição extra, default true)" }),
    ),
  }),
  run: async (args, ctx) => {
    const raw = await ctx.api.getBalance();
    const savings = args.with_savings === false ? null : await ctx.api.getSavings().catch(() => null);
    const parsed = normalizeBalance(raw, savings);
    return compactObject({
      available: money(parsed.available),
      blocked: money(parsed.blocked),
      pending: money(parsed.pending),
      saved: money(parsed.saved),
      note: "`blocked` são cauções de inscrição, devolvidas ao encerrar a assinatura.",
    });
  },
});

export const listCredits = defineTool({
  name: "list_credits",
  description:
    "Lista os lançamentos de crédito do cache com o significado de cada tipo traduzido: adição de " +
    "saldo, caução da inscrição (fica bloqueada), repasse recebido como administrador e estorno de " +
    "cancelamento. Não usa a rede. É aqui que aparece o dinheiro que ENTROU — as faturas só mostram o " +
    "que saiu. ATENÇÃO: use `available`, não `amount`. A API zera o valor de face de todo lançamento " +
    "já consumido, então `amount` vem 0 em quase tudo; `available` é a cifra que existe de verdade e " +
    "é a que soma com o saldo da carteira.",
  readOnly: true,
  input: Type.Object({
    kind: Type.Optional(
      Type.Union(
        [
          Type.Literal("adicaoDeSaldo"),
          Type.Literal("caucaoDaInscricao"),
          Type.Literal("repasseAdministrador"),
          Type.Literal("estornoCancelamento"),
        ],
        { description: "Filtra pelo tipo do lançamento" },
      ),
    ),
    limit: limitField(500, 100),
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const typeId = args.kind ? TYPE_BY_NAME[args.kind] : undefined;
    const rows = cache.listCredits(compactObject({ typeId, limit: args.limit ?? 100 }));
    return compactObject({
      total: rows.length,
      credits: rows.map(creditOut),
      legend: CREDIT_TYPE_LABEL,
      note: "Some por `available`: a API zera `amount` depois que o crédito é usado ou sacado.",
      ...(rows.length === 0 && cache.stats().credits === 0
        ? { note: "O cache está vazio. Rode `sync` antes de perguntar." }
        : {}),
    });
  },
});

const TYPE_BY_NAME: Record<string, number> = {
  adicaoDeSaldo: 94,
  caucaoDaInscricao: 96,
  repasseAdministrador: 97,
  estornoCancelamento: 98,
};

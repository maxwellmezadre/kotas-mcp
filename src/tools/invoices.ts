import { Type } from "@sinclair/typebox";
import { invoiceItemOut, invoiceOut } from "../cache/rows.js";
import { normalizeInvoiceItems } from "../domain/normalize.js";
import { compactObject, defineTool } from "./define.js";
import {
  compactField,
  dayField,
  INVOICE_STATUS_BY_NAME,
  invoiceIdField,
  invoiceStatusField,
  limitField,
  offsetField,
} from "./fields.js";

// Invoices are the root of everything: a cancelled group vanishes from the API,
// so `fatura/obterlista` is the only record that a subscription ever existed.

const NO_CACHE = "O cache está vazio. Rode `sync` antes de perguntar.";

export const listInvoices = defineTool({
  name: "list_invoices",
  description:
    "Lista as faturas do Kotas a partir do cache local, da mais recente para a mais antiga. Não usa a " +
    "rede. ATENÇÃO ao somar: só fatura com status `pago` é dinheiro que saiu da conta — cancelada e " +
    "estornada não são gasto. O campo a somar é `total`, nunca `amount`. Use `product` para saber de " +
    "qual assinatura a cobrança era, inclusive de grupos que já foram encerrados.",
  readOnly: true,
  input: Type.Object({
    status: invoiceStatusField,
    from: dayField("Data inicial (YYYY-MM-DD), sobre a data de pagamento ou vencimento"),
    to: dayField("Data final (YYYY-MM-DD)"),
    group_id: Type.Optional(Type.Integer({ minimum: 1, description: "Só as faturas deste grupo" })),
    product: Type.Optional(
      Type.String({ minLength: 1, description: "Nome exato do produto, como aparece em `product`" }),
    ),
    limit: limitField(500, 50),
    offset: offsetField,
    compact: compactField,
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const filters = compactObject({
      statusId: args.status ? INVOICE_STATUS_BY_NAME[args.status] : undefined,
      from: args.from,
      to: args.to,
      groupId: args.group_id,
      product: args.product,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    });
    const rows = cache.listInvoices(filters);
    const total = cache.countInvoices(filters);
    return compactObject({
      total,
      invoices: rows.map((row) => invoiceOut(row, args.compact === true)),
      ...(total === 0 && cache.stats().invoices === 0 ? { note: NO_CACHE } : {}),
    });
  },
});

export const getInvoice = defineTool({
  name: "get_invoice",
  description:
    "Detalha uma fatura, com os itens que a compõem. Lê o cache; se os itens ainda não estiverem lá, " +
    "busca 1 vez na API (`fatura/extrato`), porque a listagem devolve `itens: null`.",
  readOnly: true,
  input: Type.Object({ invoice_id: invoiceIdField }),
  run: async (args, ctx) => {
    const cache = ctx.cache();
    const row = cache.getInvoice(args.invoice_id);
    if (!row) {
      throw new Error(
        `Fatura ${args.invoice_id} não está no cache. Rode \`sync\` — a API não permite buscar uma fatura avulsa pela listagem.`,
      );
    }

    let items = cache.getInvoiceItems(args.invoice_id);
    if (items.length === 0 && row.detail_fetched_at === null) {
      const raw = await ctx.api.getInvoiceItems(args.invoice_id);
      cache.setInvoiceItems(args.invoice_id, normalizeInvoiceItems(args.invoice_id, raw), raw);
      items = cache.getInvoiceItems(args.invoice_id);
    }

    return compactObject({
      invoice: invoiceOut(row),
      items: items.map(invoiceItemOut),
      ...(row.detail_error ? { detailError: row.detail_error } : {}),
    });
  },
});

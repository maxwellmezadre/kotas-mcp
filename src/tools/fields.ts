import { Type } from "@sinclair/typebox";

// Schema fragments shared by several tools, so a description is written once.

export const compactField = Type.Optional(
  Type.Boolean({
    description:
      "Devolve apenas os campos essenciais, para economizar contexto (default KOTAS_COMPACT)",
  }),
);

export const dayField = (description: string) =>
  Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description }));

export const limitField = (max: number, fallback: number) =>
  Type.Optional(
    Type.Integer({ minimum: 1, maximum: max, description: `Máximo de itens (default ${fallback})` }),
  );

export const offsetField = Type.Optional(
  Type.Integer({ minimum: 0, description: "Itens a pular (paginação)" }),
);

export const invoiceIdField = Type.Integer({
  minimum: 1,
  description: "Id da fatura no Kotas, como aparece em `list_invoices`",
});

export const groupIdField = Type.Integer({
  minimum: 1,
  description: "Id do grupo no Kotas, como aparece em `list_subscriptions` ou na descrição da fatura",
});

/** The five ids `fatura/obterlista` accepts, by name so the model need not know the numbers. */
export const invoiceStatusField = Type.Optional(
  Type.Union(
    [
      Type.Literal("pago"),
      Type.Literal("pendente"),
      Type.Literal("cancelado"),
      Type.Literal("atraso"),
      Type.Literal("estornado"),
    ],
    { description: "Filtra por situação da fatura" },
  ),
);

export const INVOICE_STATUS_BY_NAME: Record<string, number> = {
  pendente: 11,
  pago: 13,
  cancelado: 19,
  atraso: 63,
  estornado: 67,
};

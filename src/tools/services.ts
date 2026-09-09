import { Type } from "@sinclair/typebox";
import { money, toUnits } from "../domain/money.js";
import { compactObject, defineTool } from "./define.js";

// Catalogue search: what the Kotas offers, not what the account bought. For
// purchases use `purchase_history` or `list_invoices`.

export const searchServices = defineTool({
  name: "search_services",
  description:
    "Busca serviços no catálogo do Kotas pelo nome (Netflix, Spotify, Google One…) e devolve os planos " +
    "disponíveis com o valor cheio e quantas kotas cada um tem. Gasta 1 requisição. Isto é o CATÁLOGO: " +
    "para o que você já assinou ou pagou, use `purchase_history` ou `list_invoices`.",
  readOnly: true,
  input: Type.Object({
    query: Type.String({ minLength: 2, description: "Nome ou parte do nome do serviço" }),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50, description: "Máximo de serviços (default 10)" }),
    ),
  }),
  run: async (args, ctx) => {
    const services = await ctx.api.searchServices(args.query.trim());
    const limited = services.slice(0, args.limit ?? 10);
    return compactObject({
      total: services.length,
      services: limited.map((service) =>
        compactObject({
          id: service.id,
          name: service.nome,
          category: service.nomeCategoria,
          site: service.site,
          price: money(toUnits(service.valor)),
          slots: service.qtdKotas,
          plans: (service.planos ?? []).map((plan) =>
            compactObject({ id: plan.id, name: plan.nome, price: money(toUnits(plan.valor)) }),
          ),
        }),
      ),
      ...(services.length === 0 ? { note: `Nada encontrado para "${args.query}".` } : {}),
    });
  },
});

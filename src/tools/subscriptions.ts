import { Type } from "@sinclair/typebox";
import { normalizeGroup, normalizeParticipants } from "../domain/normalize.js";
import { groupOut, participantOut } from "../cache/rows.js";
import { compactObject, defineTool } from "./define.js";
import { compactField, groupIdField, limitField } from "./fields.js";

// Subscriptions are what the Kotas calls "grupos": a shared plan with a slot
// (a "kota") per member. The user is a member of some and the administrator of
// others, and the two roles read from different endpoints.

const NO_CACHE = "O cache está vazio. Rode `sync` (ou `kotas sync` no terminal) antes de perguntar.";

export const listSubscriptions = defineTool({
  name: "list_subscriptions",
  description:
    "Lista as assinaturas compartilhadas (grupos) do Kotas a partir do cache local, com o que você paga " +
    "em cada uma, quantas vagas tem e se você é membro ou administrador. Não usa a rede. Só aparecem " +
    "grupos que ainda existem na API: um grupo encerrado some do Kotas e só sobrevive nas faturas — " +
    "para o histórico completo use `purchase_history`.",
  readOnly: true,
  input: Type.Object({
    role: Type.Optional(
      Type.Union([Type.Literal("todos"), Type.Literal("membro"), Type.Literal("administrador")], {
        description: "Filtra pelo seu papel no grupo (default todos)",
      }),
    ),
    limit: limitField(200, 100),
    compact: compactField,
  }),
  run: (args, ctx) => {
    const cache = ctx.cache();
    const options: { administrator?: boolean; limit?: number } = { limit: args.limit ?? 100 };
    if (args.role === "administrador") options.administrator = true;
    if (args.role === "membro") options.administrator = false;
    const rows = cache.listGroups(options);
    return compactObject({
      total: rows.length,
      subscriptions: rows.map((row) => groupOut(row, args.compact === true)),
      ...(rows.length === 0 && cache.stats().groups === 0 ? { note: NO_CACHE } : {}),
    });
  },
});

export const getSubscription = defineTool({
  name: "get_subscription",
  description:
    "Detalha uma assinatura: plano, o que você paga, o valor cheio do serviço, a taxa da Kotas, vagas, " +
    "fidelidade e os participantes com o que cada um paga — a API devolve os participantes tanto para " +
    "membro quanto para administrador. Lê o cache; se o grupo não estiver lá, busca 1 vez na API. NÃO " +
    "devolve login nem senha do serviço compartilhado: o kotas-mcp nunca expõe essas credenciais.",
  readOnly: true,
  input: Type.Object({ group_id: groupIdField, compact: compactField }),
  run: async (args, ctx) => {
    const cache = ctx.cache();
    let row = cache.getGroup(args.group_id);

    if (!row) {
      // Not cached: one request, and a closed group answers HTTP 400 — which is
      // the API's way of saying the subscription no longer exists.
      const raw = await ctx.api.getGroup(args.group_id, "member").catch(async (error: unknown) => {
        const admin = await ctx.api.getGroup(args.group_id, "admin").catch(() => null);
        if (admin) return admin;
        throw error;
      });
      const group = normalizeGroup(raw);
      if (!group) throw new Error(`O Kotas devolveu um grupo sem \`id\` para ${args.group_id}.`);
      cache.setGroupDetail(group, normalizeParticipants(group.id, raw), raw);
      row = cache.getGroup(args.group_id);
    }
    if (!row) throw new Error(`Grupo ${args.group_id} não encontrado.`);

    const participants = cache.getParticipants(row.id);
    return compactObject({
      subscription: groupOut(row, args.compact === true),
      ...(participants.length > 0
        ? { participants: participants.map(participantOut) }
        : { participants: [], note: "Sem participantes no cache; rode `sync`." }),
    });
  },
});

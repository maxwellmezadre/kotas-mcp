import { Type } from "@sinclair/typebox";
import { defineTool } from "./define.js";

// Escape hatch for rediscovery when the Kotas changes something (see
// docs/REDISCOVERY.md). It rides the same token lifecycle, rate limit and
// headers as every other call, and it is fenced three ways: a pattern in the
// JSON Schema the client can see, a deny-list, and a byte cap.

/**
 * Read surfaces addressed by an exact path — routes with no trailing segment,
 * which a prefix with a slash would miss (`credito` is the consolidated
 * balance, and is not the same route as `credito/obterlista`).
 */
export const ALLOWED_EXACT = ["credito", "cartao", "identificador", "cupom_indicacao"] as const;

/** Read surfaces of the account API. Anything else is refused, not guessed at. */
export const ALLOWED_PREFIXES = [
  "grupo/",
  "assinatura/restricoes/",
  "fatura/",
  "credito/",
  "recebimento/",
  "servico/",
  "notificacoes",
  "notificacao/",
  "usuario/cadastro/dados-fiscais",
  "usuario/obter-endereco-fiscal",
  "cartao",
  "meio-pagamento/",
  "contabanco/",
  "retirada/mes",
  "retirada/disponibilidade-boleto",
  "reclamacao/",
  "rede/obter",
  "indicacao/",
  "loteria/",
  "api/versao",
] as const;

/**
 * Anything that changes the account. This server is strictly read-only, so the
 * verbs are refused even where the session would happily perform them.
 */
export const FORBIDDEN_PATH =
  /(cancelar|cancelamento|pagar|pagamento|retirar|retirada\/retirar|alterar|alterarnome|remover|excluir|deletar|criar|enviar|assinar|comprar|estornar|liberar|reservar|ativar|desativar|bloquear|validar|aceitar|recusar|resetar|checkout|convite)/i;

/**
 * `grupo/obter-dados-acesso` answers with the login and the PASSWORD of the
 * shared service in the clear. There is no tool for it and there is no path to
 * it: those credentials must never enter a model's context or a transcript.
 */
export const CREDENTIALS_PATH = /obter-dados-acesso|dados-acesso/i;

export const MAX_RAW_BYTES = 64 * 1024;

export const rawGet = defineTool({
  name: "raw_get",
  description:
    "Chama uma rota GET da API do Kotas diretamente, com a mesma sessão, o mesmo ritmo e os mesmos " +
    "headers das outras tools. Serve para redescobrir um endpoint quando a API muda. Use com " +
    "parcimônia e nunca em rajada. Somente leitura: qualquer rota com verbo de escrita (cancelar, " +
    "pagar, retirar, alterar…) é recusada, e as credenciais do serviço compartilhado " +
    "(`grupo/obter-dados-acesso`) são bloqueadas em qualquer forma.",
  readOnly: true,
  input: Type.Object({
    path: Type.String({
      pattern: "^[A-Za-z0-9][A-Za-z0-9_/.-]*$",
      description: "Rota relativa, sem barra inicial (ex.: grupo/categorias)",
    }),
    query: Type.Optional(
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
        description: 'Parâmetros de query (ex.: { "page": 1, "pageSize": 50 })',
      }),
    ),
    max_bytes: Type.Optional(
      Type.Integer({
        minimum: 1024,
        maximum: MAX_RAW_BYTES,
        description: `Corta a resposta neste tamanho (default ${MAX_RAW_BYTES})`,
      }),
    ),
  }),
  run: async (args, ctx) => {
    const path = args.path.trim().replace(/^\/+/, "");
    assertAllowed(path);
    const payload = await ctx.api.getRaw(path, args.query ?? {});
    const limit = args.max_bytes ?? MAX_RAW_BYTES;
    const serialized = JSON.stringify(payload ?? null);
    const truncated = serialized.length > limit;
    return {
      path,
      bytes: serialized.length,
      truncated,
      data: truncated ? `${serialized.slice(0, limit)}…` : (payload ?? null),
    };
  },
});

export function assertAllowed(path: string): void {
  if (path.includes("..")) throw new Error("path inválido: não pode conter '..'");
  if (CREDENTIALS_PATH.test(path)) {
    throw new Error(
      "Rota bloqueada: `grupo/obter-dados-acesso` devolve o login e a senha do serviço compartilhado em texto claro. " +
        "O kotas-mcp nunca expõe essas credenciais. Pegue-as no app do Kotas.",
    );
  }
  if (FORBIDDEN_PATH.test(path)) {
    throw new Error(
      `Rota recusada: "${path}" parece uma rota de escrita, e o kotas-mcp é somente leitura — nunca altera a conta.`,
    );
  }
  const bare = path.split("?")[0] ?? path;
  const allowed =
    (ALLOWED_EXACT as readonly string[]).includes(bare) ||
    ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (!allowed) {
    throw new Error(
      `Rota fora do escopo: "${path}". Aceitas: ${[...ALLOWED_EXACT, ...ALLOWED_PREFIXES].join(", ")}.`,
    );
  }
}

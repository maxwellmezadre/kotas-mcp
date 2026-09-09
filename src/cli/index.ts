import { Command } from "commander";
import { loadConfig } from "../config.js";
import { createContext, type Ctx } from "../context.js";
import { ConfigError } from "../config.js";
import { runTool } from "../tools/define.js";
import { activeTools, toolByName } from "../tools/registry.js";
import { kv, mainList, table } from "./render.js";

// The CLI resolves tools from the SAME registry as the MCP server, through the
// same `runTool`, so the two surfaces cannot drift. Commander lives only here.

type CliOptions = { json?: boolean };

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("kotas")
    .description("Assinaturas compartilhadas do Kotas: grupos, faturas, créditos e recebimentos")
    .version(version)
    .option("--json", "Imprime o resultado cru em JSON");

  const withCtx = async (run: (ctx: Ctx, options: CliOptions) => Promise<void>) => {
    let ctx: Ctx | undefined;
    try {
      ctx = createContext(loadConfig());
      await run(ctx, program.opts<CliOptions>());
    } catch (error) {
      if (error instanceof ConfigError) console.error(error.message);
      else console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      ctx?.dispose();
    }
  };

  const call = async (ctx: Ctx, name: string, args: Record<string, unknown>, options: CliOptions) => {
    const tool = toolByName(name);
    if (!tool) throw new Error(`Tool desconhecida: ${name}`);
    if (ctx.config.readOnly && !tool.readOnly) {
      throw new Error(`A tool ${name} não está disponível com KOTAS_READ_ONLY=1.`);
    }
    const result = (await runTool(tool, prune(args), ctx)) as Record<string, unknown>;
    print(result, options);
  };

  program
    .command("status")
    .description("Mostra a sessão salva e o que já está no cache")
    .option("--verify", "Confirma com o Kotas que a sessão é aceita (1 requisição)")
    .action((flags: { verify?: boolean }) =>
      withCtx((ctx, options) => call(ctx, "auth_status", { verify: flags.verify }, options)),
    );

  program
    .command("login")
    .description("Salva uma sessão do Kotas, cifrada em disco")
    .option("-e, --email <email>", "E-mail da conta")
    .option("-p, --password <senha>", "Senha (ou defina KOTAS_SENHA)")
    .option("--pin <codigo>", "Código de 6 dígitos da verificação em duas etapas")
    .option("--from-browser <navegador>", "arc | chrome | chromium | brave | edge")
    .option("--paste", "Cola os três valores do localStorage pela entrada padrão")
    .action((flags: Record<string, string | boolean | undefined>) =>
      withCtx(async (ctx, options) => {
        const args: Record<string, unknown> = {
          email: flags.email,
          password: flags.password,
          pin: flags.pin,
          from_browser: flags.fromBrowser,
        };
        if (flags.paste) args.tokens = await readPastedTokens();
        await call(ctx, "login", args, options);
      }),
    );

  program
    .command("doctor")
    .description("Diagnóstico camada a camada")
    .option("--shallow", "Não testa grupos, créditos e recebimentos")
    .action((flags: { shallow?: boolean }) =>
      withCtx((ctx, options) => call(ctx, "doctor", { deep: !flags.shallow }, options)),
    );

  program
    .command("sync")
    .description("Baixa o histórico para o cache local (repete os blocos sozinho)")
    .option("--full", "Varre tudo, não só o que mudou")
    .option("--reparse", "Reprocessa o cache sem usar a rede")
    .option("--max-requests <n>", "Orçamento por bloco", (value) => Number(value))
    .action((flags: { full?: boolean; reparse?: boolean; maxRequests?: number }) =>
      withCtx(async (ctx, options) => {
        const tool = toolByName("sync");
        if (!tool) throw new Error("Tool sync ausente do registry.");
        const args = prune({
          mode: flags.reparse ? "reparse" : flags.full ? "full" : undefined,
          max_requests: flags.maxRequests,
        });
        // The MCP client is told to loop; a human is not.
        let last: Record<string, unknown> = {};
        // Each chunk reports only its own errors, so they are accumulated:
        // printing just the last report hides everything that went wrong.
        const errors: string[] = [];
        for (let chunk = 1; chunk <= 100; chunk += 1) {
          last = (await runTool(tool, args, ctx)) as Record<string, unknown>;
          errors.push(...((last.errors as string[] | undefined) ?? []));
          // Progress goes to stderr so stdout stays parseable.
          console.error(
            `bloco ${chunk}: ${last.requestsUsed} req, ${last.invoices} faturas, ${last.pendingDetails} detalhes pendentes${
              last.done ? ", pronto" : ""
            }`,
          );
          if (last.done === true) break;
        }
        print({ ...last, errors }, options);
      }),
    );

  program
    .command("subscriptions")
    .description("Lista as assinaturas do cache")
    .option("--role <papel>", "todos | membro | administrador")
    .action((flags: { role?: string }) =>
      withCtx((ctx, options) => call(ctx, "list_subscriptions", { role: flags.role }, options)),
    );

  program
    .command("subscription <groupId>")
    .description("Detalha uma assinatura")
    .action((groupId: string) =>
      withCtx((ctx, options) =>
        call(ctx, "get_subscription", { group_id: Number(groupId) }, options),
      ),
    );

  program
    .command("invoices")
    .description("Lista as faturas do cache")
    .option("--status <situacao>", "pago | pendente | cancelado | atraso | estornado")
    .option("--from <data>", "YYYY-MM-DD")
    .option("--to <data>", "YYYY-MM-DD")
    .option("--product <nome>", "Nome exato do produto")
    .option("--limit <n>", "Máximo de faturas", (value) => Number(value))
    .action((flags: Record<string, string | number | undefined>) =>
      withCtx((ctx, options) =>
        call(
          ctx,
          "list_invoices",
          {
            status: flags.status,
            from: flags.from,
            to: flags.to,
            product: flags.product,
            limit: flags.limit,
          },
          options,
        ),
      ),
    );

  program
    .command("invoice <invoiceId>")
    .description("Detalha uma fatura, com os itens")
    .action((invoiceId: string) =>
      withCtx((ctx, options) => call(ctx, "get_invoice", { invoice_id: Number(invoiceId) }, options)),
    );

  program
    .command("credits")
    .description("Lista os lançamentos de crédito")
    .option("--kind <tipo>", "adicaoDeSaldo | caucaoDaInscricao | repasseAdministrador | estornoCancelamento")
    .action((flags: { kind?: string }) =>
      withCtx((ctx, options) => call(ctx, "list_credits", { kind: flags.kind }, options)),
    );

  program
    .command("balance")
    .description("Saldo da carteira e economia acumulada (ao vivo)")
    .action(() => withCtx((ctx, options) => call(ctx, "balance", {}, options)));

  program
    .command("payouts")
    .description("Recebimentos como administrador")
    .option("--group <id>", "Também mostra o extrato deste grupo", (value) => Number(value))
    .action((flags: { group?: number }) =>
      withCtx((ctx, options) => call(ctx, "list_payouts", { group_id: flags.group }, options)),
    );

  program
    .command("history")
    .description("Linha do tempo de todas as assinaturas já pagas, inclusive as encerradas")
    .option("--active", "Só as que ainda existem hoje")
    .option("--with-credits", "Inclui as compras de crédito avulso")
    .action((flags: { active?: boolean; withCredits?: boolean }) =>
      withCtx((ctx, options) =>
        call(
          ctx,
          "purchase_history",
          { active_only: flags.active, include_credit_purchases: flags.withCredits },
          options,
        ),
      ),
    );

  program
    .command("spending")
    .description("Soma os gastos por mês, ano, produto ou situação")
    .option("--by <criterio>", "month | year | product | status", "month")
    .option("--from <data>", "YYYY-MM-DD")
    .option("--to <data>", "YYYY-MM-DD")
    .action((flags: Record<string, string | undefined>) =>
      withCtx((ctx, options) =>
        call(ctx, "spending_summary", { by: flags.by, from: flags.from, to: flags.to }, options),
      ),
    );

  program
    .command("search <termo>")
    .description("Busca serviços no catálogo do Kotas")
    .action((termo: string) =>
      withCtx((ctx, options) => call(ctx, "search_services", { query: termo }, options)),
    );

  program
    .command("export <escopo>")
    .description("invoices | subscriptions | credits | payouts | history")
    .option("--format <formato>", "csv | json", "csv")
    .option("--filename <nome>", "Nome do arquivo, sem caminho")
    .action((escopo: string, flags: Record<string, string | undefined>) =>
      withCtx((ctx, options) =>
        call(
          ctx,
          "export",
          { scope: escopo, format: flags.format, filename: flags.filename },
          options,
        ),
      ),
    );

  program
    .command("raw <rota>")
    .description("GET autenticado numa rota de leitura da API")
    .option("-q, --query <k=v...>", "Parâmetros de query, repetíveis (ex.: -q page=1 -q pageSize=50)")
    .action((rota: string, flags: { query?: string[] }) =>
      withCtx((ctx, options) =>
        call(ctx, "raw_get", { path: rota, query: parseQuery(flags.query) }, options),
      ),
    );

  program
    .command("tools")
    .description("Lista as tools registradas")
    .action(() =>
      withCtx(async (ctx, options) => {
        const rows = activeTools(ctx.config).map((tool) => ({
          tool: tool.name,
          escreve: !tool.readOnly,
        }));
        print({ total: rows.length, tools: rows }, options);
      }),
    );

  program.command("mcp").description("Inicia o servidor MCP (stdio)").action(() => {
    throw new Error("Use `kotas mcp` diretamente: o modo MCP é tratado antes do CLI.");
  });

  await program.parseAsync(argv);
}

/** Reads the three localStorage values from stdin, one per line. */
async function readPastedTokens(): Promise<Record<string, string>> {
  process.stderr.write(
    "Cole os valores do localStorage de app.kotas.com.br, um por linha:\n" +
      "  1) @chave\n  2) @c08cbbfd6eefc83ac6d23c4c791277e4\n  3) SEFTSF9ESVNQT1NJVElWTw== (opcional)\n",
  );
  const text = await new Response(Bun.stdin.stream()).text();
  const [accessToken, refreshToken, deviceHash] = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (!accessToken || !refreshToken) {
    throw new Error("Faltou o access token ou o refresh token (uma linha para cada).");
  }
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    ...(deviceHash ? { device_hash: deviceHash } : {}),
  };
}

/** `-q page=1 -q ativos=false` -> `{ page: "1", ativos: "false" }`. */
function parseQuery(pairs: string[] | undefined): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  const query: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at === -1) throw new Error(`Parâmetro inválido: "${pair}". Use chave=valor.`);
    query[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return query;
}

const prune = (args: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));

function print(result: Record<string, unknown>, options: CliOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const list = mainList(result);
  if (list) {
    const rest = Object.fromEntries(Object.entries(result).filter(([key]) => key !== list.key));
    if (Object.keys(rest).length > 0) console.log(`${kv(rest)}\n`);
    console.log(table(list.rows as Array<Record<string, unknown>>));
    return;
  }
  console.log(kv(result));
}

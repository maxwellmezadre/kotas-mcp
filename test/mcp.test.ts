import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";

// Drives the REAL server over stdio. These are the failure modes unit tests
// never see: a log line on stdout, a crash on a bad call, a tool that is
// registered when it should not be.

const home = mkdtempSync(join(tmpdir(), "kotas-mcp-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

type Rpc = { id?: number; result?: Record<string, unknown>; jsonrpc?: string };
type ToolResult = { isError?: boolean; content: Array<{ text: string }> };

const handshake = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
];

async function talk(messages: object[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/bin.ts", "mcp"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, KOTAS_CONFIG_DIR: home, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(messages.map((message) => `${JSON.stringify(message)}\n`).join(""));
  await proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  proc.kill();
  const replies = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Rpc);
  return { replies, stdout, stderr };
}

const callTool = (id: number, name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

test(
  "the server lists the registry, refuses what it must, and survives every error",
  async () => {
    const { replies, stdout, stderr } = await talk([
      ...handshake,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      callTool(3, "auth_status"),
      callTool(4, "nao_existe"),
      callTool(5, "raw_get", { path: "grupo/obter-dados-acesso" }),
      callTool(6, "list_invoices", { limit: -1 }),
      { jsonrpc: "2.0", id: 7, method: "tools/list" },
    ]);

    // Every line of stdout is JSON-RPC: no log leaked into the stream.
    for (const line of stdout.split("\n").filter((value) => value.trim() !== "")) {
      expect(JSON.parse(line)).toHaveProperty("jsonrpc", "2.0");
    }
    expect(stderr).toContain("kotas-mcp");

    const listed = (replies.find((reply) => reply.id === 2)?.result as {
      tools: Array<{ name: string }>;
    }).tools;
    expect(listed.map((tool) => tool.name)).toEqual(allTools.map((tool) => tool.name));

    const status = replies.find((reply) => reply.id === 3)?.result as ToolResult;
    expect(status.isError).toBeUndefined();
    // No session and no network, and no token anywhere in the answer.
    expect(status.content[0]?.text).toContain('"loggedIn": false');
    expect(status.content[0]?.text).not.toMatch(/eyJ[A-Za-z0-9_-]{10}/);

    for (const id of [4, 5, 6]) {
      expect((replies.find((reply) => reply.id === id)?.result as ToolResult).isError).toBe(true);
    }
    expect(
      (replies.find((reply) => reply.id === 5)?.result as ToolResult).content[0]?.text,
    ).toMatch(/credenciais|senha/i);

    // Still answering after three tool errors.
    expect(replies.find((reply) => reply.id === 7)?.result).toBeDefined();
  },
  30_000,
);

test(
  "read-only mode registers exactly the tools that do not write",
  async () => {
    const { replies } = await talk(
      [...handshake, { jsonrpc: "2.0", id: 2, method: "tools/list" }],
      { KOTAS_READ_ONLY: "1" },
    );
    const listed = (replies.find((reply) => reply.id === 2)?.result as {
      tools: Array<{ name: string }>;
    }).tools;
    expect(listed.map((tool) => tool.name)).toEqual(
      allTools.filter((tool) => tool.readOnly).map((tool) => tool.name),
    );
    expect(listed.some((tool) => tool.name === "sync")).toBe(false);
  },
  30_000,
);

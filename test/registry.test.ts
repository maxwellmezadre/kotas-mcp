import { describe, expect, test } from "bun:test";
import { runTool, ToolInputError } from "../src/tools/define.js";
import { activeTools, allTools, toolByName } from "../src/tools/registry.js";
import { testContext } from "./helpers.js";

// Invariants that hold for every tool, now and after each new one is added.

describe("registry invariants", () => {
  test("names are unique and snake_case without a vendor prefix", () => {
    const names = allTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      // The MCP client namespaces it as `mcp__kotas__*` already.
      expect(name.startsWith("kotas_")).toBe(false);
    }
  });

  test("every description is long enough to steer a model", () => {
    for (const tool of allTools) expect(tool.description.length).toBeGreaterThan(40);
  });

  test("every input serialises to a JSON Schema object", () => {
    for (const tool of allTools) {
      const schema = JSON.parse(JSON.stringify(tool.input)) as { type?: string };
      expect(schema.type).toBe("object");
    }
  });

  test("toolByName finds what the CLI asks for", () => {
    expect(toolByName("auth_status")?.name).toBe("auth_status");
    expect(toolByName("nope")).toBeUndefined();
  });

  test("no tool exposes the shared service credentials", () => {
    for (const tool of allTools) {
      expect(tool.name).not.toMatch(/credenc|dados.?acesso/i);
      expect(JSON.stringify(tool.input)).not.toContain("obter-dados-acesso");
    }
  });

  test("invalid arguments are reported with their JSON path, not swallowed", async () => {
    const ctx = testContext();
    try {
      await expect(runTool(toolByName("list_invoices")!, { limit: "muitas" }, ctx)).rejects.toThrow(
        ToolInputError,
      );
    } finally {
      ctx.dispose();
    }
  });
});

describe("read-only mode", () => {
  test("registers exactly the readOnly subset", () => {
    const readable = allTools.filter((tool) => tool.readOnly);
    expect(activeTools({ readOnly: true })).toEqual(readable);
    expect(activeTools({ readOnly: false })).toEqual(allTools);
  });

  test("the writers are the three that touch local disk, and only those", () => {
    // `readOnly: false` means "writes to disk", never "writes to the account".
    expect(
      allTools
        .filter((tool) => !tool.readOnly)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["export", "login", "sync"]);
  });
});

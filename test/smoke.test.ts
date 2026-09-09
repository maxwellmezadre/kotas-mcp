import { expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };

// Harness sanity: the package stays ESM and the version stays semver, so the
// static import in bin.ts keeps working inside the compiled binary.
test("package is esm with a semver version", () => {
  expect(pkg.type).toBe("module");
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test("both binaries are declared", () => {
  expect(Object.keys(pkg.bin).sort()).toEqual(["kotas", "kotas-mcp"]);
});

test("no runtime dependency needs a native build", () => {
  // A native addon cannot be embedded by `bun build --compile`, which is what
  // ADR-0011 is about: the LevelDB reader is hand-rolled for this reason.
  expect(Object.keys(pkg.dependencies).sort()).toEqual([
    "@modelcontextprotocol/sdk",
    "@sinclair/typebox",
    "commander",
  ]);
});

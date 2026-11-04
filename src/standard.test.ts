import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_BUNDLE = join(REPOSITORY_ROOT, "dist", "host");
const PACKAGE = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8")) as { version: string };
const HOST_COMMAND_LINE = join(dirname(createRequire(import.meta.url).resolve("@forebay/host/package.json")), "dist", "cli", "main.js");

const RULED_STANDARD = {
  application: {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    home: { envOverride: "HUB_CLAUDE_DIR", nativeEnv: "CLAUDE_CONFIG_DIR", candidates: ["~/.claude", "~/.config/claude"] },
    packages: { npm: "@anthropic-ai/claude-code" },
  },
  pathCommands: { requested: ["cc"], minimum: 1 },
  background: ["claude-code-proxy"],
};

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "loader-standard-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("the loader's host bundle", () => {
  it("holds only a host.json carrying the ruled standard under the loader's name and version", () => {
    expect(readdirSync(HOST_BUNDLE)).toEqual(["host.json"]);
    const manifest = JSON.parse(readFileSync(join(HOST_BUNDLE, "host.json"), "utf8")) as Record<string, unknown>;
    expect(manifest).toEqual({ id: "claude-code-loader", version: PACKAGE.version, ...RULED_STANDARD });
  });

  it("is listed by a catalog built from it with its application", () => {
    execFileSync(process.execPath, [HOST_COMMAND_LINE, "catalog", "build", "--host", HOST_BUNDLE, "--out", base], { encoding: "utf8" });
    const catalog = JSON.parse(readFileSync(join(base, "catalog.json"), "utf8")) as { items: Record<string, { kind: string; application?: unknown }> };
    expect(catalog.items["claude-code-loader"]).toMatchObject({ kind: "host", application: RULED_STANDARD.application });
  });
});

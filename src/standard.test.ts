import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { standard } from "./standard.js";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_BUNDLE = join(REPOSITORY_ROOT, "dist", "host");
const PACKAGE = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8")) as { name: string; version: string };
const HOST_COMMAND_LINE = join(dirname(createRequire(import.meta.url).resolve("@forebay/host/package.json")), "dist", "cli", "main.js");

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "loader-standard-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("the loader's host bundle", () => {
  it("carries the standard in its host.json under the loader's name and version", () => {
    const manifest = JSON.parse(readFileSync(join(HOST_BUNDLE, "host.json"), "utf8")) as Record<string, unknown>;
    expect(manifest).toEqual({ id: PACKAGE.name, version: PACKAGE.version, entry: "host.js", ...standard });
  });

  it("is listed by a catalog built from it with its application", () => {
    execFileSync(process.execPath, [HOST_COMMAND_LINE, "catalog", "build", "--host", HOST_BUNDLE, "--out", base], { encoding: "utf8" });
    const catalog = JSON.parse(readFileSync(join(base, "catalog.json"), "utf8")) as { items: Record<string, { kind: string; application?: unknown }> };
    expect(catalog.items[PACKAGE.name]).toMatchObject({ kind: "host", application: standard.application });
  });
});

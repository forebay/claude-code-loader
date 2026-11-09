import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { siblingRuntime } from "@forebay/host";
import { openLibrary, parseDeclaration, servicesOf } from "@weivel/typescript/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { standard } from "./standard.js";

const LOADER_ID = "sample-loader";
const HOST_ROOT = dirname(createRequire(import.meta.url).resolve("@forebay/host/package.json"));
const PLACE_NAMES = ["state", "cache", "home"] as const;

type Places = Record<(typeof PLACE_NAMES)[number], string>;
type Service = Record<string, (argument: unknown) => { written?: boolean; refused?: string }>;

let base: string;
let places: Places;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "loader-entry-"));
  places = { state: join(base, "state"), cache: join(base, "cache"), home: join(base, "home") };
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function writtenEntry(): void {
  const source = siblingRuntime(HOST_ROOT);
  const declaration = parseDeclaration(readFileSync(source.declarationPath, "utf8"));
  const library = openLibrary(source.binaryPath, declaration);
  const service = (id: string) => servicesOf(library, declaration).find((candidate) => candidate.id === id)?.implementation as unknown as Service;
  const known = { portable: join(base, "portable"), state: places.state, cache: places.cache };
  try {
    (service("hosts").register as (argument: unknown) => unknown)({
      places: known,
      identity: { id: LOADER_ID, version: "1.0.0", home: places.home, application: { id: standard.application.id }, requiresCommand: false, commands: [] },
      provenance: { method: "catalog", version: "1.0.0", location: places.cache, os: "linux", architecture: "x64", installedAt: "2026-11-09T00:00:00.000Z" },
      environment: { PATH: join(base, "path"), HOME: join(base, "user"), USERPROFILE: join(base, "user") },
    });
    const answer = (service("install").entry as (argument: unknown) => { written?: boolean })({
      places: known,
      loader: { id: LOADER_ID, application: standard.application, home: places.home },
    });
    expect(answer.written).toBe(true);
  } finally {
    library.close();
  }
}

function escapedForJson(path: string): string {
  return JSON.stringify(path).slice(1, -1);
}

/** Names a temporary place by its token and writes the rest of the path alike on every OS. */
function portable(text: string): string {
  let result = text;
  for (const name of PLACE_NAMES) {
    result = result.split(escapedForJson(places[name])).join(`<${name}>`).split(places[name]).join(`<${name}>`);
  }
  return result.replace(/<(?:state|cache|home)>(?:\\\\|\\|\/|[\w.-])*/g, (path) => path.replace(/(?:\\\\|\\)/g, "/").replace(/\.exe$/, ""));
}

function treeOf(root: string, prefix: string, tree: Record<string, string | null>): void {
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      tree[relative] = null;
      treeOf(join(root, entry.name), relative, tree);
    } else {
      tree[relative] = portable(readFileSync(join(root, entry.name), "utf8"));
    }
  }
}

describe("the entry the loader writes", () => {
  it("is exactly these files", async () => {
    writtenEntry();
    const tree: Record<string, string | null> = {};
    if (existsSync(join(places.state, "entries"))) treeOf(join(places.state, "entries"), "<state>/entries", tree);
    treeOf(places.home, "<home>", tree);
    await expect(JSON.stringify(tree, null, 2)).toMatchFileSnapshot("__snapshots__/entry.written.json");
  });
});

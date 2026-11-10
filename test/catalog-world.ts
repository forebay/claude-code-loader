import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleJavascriptHost, bundleKoffiLibrary, bundlePlugin, siblingForebayLibrary } from "@forebay/host";
import { currentPlatformKey } from "@weivel/typescript/host";

const IS_WINDOWS = process.platform === "win32";
const EXECUTABLE_ENDING = IS_WINDOWS ? ".exe" : "";
const RUN_TIMEOUT_MILLISECONDS = 120000;

export const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SIBLINGS = join(REPOSITORY_ROOT, "siblings");
export const HOST_ROOT = dirname(createRequire(import.meta.url).resolve("@forebay/host/package.json"));
const LIBRARY = join(HOST_ROOT, "siblings", "library");
const BUILT = IS_WINDOWS ? join(LIBRARY, "build", "bin", "Release") : join(LIBRARY, "build", "bin");
export const FOREBAY_HOST = join(BUILT, `forebay-host${EXECUTABLE_ENDING}`);

export const PLUGINS = ["claude-code-proxy", "provider-stub", "claude-code-provider"];

/** A temp machine: its base directory and the environment every process of the test runs with. */
export interface World {
  base: string;
  environment: Record<string, string>;
}

function libraryBinaryName(binary: string): string {
  if (IS_WINDOWS) return `${binary}.dll`;
  return process.platform === "darwin" ? `lib${binary}.dylib` : `lib${binary}.so`;
}

function stagedForebayHost(stage: string, platform: string): string {
  const directory = join(stage, "forebay-host");
  mkdirSync(join(directory, platform), { recursive: true });
  writeFileSync(join(directory, "host.json"), JSON.stringify({ id: "forebay-host", version: "1.0.0", runtime: "native", entry: `${platform}/forebay-host${EXECUTABLE_ENDING}` }));
  const executables = [`forebay-host${EXECUTABLE_ENDING}`, `forebay-boot${EXECUTABLE_ENDING}`, ...(IS_WINDOWS ? ["runtime-launcher.exe"] : [])];
  for (const executable of executables) copyFileSync(join(BUILT, executable), join(directory, platform, executable));
  return directory;
}

function stagedRuntimeLibrary(stage: string): string {
  const directory = join(stage, "runtime");
  mkdirSync(directory, { recursive: true });
  copyFileSync(join(LIBRARY, "runtime", "library.json"), join(directory, "library.json"));
  copyFileSync(join(BUILT, libraryBinaryName("runtime")), join(directory, libraryBinaryName("runtime")));
  return directory;
}

/** The apps library as a catalog folder: its declaration, its binary and its contract schemas. */
function stagedAppsLibrary(stage: string): string {
  const source = siblingForebayLibrary(HOST_ROOT);
  const directory = join(stage, "apps");
  mkdirSync(directory, { recursive: true });
  copyFileSync(source.declarationPath, join(directory, "library.json"));
  copyFileSync(join(source.binaryDirectory, libraryBinaryName("apps")), join(directory, libraryBinaryName("apps")));
  cpSync(source.contractsDirectory, join(directory, "contracts"), { recursive: true });
  return directory;
}

async function bundledPlugins(stage: string): Promise<string[]> {
  const bundled: string[] = [];
  for (const plugin of PLUGINS) {
    const out = join(stage, plugin);
    await bundlePlugin(join(SIBLINGS, plugin), out);
    bundled.push(out);
  }
  return bundled;
}

function checked(run: SpawnSyncReturns<string>, what: string): string {
  if (run.status === 0) return run.stdout;
  throw new Error(`${what} answered ${run.status}: ${run.stdout}\n${run.stderr}${run.error === undefined ? "" : `\n${run.error.message}`}`);
}

/** Runs the native forebay-host with `arguments_` in the world's environment, answering the whole run. */
export function forebayHost(world: World, arguments_: string[]): SpawnSyncReturns<string> {
  return spawnSync(FOREBAY_HOST, arguments_, { cwd: world.base, env: world.environment, encoding: "utf8", timeout: RUN_TIMEOUT_MILLISECONDS });
}

/** Runs the native forebay-host, refusing anything but a success. */
export function checkedForebayHost(world: World, arguments_: string[]): string {
  return checked(forebayHost(world, arguments_), `forebay-host ${arguments_.join(" ")}`);
}

/**
 * Builds a local catalog of the native forebay-host, the runtime, koffi and apps libraries, the
 * javascript-host bundle, this loader's host bundle and the three plugins, answering its index.
 */
export async function builtCatalog(world: World): Promise<string> {
  const stage = join(world.base, "stage");
  const platform = currentPlatformKey();
  const javascriptHost = await bundleJavascriptHost(join(stage, "javascript-host"));
  const koffi = join(stage, "koffi");
  bundleKoffiLibrary(join(HOST_ROOT, "node_modules", "koffi"), platform, koffi);
  const catalog = join(world.base, "catalog");
  checkedForebayHost(world, [
    "catalog",
    "build",
    ...(await bundledPlugins(stage)).flatMap((plugin) => ["--plugin", plugin]),
    "--host",
    dirname(javascriptHost.files["host.json"] as string),
    "--host",
    join(REPOSITORY_ROOT, "dist", "host"),
    "--host",
    `${stagedForebayHost(stage, platform)}@${platform}`,
    "--library",
    `runtime=${stagedRuntimeLibrary(stage)}@${platform}`,
    "--library",
    `koffi=${koffi}@${platform}`,
    "--library",
    `apps=${stagedAppsLibrary(stage)}@${platform}`,
    "--out",
    catalog,
  ]);
  return join(catalog, "catalog.json");
}

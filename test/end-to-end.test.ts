import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtCatalog, checkedForebayHost, forebayHost } from "./catalog-world.js";
import type { World } from "./catalog-world.js";
import { claudeCodeDirectory, isClaudeCodeInstalled, offlineClaudeCodeEnvironment } from "./claude-code.js";
import { startFakeUpstream, UPSTREAM_TEXT } from "./fake-upstream.js";
import type { FakeUpstream } from "./fake-upstream.js";
import { LOADER, setLoaderSetting, setPluginConfig } from "./loader-settings.js";
import { userPathEntriesUnder } from "./user-path.js";

const IS_WINDOWS = process.platform === "win32";
const ON_CI = process.env.CI === "true";
const STUB_AUTH_TEXT = "Hello from stub-auth";
const STUB_CHAIN = [{ provider: "stub-auth", model: "stub-model" }];
/** @implNote stub-auth's model ids name no Claude tier, so no slot derives to it; a user maps them as here. */
const STUB_MODEL_MAP = { opus: STUB_CHAIN, sonnet: STUB_CHAIN, haiku: STUB_CHAIN, fable: STUB_CHAIN };
const CLAUDE_TIMEOUT_MILLISECONDS = 180000;
const SETUP_TIMEOUT_MILLISECONDS = 600000;
const SESSION_STOP_MILLISECONDS = 60000;
/** @implNote On Windows the last session host keeps the base busy as its working directory until its hold interval runs out. */
const REMOVE_RETRIES = 30;
const REMOVE_RETRY_MILLISECONDS = 1000;

/**
 * @implNote The install requests the `cc` command, which on Windows writes the real user PATH
 * (RULES section 8), so there it runs only on a CI runner; on CI it always runs, so a missing
 * Claude Code install fails rather than skips.
 */
const RUNS = ON_CI || (!IS_WINDOWS && isClaudeCodeInstalled());

let world: World;
let catalog: string;
let upstream: FakeUpstream;
let proxyPort: number;
let command: string;

function systemPath(): string[] {
  const systemRoot = process.env.SystemRoot;
  return systemRoot === undefined ? ["/usr/bin", "/bin"] : [join(systemRoot, "System32"), systemRoot];
}

function environmentUnder(base: string): Record<string, string> {
  const user = join(base, "user");
  const systemRoot = process.env.SystemRoot;
  return {
    PATH: [claudeCodeDirectory(), dirname(process.execPath), ...systemPath()].join(delimiter),
    ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }),
    HOME: user,
    USERPROFILE: user,
    LOCALAPPDATA: join(user, "local"),
    APPDATA: join(user, "roaming"),
    TEMP: join(base, "temp"),
    TMP: join(base, "temp"),
    TMPDIR: join(base, "temp"),
    SPISOR_HOME: join(base, "portable"),
    SPISOR_STATE: join(base, "state"),
    SPISOR_CACHE: join(base, "cache"),
    SPISOR_SECRETS: join(base, "secrets"),
    ...offlineClaudeCodeEnvironment(join(user, ".claude")),
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closed(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Waits until the last launch's session host has stopped serving `proxy.port`.
 *
 * @implNote A session host outlives the launch that started it by its hold interval, and a launch
 * started meanwhile would reuse it with the plugins and environment it started with.
 */
async function untilSessionHostStopped(): Promise<void> {
  const deadline = Date.now() + SESSION_STOP_MILLISECONDS;
  for (;;) {
    const free = await listenOn(proxyPort).then(closed).then(() => true, () => false);
    if (free) return;
    if (Date.now() > deadline) throw new Error(`the session host still serves ${proxyPort} after ${SESSION_STOP_MILLISECONDS} ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** @implNote Named from the install report, never assumed: `cc` is taken where a C compiler is on the PATH, and the shim is then `cc2`. */
function ccShim(): string {
  return join(world.environment.SPISOR_STATE as string, "bin", IS_WINDOWS ? `${command}.exe` : command);
}

function installedCommand(report: string): string {
  const loaders = (JSON.parse(report) as { loaders: Array<{ id: string; commands: string[] }> }).loaders;
  const name = loaders.find((loader) => loader.id === LOADER)?.commands[0];
  if (name === undefined) throw new Error(`the install registered no command for ${LOADER}: ${report}`);
  return name;
}

/**
 * Runs `cc -p hi` as a user would, answering its exit code and its whole output for `includes`, since
 * Claude Code may decorate or wrap what it prints.
 *
 * @implNote Asynchronous, never `spawnSync`: the fake upstream answers from this same process.
 */
function cc(environment: Record<string, string> = {}): Promise<{ status: number | null; output: string }> {
  const child = spawn(ccShim(), ["-p", "hi"], { cwd: world.base, env: { ...world.environment, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  const timer = setTimeout(() => child.kill(), CLAUDE_TIMEOUT_MILLISECONDS - 5000);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
}

function messagesReceived(): number {
  return upstream.received.filter((request) => request.url.startsWith("/v1/messages")).length;
}

function installedBundles(): string[] {
  const bundles = join(world.environment.SPISOR_CACHE as string, "bundles");
  return existsSync(bundles) ? readdirSync(bundles) : [];
}

beforeAll(async () => {
  if (!RUNS) return;
  const base = mkdtempSync(join(tmpdir(), "loader-end-to-end-"));
  world = { base, environment: environmentUnder(base) };
  mkdirSync(world.environment.TEMP as string, { recursive: true });
  catalog = await builtCatalog(world);
  upstream = await startFakeUpstream();
  proxyPort = await freePort();
}, SETUP_TIMEOUT_MILLISECONDS);

afterAll(async () => {
  if (!RUNS) return;
  await upstream?.close();
  forebayHost(world, ["remove", LOADER]);
  expect(userPathEntriesUnder(world.base)).toEqual([]);
  rmSync(world.base, { recursive: true, force: true, maxRetries: REMOVE_RETRIES, retryDelay: REMOVE_RETRY_MILLISECONDS });
}, SETUP_TIMEOUT_MILLISECONDS);

describe.runIf(RUNS).sequential("cc driving the real Claude Code through the session host's proxy", () => {
  it("refuses before install, naming the install", () => {
    const run = forebayHost(world, ["launch", LOADER, "-p", "hi"]);
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain("forebay-host install --catalog");
  });

  it("installs and enables claude-code-proxy and no other plugin", () => {
    command = installedCommand(checkedForebayHost(world, ["install", "--catalog", catalog]));
    const bundles = installedBundles();
    expect(bundles).toContain("claude-code-proxy");
    expect(bundles).not.toContain("stub-auth");
    expect(bundles).not.toContain("claude-code-auth");
    expect(existsSync(ccShim())).toBe(true);
    setLoaderSetting(world, "proxy.port", proxyPort);
    setPluginConfig(world, "claude-code-proxy", "upstream", upstream.address);
  });

  it("passes Claude Code's own login through to the upstream unchanged", async () => {
    const run = await cc({ ANTHROPIC_API_KEY: "test-key" });
    expect(run.output).toContain(UPSTREAM_TEXT);
    expect(run.status).toBe(0);
    const messages = upstream.received.filter((request) => request.url.startsWith("/v1/messages"));
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.map((request) => request.headers["x-api-key"])).toEqual(messages.map(() => "test-key"));
  }, CLAUDE_TIMEOUT_MILLISECONDS);

  it("answers from stub-auth once it is enabled and logged in, the upstream seeing nothing", async () => {
    await untilSessionHostStopped();
    checkedForebayHost(world, ["install", "--catalog", catalog, "--plugin", "stub-auth"]);
    setLoaderSetting(world, "plugins.stub-auth.enabled", true);
    setLoaderSetting(world, "routing.modelMap", STUB_MODEL_MAP);
    checkedForebayHost(world, ["action", LOADER, "stub-auth", "login"]);
    const before = messagesReceived();
    const run = await cc();
    expect(run.output).toContain(STUB_AUTH_TEXT);
    expect(run.status).toBe(0);
    expect(messagesReceived()).toBe(before);
  }, CLAUDE_TIMEOUT_MILLISECONDS);

  it("exits 1 naming the port when something else holds proxy.port", async () => {
    await untilSessionHostStopped();
    const holder = await listenOn(proxyPort);
    try {
      const run = await cc();
      expect(run.status).toBe(1);
      expect(run.output).toContain(`port ${proxyPort} on 127.0.0.1 is already in use`);
      expect(run.output).toContain("proxy.port");
    } finally {
      await closed(holder);
    }
  }, CLAUDE_TIMEOUT_MILLISECONDS);

  it("refuses naming the setting once claude-code-proxy is disabled", async () => {
    setLoaderSetting(world, "plugins.claude-code-proxy.enabled", false);
    const run = await cc();
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("plugins.claude-code-proxy.enabled");
  }, CLAUDE_TIMEOUT_MILLISECONDS);
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { SIBLINGS } from "./catalog-world.js";

const IS_WINDOWS = process.platform === "win32";
const PREFIX = join(SIBLINGS, "claude-code");
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

/**
 * The directory holding a runnable `claude` from the npm install CI makes into `siblings/claude-code`.
 *
 * @implNote On Windows the package's own `bin` holds `claude.exe`, the native binary; `.bin` there holds
 * only `.cmd` and `.ps1` wrappers. Elsewhere that same file is also named `claude.exe`, so only the
 * `.bin` symlink answers to `claude` on the PATH.
 */
export function claudeCodeDirectory(): string {
  return IS_WINDOWS ? join(PREFIX, "node_modules", "@anthropic-ai", "claude-code", "bin") : join(PREFIX, "node_modules", ".bin");
}

export function isClaudeCodeInstalled(): boolean {
  return existsSync(join(claudeCodeDirectory(), IS_WINDOWS ? "claude.exe" : "claude"));
}

/** What keeps Claude Code from touching anything but the proxy: no telemetry, update, error report or feature fetch. */
export function offlineClaudeCodeEnvironment(configDirectory: string): Record<string, string> {
  return {
    CLAUDE_CONFIG_DIR: configDirectory,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_BUG_COMMAND: "1",
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
    NO_COLOR: "1",
    ...(IS_WINDOWS && existsSync(GIT_BASH) ? { CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH } : {}),
  };
}

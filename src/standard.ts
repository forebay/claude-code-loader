import type { LoaderStandard } from "@forebay/host";

export const standard: LoaderStandard = {
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

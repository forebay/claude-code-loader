import type { LoaderStandard } from "@forebay/host";

const MARKETPLACE = "spisor";
const PLUGIN = "spisor";
const PLUGIN_DESCRIPTION = "Registers the spisor host each time a session starts";
const HOOK_TIMEOUT_SECONDS = 30;
const SETTINGS_FILE = "{{home}}/settings.json";

/**
 * @remarks The entry is a directory marketplace whose one plugin runs the boot stub on SessionStart.
 *
 * @implNote Only `extraKnownMarketplaces.spisor` and `enabledPlugins["spisor@spisor"]` are written into the
 * settings, never `hooks`: a settings member is set wholesale, so setting `hooks.SessionStart` would replace
 * the user's own hooks. The hook uses the exec form, with `args`, so no path is ever quoted for a shell.
 */
export const standard: LoaderStandard = {
  application: {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    home: { envOverride: "HUB_CLAUDE_DIR", nativeEnv: "CLAUDE_CONFIG_DIR", candidates: ["~/.claude", "~/.config/claude"] },
    packages: { npm: "@anthropic-ai/claude-code" },
    proxy: {
      baseUrlVariable: "ANTHROPIC_BASE_URL",
      placeholder: { variable: "ANTHROPIC_AUTH_TOKEN", value: "sk-ant-loader-proxy" },
      ownLogin: {
        variables: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
        stateFile: { directoryVariable: "CLAUDE_CONFIG_DIR", name: ".claude.json", member: "oauthAccount" },
      },
    },
    entry: {
      runsOnJavascriptHost: false,
      directories: ["{{entryRoot}}", "{{entryRoot}}/.claude-plugin", "{{entryRoot}}/hooks", "{{home}}"],
      files: [
        {
          path: "{{entryRoot}}/.claude-plugin/marketplace.json",
          json: {
            name: MARKETPLACE,
            owner: { name: "spisor" },
            description: "Starts the spisor host when Claude Code starts",
            plugins: [{ name: PLUGIN, source: ".", description: PLUGIN_DESCRIPTION }],
          },
        },
        { path: "{{entryRoot}}/.claude-plugin/plugin.json", json: { name: PLUGIN, description: PLUGIN_DESCRIPTION } },
        {
          path: "{{entryRoot}}/hooks/hooks.json",
          json: {
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "{{boot}}",
                      args: ["{{bootedHost}}", "hook", "{{loaderId}}", "session-start"],
                      timeout: HOOK_TIMEOUT_SECONDS,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      settings: [
        { file: SETTINGS_FILE, key: ["enabledPlugins", `${PLUGIN}@${MARKETPLACE}`], value: true },
        { file: SETTINGS_FILE, key: ["extraKnownMarketplaces", MARKETPLACE], value: { source: { source: "directory", path: "{{entryRoot}}" } } },
      ],
    },
  },
  pathCommands: { requested: ["cc"], minimum: 1 },
  background: [],
  plugins: ["claude-code-proxy"],
};

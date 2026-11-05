import { openRuntime, siblingRuntime, userHomeOf } from "@forebay/host";
import type { Runtime } from "@forebay/host";
import { HOST_ROOT } from "./catalog-world.js";
import type { World } from "./catalog-world.js";

export const LOADER = "claude-code-loader";

type Places = ReturnType<Runtime["places"]["resolve"]>;

function withLoaderHome<T>(world: World, use: (runtime: Runtime, places: Places, home: string) => T): T {
  const runtime = openRuntime(siblingRuntime(HOST_ROOT));
  try {
    const places = runtime.places.resolve({ home: userHomeOf(world.environment), environment: world.environment });
    const home = runtime.registry.get({ places, id: LOADER }).registration?.home;
    if (typeof home !== "string") throw new Error(`${LOADER} is not registered`);
    return use(runtime, places, home);
  } finally {
    runtime.close();
  }
}

/** Writes a setting of the loader's session host into its home's settings file, as a user editing it would. */
export function setLoaderSetting(world: World, key: string, value: unknown): void {
  withLoaderHome(world, (runtime, places, home) => runtime.settings.set({ home, portable: places.portable, key, value, layer: "application" }));
}

/** Writes one configuration value of `plugin` as the session host's `ctx.config.set` would store it. */
export function setPluginConfig(world: World, plugin: string, key: string, value: unknown): void {
  withLoaderHome(world, (runtime, places, home) => runtime.config.set({ home, portable: places.portable, plugin, config: {}, key, value, layer: "application" }));
}

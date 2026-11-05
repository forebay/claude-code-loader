import { createRequire } from "node:module";
import { dirname } from "node:path";
import { bundleLoader, siblingRuntime } from "@forebay/host";

const hostRoot = dirname(createRequire(import.meta.url).resolve("@forebay/host/package.json"));
await bundleLoader(".", "dist/host", siblingRuntime(hostRoot));

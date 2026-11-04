import { defineConfig } from "vitest/config";

// Only this repo's own tests, never a dependency's, which run in their own repos.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["siblings/**", "node_modules/**"] },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
    // Fusion timeout tests use fake-ish short timeouts; keep the default generous.
    testTimeout: 15_000,
  },
});

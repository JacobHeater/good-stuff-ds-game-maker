import { defineConfig } from "vitest/config";

// Emulator regression tests: build ROMs, run them in melonDS, compare with a reference render.
// One at a time (they share the desktop), and never in parallel with each other.
export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.rom.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000
  }
});

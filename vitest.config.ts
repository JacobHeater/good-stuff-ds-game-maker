import { configDefaults, defineConfig } from "vitest/config";

// Contract and unit tests for the packages that don't need Electron or React.
// Emulator tests (*.rom.test.ts) are slow and need a desktop, so they're excluded here and run by
// `pnpm test:rom` (vitest.rom.config.ts). End-to-end tests are separate (see requirements/testing/).
export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.rom.test.ts"],
    environment: "node"
  }
});

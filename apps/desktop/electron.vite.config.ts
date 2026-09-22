import { createElectronViteConfig } from "@goodstuff/build-config";
import { defineConfig } from "electron-vite";

export default defineConfig(
  createElectronViteConfig({
    rendererRoot: "src/renderer"
  })
);

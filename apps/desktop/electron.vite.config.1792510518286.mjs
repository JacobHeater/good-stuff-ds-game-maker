// electron.vite.config.ts
import { createElectronViteConfig } from "@goodstuff/build-config";
import { defineConfig } from "electron-vite";
var electron_vite_config_default = defineConfig(
  createElectronViteConfig({
    rendererRoot: "src/renderer"
  })
);
export {
  electron_vite_config_default as default
};

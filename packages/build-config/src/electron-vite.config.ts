import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite";

/**
 * Base electron-vite configuration shared by every Electron app in the monorepo.
 * Keeping this outside the app/UI layer means individual apps stay thin and
 * only need to describe their entry points.
 */
export function createElectronViteConfig(options: { rendererRoot: string }): {
  main: UserConfig;
  preload: UserConfig;
  renderer: UserConfig;
} {
  return {
    main: {
      build: {
        outDir: "out/main"
      }
    },
    preload: {
      build: {
        outDir: "out/preload"
      }
    },
    renderer: {
      root: options.rendererRoot,
      plugins: [react(), tailwindcss()],
      build: {
        outDir: "out/renderer"
      }
    }
  };
}

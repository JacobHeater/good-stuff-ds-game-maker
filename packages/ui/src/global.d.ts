import type { GoodStuffWindowApi } from "@goodstuff/core";

/**
 * `window.goodstuff` is provided by the Electron preload bridge
 * (apps/desktop/src/preload/index.ts) at runtime. This package is only
 * ever rendered inside that shell, so it's declared here too — typed
 * against the same shared `GoodStuffWindowApi` contract the preload
 * script itself is enforced against, so the two can't drift apart.
 */
declare global {
  interface Window {
    goodstuff: GoodStuffWindowApi;
  }
}

export {};

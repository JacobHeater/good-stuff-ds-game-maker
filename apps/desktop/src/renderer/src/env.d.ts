/// <reference types="vite/client" />

import type { GoodStuffWindowApi } from "@goodstuff/core";

declare global {
  interface Window {
    goodstuff: GoodStuffWindowApi;
  }
}

export {};

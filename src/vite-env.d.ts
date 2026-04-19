/// <reference types="vite/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

/** Injected by Vite from package.json — see vite.config.ts define. */
declare const __KEEPR_VERSION__: string;

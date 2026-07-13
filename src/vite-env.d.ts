/// <reference types="vite/client" />

declare var __MARKNOTE_ENV__:
  | {
      VITE_SYNC_CONFIG_URL?: string;
    }
  | undefined;
declare var __MARKNOTE_SYNC_CONFIG__: unknown;

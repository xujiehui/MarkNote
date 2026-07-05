export {};

declare global {
  interface Window {
    marknoteDesktop?: {
      platform: NodeJS.Platform;
      getAuthCallback?: () => Promise<string | null>;
      clearAuthCallback?: (url: string) => Promise<void>;
      onAuthCallback?: (callback: (url: string) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

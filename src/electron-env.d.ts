export {};

declare global {
  interface Window {
    marknoteDesktop?: {
      platform: NodeJS.Platform;
      onAuthCallback?: (callback: (url: string) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

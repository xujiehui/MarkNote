export {};

declare global {
  interface Window {
    marknoteDesktop?: {
      platform: NodeJS.Platform;
    };
  }
}

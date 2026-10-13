import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react(), {
      name: 'marknote-production-csp',
      apply: 'build',
      transformIndexHtml() {
        return [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https: wss:; worker-src 'self' blob:; object-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'none'",
          },
          injectTo: 'head-prepend',
        }];
      },
    }],
    define: {
      'globalThis.__MARKNOTE_ENV__': {
        VITE_SYNC_CONFIG_URL: env.VITE_SYNC_CONFIG_URL,
      },
    },
  };
});

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react()],
    define: {
      'globalThis.__MARKNOTE_ENV__': {
        VITE_SYNC_CONFIG_URL: env.VITE_SYNC_CONFIG_URL,
      },
    },
  };
});

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react()],
    define: {
      'globalThis.__MARKNOTE_ENV__': {
        VITE_SYNC_PROVIDER: env.VITE_SYNC_PROVIDER,
        VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
        VITE_SUPABASE_AUTH_REDIRECT_URL: env.VITE_SUPABASE_AUTH_REDIRECT_URL,
      },
    },
  };
});

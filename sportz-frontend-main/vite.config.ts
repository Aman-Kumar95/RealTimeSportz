import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const port = Number(env.VITE_DEV_PORT || 3000);
  const host = env.VITE_DEV_HOST || '0.0.0.0';
  const backendUrl = env.VITE_API_BASE_URL || 'http://localhost:8000';

  return {
    server: {
      port,
      host,
      proxy: {
        // Proxy WebSocket connections
        '/ws': {
          target: backendUrl.replace('http', 'ws'),
          ws: true,
          rewriteWsOrigin: true,
        },
        // Proxy REST API calls to the backend
        '/matches': {
          target: backendUrl,
          changeOrigin: true,
        },
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});

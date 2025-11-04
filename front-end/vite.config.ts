/**
 * Vite config for Accounting front-end.
 * Enables React plugin and sets dev server port.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: { port: 5176 },
  plugins: [react()],
  resolve: {
    dedupe: ['react','react-dom','react-router','react-router-dom']
  }
});
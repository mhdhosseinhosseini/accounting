/**
 * Vite config for Accounting front-end.
 * Enables React plugin and sets dev server port.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5176,
    fs: { allow: ['/Users/hsn/project/reacts/greenbunch/greenbunch'] }
  },
  plugins: [react()],
  resolve: {
    dedupe: ['react','react-dom','react-router','react-router-dom'],
    // Prefer TypeScript sources over JS duplicates during dev/build
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json']
  }
});
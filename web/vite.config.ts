import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The shared package is used from source, so the web app never needs `shared/dist` to be built first.
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

/**
 * The two sites (docs/ARCHITECTURE.md §8.11, D31) are two builds of this app: `vite --mode mantra` (or
 * `vite build --mode mantra`) makes the mantra site; any other mode the diary. Each has its own name, icons,
 * theme colour, palette (`data-site` on <html>, read by tokens.css) and service worker.
 */
const SITES = {
  diary: {
    name: '修行日記',
    description: '修行日記 · Cultivation Diary',
    themeColor: '#7A4E24',
    background: '#F6F2EC',
    publicDir: 'public',
    outDir: 'dist',
  },
  mantra: {
    name: '大悲咒共修報數',
    shortName: '大悲咒',
    description: '大悲咒共修報數 · Great Compassion Mantra',
    themeColor: '#29382F',
    background: '#FBFBFA',
    publicDir: 'public-mantra',
    outDir: 'dist-mantra',
  },
} as const;

export default defineConfig(({ mode }) => {
  const siteName = mode === 'mantra' ? 'mantra' : 'diary';
  const site: (typeof SITES)[keyof typeof SITES] = SITES[siteName];
  return {
    // Replaced at build time, so the other site's screens are left out of the bundle.
    define: { 'import.meta.env.VITE_SITE': JSON.stringify(siteName) },
    publicDir: site.publicDir,
    plugins: [
      react(),
      {
        name: 'site-html',
        transformIndexHtml: (html: string) =>
          html
            .replace('<html lang="zh-Hant">', `<html lang="zh-Hant" data-site="${siteName}">`)
            .replace('%SITE_NAME%', site.name)
            .replace('%SITE_THEME_COLOR%', site.themeColor),
      },
      // The installable app (spec §9.1, ARCHITECTURE §8.7).
      VitePWA({
        // A new version waits until the user chooses to reload (never while an editor has unsaved changes).
        registerType: 'prompt',
        // Registered from the app (src/components/AppUpdate.tsx), so the CSP needs no inline script.
        injectRegister: null,
        includeAssets: ['icons/apple-touch-icon.png'],
        manifest: {
          name: site.name,
          short_name: 'shortName' in site ? site.shortName : site.name,
          description: site.description,
          lang: 'zh-Hant',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: site.background,
          theme_color: site.themeColor,
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Only the app's own files (spec §9.1, engineering standards §12.4): never an API response, so
          // diary content never sits in the device's cache.
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          runtimeCaching: [],
          // Screens are addresses of the one page, offline too; the API is never answered from here.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: { alias: { '@diary/shared': sharedSrc } },
    server: {
      // `npm run dev:mantra` passes --port 5174.
      port: 5173,
      // `npm run dev` (the API) listens on :3000; same-origin requests keep the session cookie simple.
      proxy: { '/api': 'http://localhost:3000' },
    },
    build: { sourcemap: false, outDir: site.outDir },
  };
});

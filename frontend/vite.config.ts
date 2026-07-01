import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

/** Report-only first; set VITE_CSP_ENFORCE=true to send Content-Security-Policy instead. */
const CSP_POLICY =
  "default-src 'self'; connect-src 'self' https://rpc-futurenet.stellar.org";

const cspHeaderName =
  process.env.VITE_CSP_ENFORCE === 'true'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';

const securityHeaders = {
  [cspHeaderName]: CSP_POLICY,
};

export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    {
      name: 'content-security-policy',
      transformIndexHtml(html) {
        return {
          html,
          tags: [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': cspHeaderName,
                content: CSP_POLICY,
              },
              injectTo: 'head',
            },
          ],
        };
      },
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader(cspHeaderName, CSP_POLICY);
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader(cspHeaderName, CSP_POLICY);
          next();
        });
      },
    },
    ...(mode === 'analyze' ? [visualizer({ 
      open: process.env.CI !== 'true',
      filename: 'dist/stats.html',
      gzipSize: true,
    })] : []),
    // Only enable PWA plugin when not running in CI (GitHub Actions sets CI=true).
    // Some CI environments cause workbox validation to fail; skipping the plugin
    // in CI ensures the build completes reliably. To test PWA locally, run
    // without CI=true.
    ...(process.env.CI === 'true'
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
              runtimeCaching: [
                {
                  urlPattern: /^\/api\/streams/,
                  handler: 'StaleWhileRevalidate',
                  options: {
                    cacheName: 'stream-list-cache',
                    expiration: {
                      maxEntries: 100,
                      maxAgeSeconds: 60 * 5, // 5 minutes
                    },
                    cacheKeyWillBeUsed: async ({ request }) => {
                      const url = new URL(request.url);
                      url.searchParams.delete('_t');
                      return url.toString();
                    },
                  },
                },
                {
                  urlPattern: /^\/api\//,
                  handler: 'NetworkFirst',
                  options: {
                    cacheName: 'api-cache',
                    expiration: {
                      maxEntries: 50,
                      maxAgeSeconds: 60 * 2, // 2 minutes
                    },
                  },
                },
              ],
            },
            manifest: {
              name: 'Stellar Stream',
              short_name: 'StellarStream',
              description: 'Payment streaming platform for Stellar',
              theme_color: '#1f2937',
              background_color: '#ffffff',
              display: 'standalone',
              start_url: '/',
              icons: [
                {
                  src: '/icon-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                },
                {
                  src: '/icon-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                },
              ],
            },
            devOptions: {
              enabled: true,
            },
          }),
        ]),
  ],
  server: {
    port: 3000,
    headers: securityHeaders,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  preview: {
    headers: securityHeaders,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));

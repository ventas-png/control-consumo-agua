import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'

// Source-map upload to Sentry only runs when all three CI secrets are present.
// Without them the plugin is omitted entirely, so local/preview builds are
// unchanged and need no Sentry account.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT
const uploadSourcemaps = Boolean(sentryAuthToken && sentryOrg && sentryProject)

export default defineConfig({
  plugins: [
    react(),
    // PWA + offline-first (infra:I4, F2.8).
    //
    // generateSW (workbox) en lugar de injectManifest porque no necesitamos
    // un SW custom — solo precaching del app shell + runtime caching para
    // datos. registerType: 'autoUpdate' actualiza el SW sin pedirle al
    // usuario (la app es interna; los cambios deben llegar rápido).
    //
    // Estrategias runtime:
    //   - Fuentes Google: StaleWhileRevalidate (rara vez cambian).
    //   - Supabase REST (GET): NetworkFirst con timeout 5s + fallback al
    //     cache. Usuario en zona sin red ve datos cacheados en lugar de error.
    //   - Supabase Storage (imagenes): CacheFirst con expiry 30 dias.
    //
    // POST/PUT/DELETE NUNCA se cachean — workbox las deja pasar al network y
    // si falla retorna el error normal. Queue de operaciones offline es un
    // subsistema aparte (no MVP de este PR).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'AdministraTodo',
        short_name: 'AdministraTodo',
        description: 'Software de administración de condominios y control de agua',
        theme_color: '#1B3B36',
        background_color: '#1B3B36',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'es',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Algunos vendor chunks (xlsx, pdf) son grandes — bumpear el limite
        // para que entren al precache. Sin esto el build advierte y los excluye.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.hostname.endsWith('.supabase.co') &&
              url.pathname.startsWith('/rest/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.hostname.endsWith('.supabase.co') &&
              url.pathname.startsWith('/storage/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // SW desactivado en dev por defecto — interfiere con HMR. Para probar
        // PWA en local usar `npm run build && npm run preview`.
        enabled: false,
      },
    }),
    ...(uploadSourcemaps
      ? [sentryVitePlugin({ authToken: sentryAuthToken, org: sentryOrg, project: sentryProject })]
      : []),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      // Reporters: html para verlo localmente, text para el log de CI,
      // json-summary para futura comparación entre PRs.
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      // Sin thresholds en esta primera iteración: solo reportar. Cuando haya
      // baseline estable, fijar mínimos (p. ej. lines: 60) y subirlos por PR.
    },
  },
  build: {
    // Hidden maps are generated only when we upload+delete them, so they're
    // never shipped publicly.
    sourcemap: uploadSourcemaps ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-charts': ['chart.js'],
          'vendor-maps': ['leaflet'],
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          'vendor-xlsx': ['exceljs'],
          'vendor-ui': ['sweetalert2'],
          'vendor-observability': ['@sentry/react', 'posthog-js'],
        },
      },
    },
  },
})

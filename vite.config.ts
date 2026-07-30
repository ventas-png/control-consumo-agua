import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// Subresource Integrity (infra:I31). Añade integrity + crossorigin a los
// <script>/<link> que Vite emite en index.html (entry JS, CSS y modulepreloads).
// Hashea los BYTES YA ESCRITOS en disco (hook writeBundle) en vez del bundle en
// memoria: garantiza que el hash coincide EXACTAMENTE con lo que sirve Vercel
// (si no coincidiera, el navegador bloquearía el recurso y rompería la app).
// Corre antes del closeBundle de VitePWA, así el precache toma el HTML ya firmado.
function htmlSriPlugin(): Plugin {
  return {
    name: 'html-sri',
    apply: 'build',
    enforce: 'post',
    writeBundle(options) {
      const outDir = options.dir ?? 'dist'
      const indexPath = path.join(outDir, 'index.html')
      if (!fs.existsSync(indexPath)) return
      const html = fs.readFileSync(indexPath, 'utf8')
      const next = html.replace(/<(?:script|link)\b[^>]*>/g, (tag) => {
        if (/\bintegrity=/.test(tag)) return tag
        const m = tag.match(/\b(?:src|href)="([^"]+)"/)
        if (!m) return tag
        const ref = m[1]
        // Solo assets locales emitidos por el build (mismo origen, con hash).
        if (!ref.startsWith('/') && !ref.startsWith('./')) return tag
        if (!/\.(?:js|mjs|css)$/.test(ref)) return tag
        const filePath = path.join(outDir, ref.replace(/^\.?\//, ''))
        if (!fs.existsSync(filePath)) return tag
        const digest = crypto.createHash('sha384').update(fs.readFileSync(filePath)).digest('base64')
        // Vite ya pone crossorigin en module scripts/preloads; no lo dupliques.
        const needsCrossorigin = !/\bcrossorigin\b/.test(tag)
        const attrs = ` integrity="sha384-${digest}"${needsCrossorigin ? ' crossorigin="anonymous"' : ''}`
        return tag.endsWith('/>') ? `${tag.slice(0, -2)}${attrs} />` : `${tag.slice(0, -1)}${attrs}>`
      })
      if (next !== html) fs.writeFileSync(indexPath, next)
    },
  }
}

// Source-map upload to Sentry only runs when all three CI secrets are present.
// Without them the plugin is omitted entirely, so local/preview builds are
// unchanged and need no Sentry account.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT
const uploadSourcemaps = Boolean(sentryAuthToken && sentryOrg && sentryProject)

// Build para la app nativa (Capacitor). Lo activa el script `mobile:build`
// (CAPACITOR=true). Cambia dos cosas frente al build web:
//   - Sin service worker: dentro del WebView el SW es redundante y podría servir
//     assets obsoletos frente a las actualizaciones que llegan por las tiendas.
//   - Sin SRI: el integrity está pensado para assets servidos por CDN/Vercel; en
//     nativo los assets van empaquetados localmente (el hash no aporta seguridad)
//     y el crossorigin puede romper la carga en WKWebView (custom scheme).
const buildingForNative = process.env.CAPACITOR === 'true'

export default defineConfig({
  plugins: [
    react(),
    // Vite ignora plugins falsy: en build nativo omitimos el SRI (ver arriba).
    buildingForNative ? undefined : htmlSriPlugin(),
    // PWA + offline-first (infra:I4, F2.8).
    //
    // generateSW (workbox) en lugar de injectManifest porque no necesitamos
    // un SW custom — solo precaching del app shell + runtime caching para
    // datos. registerType: 'autoUpdate' actualiza el SW sin pedirle al
    // usuario (la app es interna; los cambios deben llegar rápido).
    //
    // Estrategias runtime:
    //   - Fuentes: self-hosted en /fonts (infra:I31); entran al precache vía
    //     globPatterns (woff2), ya no se cachean orígenes de Google.
    //   - Supabase REST (GET): NetworkFirst con timeout 5s + fallback al
    //     cache. Usuario en zona sin red ve datos cacheados en lugar de error.
    //   - Supabase Storage (imagenes): CacheFirst con expiry 30 dias.
    //
    // POST/PUT/DELETE NUNCA se cachean — workbox las deja pasar al network y
    // si falla retorna el error normal. Queue de operaciones offline es un
    // subsistema aparte (no MVP de este PR).
    VitePWA({
      // En build nativo el SW se desactiva por completo (ver buildingForNative).
      disable: buildingForNative,
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
        // vite 8 (rolldown) solo acepta manualChunks como FUNCIÓN — la forma
        // objeto de rollup lanza "manualChunks is not a function". Mismo
        // particionado de vendors que antes, expresado por id de módulo.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react-dom|react|scheduler)\//.test(id)) return 'vendor-react'
          if (id.includes('node_modules/chart.js/')) return 'vendor-charts'
          if (id.includes('node_modules/leaflet/')) return 'vendor-maps'
          if (/node_modules\/(jspdf-autotable|jspdf)\//.test(id)) return 'vendor-pdf'
          if (id.includes('node_modules/exceljs/')) return 'vendor-xlsx'
          if (/node_modules\/(@sentry\/react|posthog-js)\//.test(id)) return 'vendor-observability'
          return undefined
        },
      },
    },
  },
})

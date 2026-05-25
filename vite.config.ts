import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

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
    ...(uploadSourcemaps
      ? [sentryVitePlugin({ authToken: sentryAuthToken, org: sentryOrg, project: sentryProject })]
      : []),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
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

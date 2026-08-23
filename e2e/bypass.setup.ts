// Proyecto `setup` de Playwright (ver playwright.config.ts): corre ANTES que
// el proyecto chromium y siembra la cookie de bypass de la Vercel Deployment
// Protection con UNA petición al origen exacto del Preview — el token no entra
// jamás al contexto del navegador; las páginas usan la cookie guardada en
// RUTA_ESTADO. Racional completo en e2e/fixtures/vercelBypass.ts.
//
// Extensión .setup.ts a propósito: ni Vitest (glob *.{test,spec}.ts) ni el
// testMatch *.e2e.ts del proyecto chromium lo recogen; sólo el proyecto
// `setup` (testMatch propio). Sin token escribe un estado vacío igualmente,
// para que `storageState` exista cuando chromium arranque en local.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { test as setup } from '@playwright/test'

import { RUTA_ESTADO, sembrarCookieDeBypass } from './fixtures/vercelBypass'

setup('sembrar la cookie de bypass en el origen exacto del Preview', async ({ request, baseURL }) => {
  await sembrarCookieDeBypass(request, baseURL ?? '', process.env.E2E_VERCEL_BYPASS_TOKEN || '')
  mkdirSync(dirname(RUTA_ESTADO), { recursive: true })
  await request.storageState({ path: RUTA_ESTADO })
})

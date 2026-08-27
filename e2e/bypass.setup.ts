// Proyecto `setup` de Playwright (ver playwright.config.ts): corre ANTES que
// el proyecto chromium y deja listo el storageState que ése carga. Hace dos
// cosas, ambas para que las pruebas midan la app y no su periferia:
//
//   1. Siembra la cookie de bypass de la Vercel Deployment Protection con UNA
//      petición al origen exacto del Preview — el token no entra jamás al
//      contexto del navegador. Racional completo en fixtures/vercelBypass.ts.
//   2. Siembra la decisión del aviso de cookies en localStorage, para que el
//      banner (que es un role="dialog" fijo y tapa los botones de guardar) no
//      intercepte los clics. Racional completo en fixtures/consentimiento.ts.
//
// Extensión .setup.ts a propósito: ni Vitest (glob *.{test,spec}.ts) ni el
// testMatch *.e2e.ts del proyecto chromium lo recogen; sólo el proyecto
// `setup` (testMatch propio). Sin token escribe el estado igualmente, para que
// `storageState` exista cuando chromium arranque en local.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { test as setup } from '@playwright/test'

import { conConsentimientoSembrado } from './fixtures/consentimiento'
import { RUTA_ESTADO, sembrarCookieDeBypass } from './fixtures/vercelBypass'

setup('sembrar la cookie de bypass y el consentimiento de cookies', async ({ request, baseURL }) => {
  const url = baseURL ?? ''
  await sembrarCookieDeBypass(request, url, process.env.E2E_VERCEL_BYPASS_TOKEN || '')

  // storageState() sin `path` devuelve el objeto: hay que reescribirlo para
  // añadirle el localStorage (un APIRequestContext sólo aporta cookies).
  const estado = await request.storageState()
  mkdirSync(dirname(RUTA_ESTADO), { recursive: true })
  writeFileSync(RUTA_ESTADO, JSON.stringify(conConsentimientoSembrado(estado, url), null, 2))
})

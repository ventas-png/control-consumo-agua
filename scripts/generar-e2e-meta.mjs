#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Genera dist/e2e-meta.json: la identidad PÚBLICA y SEGURA del despliegue.
// ════════════════════════════════════════════════════════════════════════════
// El preflight E2E (scripts/e2e-preflight.mjs) no confía en que una URL "sea"
// el entorno de pruebas: se lo pregunta al propio despliegue. Este archivo es
// la respuesta, y se genera en CADA build (el script cuelga del npm run build,
// así que Vercel lo produce en cada deploy):
//
//   commit_sha           — qué commit corre ahí. El preflight ABORTA si no es
//                          el SHA que el PR está probando: sin esto, un
//                          despliegue viejo validaría código que ya no existe.
//   environment          — 'e2e-sandbox' SÓLO si el build llevaba
//                          VITE_E2E_ENVIRONMENT=e2e-sandbox. Es el marcador de
//                          validación POSITIVA: producción nunca lo lleva, así
//                          que un alias desconocido falla aunque no esté en
//                          ninguna denylist.
//   supabase_project_ref — el ref del proyecto al que el bundle apunta. NO es
//                          un secreto (viaja en el bundle del cliente); aquí
//                          sólo se hace legible para que el preflight lo cruce
//                          con E2E_EXPECTED_SUPABASE_REF.
//
// NADA MÁS: ni claves, ni URLs internas, ni nombres de usuario. Todo lo que
// este archivo publica ya es observable desde el navegador.

import { mkdirSync, writeFileSync } from 'node:fs'

/** El ref es el primer segmento del hostname de Supabase: <ref>.supabase.co. */
export function refDeSupabaseUrl(url) {
  if (!url) return null
  try {
    return new URL(url).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

/** Pura: arma el objeto a partir del entorno del build. */
export function construirMeta(env = {}) {
  return {
    // Vercel expone el sha del commit desplegado; GITHUB_SHA cubre builds en
    // Actions; null significa "build local" y el preflight lo rechaza.
    commit_sha: env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || null,
    environment: env.VITE_E2E_ENVIRONMENT === 'e2e-sandbox' ? 'e2e-sandbox' : 'no-e2e',
    supabase_project_ref: refDeSupabaseUrl(env.VITE_SUPABASE_URL),
  }
}

export function main(env = process.env, destino = 'dist/e2e-meta.json') {
  const meta = construirMeta(env)
  mkdirSync('dist', { recursive: true })
  writeFileSync(destino, JSON.stringify(meta, null, 2) + '\n')
  console.log(`e2e-meta.json → ${JSON.stringify(meta)}`)
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}

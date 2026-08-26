// ════════════════════════════════════════════════════════════════════════════
// Bypass de la Vercel Deployment Protection, LIMITADO AL ORIGEN del Preview.
// ════════════════════════════════════════════════════════════════════════════
// El token NO viaja como header global del navegador: `use.extraHTTPHeaders`
// acompaña TODAS las solicitudes del contexto — también las que la app hace a
// otros orígenes (Supabase, analytics, CDNs), que recibirían el secreto.
//
// El mecanismo seguro tiene dos pasos:
//
//   1. El proyecto `setup` de Playwright (e2e/bypass.setup.ts) hace UNA sola
//      petición, únicamente contra el origen de E2E_BASE_URL, con los headers
//      x-vercel-protection-bypass y x-vercel-set-bypass-cookie: true. Vercel
//      responde sembrando la cookie de bypass para ESE origen.
//   2. El estado de cookies se guarda en RUTA_ESTADO (request.storageState) y
//      el proyecto `chromium` lo carga como `storageState`: las navegaciones
//      usan la COOKIE — que el navegador sólo envía a su propio origen — y el
//      token nunca entra al contexto del navegador.
//
// El token no aparece en URLs, logs, reportes, traces ni artifacts: sólo viaja
// en el header de esa única petición. RUTA_ESTADO queda fuera de git y fuera
// de los paths que el workflow sube como artifact.
//
// Probado con DOS orígenes locales en scripts/__tests__/e2e-bypass.test.mjs:
// el token llega sólo al origen del Preview y jamás al segundo origen.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

/** Dónde guarda el setup las cookies que el proyecto chromium carga. Absoluta:
 *  `use.storageState` resuelve rutas relativas contra el directorio del config
 *  y `request.storageState` contra el cwd — una relativa apuntaría a dos
 *  archivos distintos. */
export const RUTA_ESTADO = join(AQUI, '..', '.estado', 'bypass-storage.json')

export const HEADER_BYPASS = 'x-vercel-protection-bypass'
export const HEADER_SIEMBRA_COOKIE = 'x-vercel-set-bypass-cookie'

/** La única URL que recibe el token: /e2e-meta.json del PROPIO origen. */
export function urlDeSiembra(baseURL: string): string {
  return new URL('/e2e-meta.json', baseURL).toString()
}

/** Lo mínimo que se necesita de APIRequestContext — tipado estructural para
 *  poder probar la función con un doble que registra peticiones reales contra
 *  servidores locales, sin depender de Playwright en vitest. */
export interface PeticionMinima {
  get(
    url: string,
    opciones: { headers: Record<string, string>; failOnStatusCode: boolean },
  ): Promise<unknown>
}

/**
 * Siembra la cookie de bypass con una única petición al origen de `baseURL`.
 * Sin token o sin baseURL no hace NINGUNA petición (local contra un dev server
 * sin protección). Un 401 aquí no revienta el setup: la navegación posterior
 * fallará con un 401 visible y el preflight ya diagnostica el token inválido.
 *
 * @returns true si la petición de siembra se hizo.
 */
export async function sembrarCookieDeBypass(
  request: PeticionMinima,
  baseURL: string,
  token: string,
): Promise<boolean> {
  if (!token || !baseURL) return false
  await request.get(urlDeSiembra(baseURL), {
    headers: {
      [HEADER_BYPASS]: token,
      [HEADER_SIEMBRA_COOKIE]: 'true',
    },
    failOnStatusCode: false,
  })
  return true
}

import cobertura from './coverage.json'
// MISMA validación que usan el seed (`scripts/seed-rls-sandbox.mjs`) y el
// preflight del workflow (`scripts/rls-preflight.mjs`). Se importa, no se
// reimplementa: tres copias divergen, y la que se queda corta es justo la que
// escribe donde no debe.
import { validarDestino } from '../../../scripts/rls-destino.mjs'

// ════════════════════════════════════════════════════════════════════════════
// Guard de destino del harness RLS — defensa en profundidad.
// ════════════════════════════════════════════════════════════════════════════
// El preflight del workflow ya valida a qué proyecto apunta el harness, pero
// protege el camino de CI y sólo ese. No protege a quien exporta las variables
// en su terminal y corre `npx vitest src/test/rls/rlsHarness.test.ts`, que es
// exactamente cómo se depura esta suite; ni al día en que alguien reordene los
// pasos del YAML. Como el harness hace INSERT, UPDATE y DELETE, la comprobación
// se repite aquí.
//
// Vive en su propio módulo —y no dentro de `rlsHarness.test.ts`— para poder
// probarlo sin importar un archivo de pruebas desde otro. Un test que importa
// otro test arrastra sus `describe` al contexto de quien importa, y eso es
// frágil hasta cuando funciona.
//
// Este módulo NO importa `@supabase/supabase-js` ni ninguna otra cosa capaz de
// abrir un socket. Que "aborta antes de conectarse" no es una promesa sobre el
// orden de los pasos: es una propiedad de sus importaciones.

/**
 * Las quince variables que el harness necesita: siete del aislamiento por
 * tenant y ocho del gate por clase de `paquetes_recibidos`.
 *
 * Las ocho del gate son OBLIGATORIAS, no opcionales. Mientras lo fueron, su
 * bloque se auto-saltaba con un `describe.skipIf` y el job terminaba verde con
 * 13 pruebas omitidas — el mismo falso verde por omisión, un nivel más abajo.
 */
export interface EntornoRls {
  RLS_SUPABASE_URL?: string
  RLS_SUPABASE_ANON_KEY?: string
  RLS_EXPECTED_PROJECT_REF?: string
  RLS_USER_A_EMAIL?: string
  RLS_USER_A_PASSWORD?: string
  RLS_USER_B_EMAIL?: string
  RLS_USER_B_PASSWORD?: string
  RLS_USER_PAQ_EMAIL?: string
  RLS_USER_PAQ_PASSWORD?: string
  RLS_USER_CORR_EMAIL?: string
  RLS_USER_CORR_PASSWORD?: string
  RLS_USER_ADMIN_EMAIL?: string
  RLS_USER_ADMIN_PASSWORD?: string
  RLS_USER_OWNER_EMAIL?: string
  RLS_USER_OWNER_PASSWORD?: string
}

export type Destino =
  | { ok: true; ref: string }
  | { ok: false; clave: string; motivo: string }

/**
 * ¿Están las catorce credenciales? (la quinceava variable,
 * `RLS_EXPECTED_PROJECT_REF`, es la declaración del destino, no una credencial).
 *
 * Se exigen TODAS, las del gate por clase incluidas: con las de tenant puestas
 * y las de clase vacías, el harness corría a medias y el reporte lo contaba
 * como cobertura completa.
 */
export function credencialesPresentes(env: EntornoRls): boolean {
  return Boolean(
    env.RLS_SUPABASE_URL &&
    env.RLS_SUPABASE_ANON_KEY &&
    env.RLS_USER_A_EMAIL &&
    env.RLS_USER_A_PASSWORD &&
    env.RLS_USER_B_EMAIL &&
    env.RLS_USER_B_PASSWORD &&
    env.RLS_USER_PAQ_EMAIL &&
    env.RLS_USER_PAQ_PASSWORD &&
    env.RLS_USER_CORR_EMAIL &&
    env.RLS_USER_CORR_PASSWORD &&
    env.RLS_USER_ADMIN_EMAIL &&
    env.RLS_USER_ADMIN_PASSWORD &&
    env.RLS_USER_OWNER_EMAIL &&
    env.RLS_USER_OWNER_PASSWORD,
  )
}

/**
 * Resuelve el destino. Sin credenciales no se evalúa nada: es el caso local
 * normal (la suite no declara pruebas) y no debe confundirse con un destino
 * peligroso.
 */
export function resolverDestino(env: EntornoRls): Destino {
  if (!credencialesPresentes(env)) {
    return { ok: false, clave: 'sin-credenciales', motivo: 'faltan variables RLS_*' }
  }
  return validarDestino({
    url: env.RLS_SUPABASE_URL,
    esperado: env.RLS_EXPECTED_PROJECT_REF,
    cobertura,
    variable: 'RLS_EXPECTED_PROJECT_REF',
  }) as Destino
}

/**
 * Decide si el harness puede correr, y LANZA si hay credenciales pero el
 * destino no está declarado.
 *
 * Lanzar es deliberado: con credenciales presentes, un destino rechazado es un
 * error de configuración que hay que ver, no una omisión que se traga en
 * silencio. En CI el preflight ya habría fallado antes; esto cubre la ejecución
 * a mano, que es la que nadie vigila.
 */
export function exigirDestinoDeclarado(env: EntornoRls): { habilitado: boolean; destino: Destino } {
  const destino = resolverDestino(env)

  if (destino.ok) return { habilitado: true, destino }
  if (destino.clave === 'sin-credenciales') return { habilitado: false, destino }

  throw new Error(
    `Harness RLS ABORTADO — destino no declarado: ${destino.motivo}\n` +
    'Esta suite hace INSERT, UPDATE y DELETE de filas de prueba. No se abre ninguna ' +
    'conexión hasta que RLS_SUPABASE_URL y RLS_EXPECTED_PROJECT_REF coincidan y no ' +
    'apunten a producción.',
  )
}

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guard ESTÁTICO de `failClosed` en los endpoints ANÓNIMOS.
//
// POR QUÉ ESTÁTICO. Los `index.ts` de las edge functions llaman `Deno.serve()` al
// importarse, así que no se pueden montar desde vitest: no hay forma de testear
// esta decisión ejecutando la función. Lo que sí se puede es leer el fuente y
// comprobar que la decisión sigue ESCRITA. Es el mismo trato que hacen los otros
// guards de este directorio con el SQL de las migraciones.
//
// QUÉ PROTEGE. `_shared/rateLimit.ts` documenta la regla desde la auditoría
// 2026-07-28 (PR-21): en un endpoint anónimo el rate limit es el ÚNICO control,
// así que un fallo del contador debe responder 503 (`failClosed: true`), no dejar
// pasar. Si falla abierto, tumbar el RPC `rate_limit_hit` —que es lo primero que
// provocaría un atacante— abre el endpoint del todo. La regla estaba escrita pero
// solo la aplicaba `log-security-event`; `signup-company` y
// `create-cliente-account` llevaban meses fallando abierto sin que nada avisara.
//
// La tercera prueba es la que impide que vuelva a pasar: toda función que use el
// rate limit tiene que estar clasificada aquí. Una edge function nueva rompe el
// test hasta que alguien decida —y deje escrito— en qué grupo cae.

const FUNCTIONS_DIR = resolve('supabase/functions')

/**
 * Endpoints ANÓNIMOS: el rate limit corre ANTES de cualquier autenticación (o no
 * hay ninguna). Aquí `failClosed: true` es obligatorio en TODOS sus límites.
 *
 * `validateOrigin` no cuenta como control: un cliente que no sea un navegador
 * manda el Origin que quiera, y el propio comentario de create-cliente-account
 * lo dice.
 */
const ANONIMOS = [
  'signup-company',
  'create-cliente-account',
  'log-security-event',
] as const

/**
 * Autentican ANTES de limitar: el JWT ya filtró al llamador, así que el contador
 * es una segunda capa. Ahí fail-open es lo correcto —lo que dice rateLimit.ts—
 * porque tumbar a usuarios legítimos por un fallo de infraestructura es peor.
 */
const AUTENTICA_ANTES = [
  'complete-oauth-onboarding',
  'google-oauth-initiate',
  'google-oauth-callback',
  'invite-user',
  'create-user',
  'create-broadcast',
  'create-payment-intent',
  'timbrar-documento',
  'create-charge',
  'confirm-charge',
  'whatsapp-save-credentials',
] as const

/**
 * Anónimos donde el rate limit es explícitamente defensa en profundidad, no el
 * control principal: `accept-invitation` protege un token de 32 bytes de entropía
 * y su propio comentario lo declara así. Fail-open aceptado a propósito.
 */
const DEFENSA_EN_PROFUNDIDAD = ['accept-invitation'] as const

/** Región de texto de una llamada `enforceRateLimit(s)(...)`, con paréntesis balanceados. */
function llamadasDeRateLimit(fuente: string): string[] {
  const regiones: string[] = []
  const re = /enforceRateLimits?\s*\(/g
  for (const m of fuente.matchAll(re)) {
    let i = m.index + m[0].length
    let prof = 1
    while (i < fuente.length && prof > 0) {
      if (fuente[i] === '(') prof++
      else if (fuente[i] === ')') prof--
      i++
    }
    regiones.push(fuente.slice(m.index, i))
  }
  return regiones
}

/** Funciones cuyo `index.ts` invoca el rate limit. */
function funcionesConRateLimit(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter(d => d !== '_shared')
    .filter(d => existsSync(join(FUNCTIONS_DIR, d, 'index.ts')))
    .filter(d => /enforceRateLimits?\s*\(/.test(readFileSync(join(FUNCTIONS_DIR, d, 'index.ts'), 'utf8')))
    .sort()
}

function fuenteDe(fn: string): string {
  return readFileSync(join(FUNCTIONS_DIR, fn, 'index.ts'), 'utf8')
}

describe('failClosed en los endpoints anónimos', () => {
  it.each(ANONIMOS)('%s exige failClosed en todos sus límites', fn => {
    const regiones = llamadasDeRateLimit(fuenteDe(fn))
    expect(regiones.length, `${fn} ya no llama a enforceRateLimit`).toBeGreaterThan(0)

    for (const region of regiones) {
      // Un `subject:` por límite; cada uno necesita su `failClosed: true`.
      const limites = (region.match(/subject\s*:/g) ?? []).length
      const cerrados = (region.match(/failClosed\s*:\s*true/g) ?? []).length
      expect(
        cerrados,
        `${fn}: ${limites} límite(s) pero ${cerrados} con failClosed:true. ` +
        'Es un endpoint anónimo: si el RPC rate_limit_hit cae, fail-open lo deja abierto de par en par.',
      ).toBe(limites)
    }
  })

  it('ninguno de los anónimos lo desactiva con failClosed: false', () => {
    for (const fn of ANONIMOS) {
      expect(fuenteDe(fn), `${fn} desactiva failClosed explícitamente`).not.toMatch(/failClosed\s*:\s*false/)
    }
  })
})

describe('clasificación de los endpoints con rate limit', () => {
  // Sin esta prueba, la siguiente edge function anónima repite el olvido en
  // silencio: nadie revisa una lista que no se valida sola.
  it('toda función con rate limit está clasificada en exactamente un grupo', () => {
    const clasificadas = new Map<string, string>()
    for (const [grupo, lista] of [
      ['ANONIMOS', ANONIMOS],
      ['AUTENTICA_ANTES', AUTENTICA_ANTES],
      ['DEFENSA_EN_PROFUNDIDAD', DEFENSA_EN_PROFUNDIDAD],
    ] as const) {
      for (const fn of lista) {
        expect(clasificadas.has(fn), `${fn} está en dos grupos a la vez`).toBe(false)
        clasificadas.set(fn, grupo)
      }
    }

    const reales = funcionesConRateLimit()
    const sinClasificar = reales.filter(fn => !clasificadas.has(fn))
    expect(
      sinClasificar,
      'Edge function nueva con rate limit y sin clasificar. Decidí si es ANÓNIMA ' +
      '(→ failClosed: true obligatorio), si AUTENTICA_ANTES (fail-open correcto) o ' +
      'si el límite es DEFENSA_EN_PROFUNDIDAD, y anotala en este test.',
    ).toEqual([])

    const fantasmas = [...clasificadas.keys()].filter(fn => !reales.includes(fn))
    expect(fantasmas, 'Clasificadas aquí pero ya no usan rate limit: sobran en la lista.').toEqual([])
  })
})

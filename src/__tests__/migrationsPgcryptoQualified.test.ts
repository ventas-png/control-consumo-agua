import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guard de regresión del bug "function gen_random_bytes(integer) does not exist"
// (portal del residente → Paquetería → Autorizar y generar código, 2026-07-24).
//
// `20260318000001_fix_function_search_path_and_move_extensions.sql` movió
// pgcrypto y uuid-ossp del schema `public` al schema `extensions`. Desde ese
// punto, cualquier llamada a una función de esas extensiones dentro de una
// función con `SET search_path = public` (o `= ''`) falla EN TIEMPO DE
// EJECUCIÓN: plpgsql resuelve los nombres en la primera ejecución, así que la
// migración aplica sin error y el fallo aparece recién cuando un usuario usa la
// pantalla. Ese fue exactamente el modo de falla de
// `20260717120000_paquetes_codigo_retiro_cripto.sql`.
//
// Regla: en `supabase/migrations/`, toda llamada a pgcrypto / uuid-ossp va
// calificada con `extensions.` — nunca desnuda. Es la convención que ya seguían
// `20260606130000_company_sso_domains.sql` (`extensions.gen_random_bytes`) y
// `20260320000002` / `20260320000004` (`extensions.crypt`, `extensions.gen_salt`).
//
// OJO: `gen_random_uuid()` NO entra aquí — es core de PostgreSQL (pg_catalog)
// desde PG13, no pgcrypto, y se resuelve siempre.

const MIGRATIONS_DIR = resolve('supabase/migrations')

/** Funciones que viven en el schema `extensions` (pgcrypto + uuid-ossp). */
const EXTENSION_FUNCTIONS = [
  'gen_random_bytes',
  'gen_salt',
  'crypt',
  'digest',
  'hmac',
  'pgp_sym_encrypt',
  'pgp_sym_decrypt',
  'pgp_pub_encrypt',
  'pgp_pub_decrypt',
  'armor',
  'dearmor',
  'uuid_generate_v1',
  'uuid_generate_v4',
]

// Migraciones históricas que contienen llamadas desnudas y NO se pueden editar
// (ya aplicadas en producción; reescribirlas rompería la reproducibilidad).
// Cada una debe declarar por qué es inofensiva.
const ALLOWLIST: Record<string, string> = {
  '20260317000001_baseline_legacy_tables_phase2.sql':
    'Baseline legacy: escrito cuando pgcrypto aún vivía en `public`. Las tres funciones ' +
    'afectadas quedaron reparadas en 20260318000001, que les fija ' +
    '`search_path = public, extensions, pg_temp` en el mismo commit que mueve la extensión.',
  '20260717120000_paquetes_codigo_retiro_cripto.sql':
    'Migración con el bug original (B5). Ya aplicada en prod, así que no se reescribe: ' +
    'la corrige 20260724000000_fix_paquete_autorizar_salida_pgcrypto.sql, que hace ' +
    'CREATE OR REPLACE de la función con el schema calificado.',
}

/** Quita comentarios de línea (`-- …`) y de bloque para no reportar prosa. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '')
}

/**
 * Llamadas a funciones de extensión sin calificar. El lookbehind `[\w.]`
 * descarta tanto `extensions.crypt(` (ya calificada) como `pgp_sym_encrypt(`
 * cuando el patrón buscado es `encrypt`.
 */
function unqualifiedCalls(sql: string): string[] {
  const body = stripSqlComments(sql)
  const hits: string[] = []
  for (const fn of EXTENSION_FUNCTIONS) {
    const re = new RegExp(`(?<![\\w.])${fn}\\s*\\(`, 'g')
    for (const line of body.split('\n')) {
      re.lastIndex = 0
      if (re.test(line)) hits.push(`${fn} → ${line.trim()}`)
    }
  }
  return hits
}

describe('migraciones: funciones de pgcrypto/uuid-ossp calificadas con `extensions.`', () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  it('encuentra migraciones que analizar', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s no llama a pgcrypto/uuid-ossp sin calificar', (file) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    const hits = unqualifiedCalls(sql)
    if (ALLOWLIST[file]) {
      // Allowlisted: se tolera, pero debe seguir teniendo hits — si ya no los
      // tiene, la entrada del allowlist sobra y hay que borrarla.
      expect(hits.length, `${file} ya no tiene llamadas desnudas: quitar del ALLOWLIST`).toBeGreaterThan(0)
      return
    }
    expect(hits, `${file}: usar \`extensions.<fn>(…)\`, no la llamada desnuda`).toEqual([])
  })

  it('la corrección de paquete_autorizar_salida califica el schema', () => {
    const fix = readFileSync(
      join(MIGRATIONS_DIR, '20260724000000_fix_paquete_autorizar_salida_pgcrypto.sql'),
      'utf-8',
    )
    expect(fix).toContain('extensions.gen_random_bytes(1)')
    expect(unqualifiedCalls(fix)).toEqual([])
  })
})

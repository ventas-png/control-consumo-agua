// ════════════════════════════════════════════════════════════════════════════
// `bootstrap-branch.sql` sólo puede diferir de `bootstrap.sql` en UNA cosa
// ════════════════════════════════════════════════════════════════════════════
// Los dos andamiajes se mantienen sincronizados A MANO, y esa es exactamente la
// clase de cosa que se desincroniza en silencio. Si divergieran en otra cosa,
// la prueba de replay (supabase/tests/replay_acl_helpers/) estaría midiendo un
// entorno distinto del que mide el auditor de drift, y su conclusión —«la
// cadena reconstruye desde cero»— dejaría de valer para el auditor.
//
// La única diferencia permitida es el GRANT por defecto sobre FUNCIONES, que
// `bootstrap-branch.sql` NO hace porque una Supabase Branch real tampoco lo
// hace. Eso fue lo que ocultó el defecto de `20260909000000`.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const leer = (f) => readFileSync(join(AQUI, '..', f), 'utf8')

const LINEA_REGALO = 'GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;'

/**
 * Cuerpo comparable: desde la primera sección real, sin comentarios, sin líneas
 * en blanco y sin sangría — así la comparación mide SENTENCIAS y no formato.
 */
function cuerpo(sql) {
  const i = sql.indexOf('-- ── roles ')
  return sql
    .slice(i === -1 ? 0 : i)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.trimStart().startsWith('--'))
}

describe('bootstrap-branch.sql · el andamiaje «como una branch de verdad»', () => {
  const normal = leer('bootstrap.sql')
  const branch = leer('bootstrap-branch.sql')

  // Se compara el CUERPO EJECUTABLE, no el texto: la cabecera del archivo de
  // branch cita la línea prohibida para explicar por qué no está, y un
  // `toContain` sobre el texto crudo la encontraría ahí.
  it('el bootstrap normal SÍ concede funciones por defecto', () => {
    expect(cuerpo(normal)).toContain(LINEA_REGALO)
  })

  it('el de branch NO las concede: es el punto entero del archivo', () => {
    expect(cuerpo(branch)).not.toContain(LINEA_REGALO)
  })

  it('conserva los defaults de TABLAS y SECUENCIAS (sólo cambia el de funciones)', () => {
    for (const sql of [normal, branch]) {
      expect(cuerpo(sql)).toContain('GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;')
      expect(cuerpo(sql)).toContain('GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;')
    }
  })

  it('no difieren en NADA más: misma secuencia de sentencias', () => {
    const soloEnNormal = cuerpo(normal).filter((l) => !cuerpo(branch).includes(l))
    const soloEnBranch = cuerpo(branch).filter((l) => !cuerpo(normal).includes(l))
    expect(soloEnNormal, 'líneas que el de branch perdió').toEqual([LINEA_REGALO])
    expect(soloEnBranch, 'líneas que el de branch añadió por su cuenta').toEqual([])
  })

  it('crea los mismos roles: sin ellos la prueba de ACL no mediría nada', () => {
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      expect(branch).toContain(`CREATE ROLE ${rol}`)
    }
  })

  it('la línea que falta es la ÚLTIMA de su ALTER DEFAULT PRIVILEGES, no media sentencia', () => {
    // Si se hubiera borrado sólo la línea del GRANT dejando el `ALTER DEFAULT
    // PRIVILEGES IN SCHEMA public` colgando, el archivo no sería SQL válido y
    // la prueba de replay fallaría por la razón equivocada.
    const alters = cuerpo(branch).filter((l) => l.startsWith('ALTER DEFAULT PRIVILEGES'))
    expect(alters).toHaveLength(2)
  })
})

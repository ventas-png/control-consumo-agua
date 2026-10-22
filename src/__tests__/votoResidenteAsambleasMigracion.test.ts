import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de 20261104000050: el residente ve las asambleas clásicas
// de su condominio y el propietario vota desde el portal.
//
// ALCANCE Y LÍMITE. Esto lee el SQL y el código del repo; no ejecuta nada. La
// verificación CONDUCTUAL —quién ve qué, quién vota dónde, append-only, el
// candado de plan, los totales— vive en
// supabase/tests/voto_residente_asambleas/run.sh, con dieciséis mutantes, y
// corre en cada PR (job rls-sandbox de coverage.yml).
//
// Lo que se vigila AQUÍ es lo que ese arnés no puede afirmar sobre sí mismo:
// que la pantalla y la base hablen de lo MISMO. El arnés prueba la base contra
// sí misma; si el portal vuelve a leer otra tabla, a mandar otros valores de
// voto o a votar sin firmar, el arnés sigue verde y el voto se rechaza.

const MIGRACION = resolve('supabase/migrations/20261104000050_asambleas_voto_residente.sql')
/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const sql = readFileSync(MIGRACION, 'utf8').replace(/--[^\n]*/g, '')
const portal = readFileSync(resolve('src/components/condominios/tabs/PortalAsambleasTab.tsx'), 'utf8')
const panel = readFileSync(resolve('src/components/condominios/tabs/AsambleasTab.tsx'), 'utf8')
const consultas = readFileSync(resolve('src/domain/condominios/tabQueries.ts'), 'utf8')
const tipos = readFileSync(resolve('src/types/condominios/gobernanza.ts'), 'utf8')
const coverage = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')

/** Literales de un `export type X = 'a' | 'b'`. */
function literales(tipo: string): string[] {
  const m = tipos.match(new RegExp(`export type ${tipo} = ([^\\n]+)`))
  if (!m) throw new Error(`no se encontró el tipo ${tipo}`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
}

/** Cuerpo de una función exportada de tabQueries (hasta la siguiente). */
function consulta(nombre: string): string {
  const desde = consultas.indexOf(`export async function ${nombre}`)
  if (desde < 0) throw new Error(`no existe ${nombre} en tabQueries`)
  const hasta = consultas.indexOf('export ', desde + 10)
  return consultas.slice(desde, hasta < 0 ? undefined : hasta)
}

describe('20261104000050 · la pantalla y la base usan los mismos valores', () => {
  it('el CHECK de votos_asamblea admite exactamente TipoVoto', () => {
    const m = sql.match(/CHECK \(voto IN \(([^)]*)\)\)/)
    expect(m).not.toBeNull()
    const enCheck = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
    expect(enCheck).toEqual(literales('TipoVoto'))
  })

  it('el portal y el panel votan con TipoVoto (no los «favor»/«contra» de antes)', () => {
    expect(portal).toMatch(/import type \{[^}]*\bTipoVoto\b[^}]*\} from '..\/..\/..\/types'/)
    expect(panel).toMatch(/\bTipoVoto\b/)
    for (const v of literales('TipoVoto')) expect(portal).toContain(`votar(p, '${v}')`)
    expect(portal).not.toMatch(/'favor'|'contra'/)
  })

  it('sólo se vota en puntos de tipo «votacion», el mismo literal en la RLS, el tipo y el portal', () => {
    expect(literales('TipoPunto')).toContain('votacion')
    expect(sql).toContain("AND p.tipo = 'votacion'")
    expect(portal).toContain("p.tipo === 'votacion' && a.estado === 'en_curso'")
  })
})

describe('20261104000050 · el portal lee y escribe lo que la RLS abre', () => {
  it('las asambleas del portal son las clásicas, de las que cuelgan puntos_asamblea', () => {
    expect(portal).toContain('fetchAsambleasProyecto')
    expect(portal).not.toMatch(/asambleas_digital|AsambleaDigital|fetchAsambleasDigital/)
    expect(consulta('fetchAsambleasProyecto')).toContain(".from('asambleas')")
    expect(consulta('fetchPuntosByAsambleaIds')).toContain(".in('asamblea_id', ids)")
  })

  it('el voto del portal va firmado (registrado_por), sin asamblea_id, como exige votos_asamblea_insert', () => {
    expect(sql).toContain('registrado_por = (SELECT auth.uid())')
    const insert = portal.slice(portal.indexOf("createCondominioRow('votos_asamblea'"))
    const payload = insert.slice(0, insert.indexOf('})'))
    expect(payload).toContain('registrado_por: userId')
    expect(payload).not.toContain('asamblea_id')
  })

  it('los totales salen del RPC de la migración, con el mismo nombre de parámetro', () => {
    expect(sql).toContain('FUNCTION public.portal_conteo_votos_asambleas(p_asamblea_ids uuid[])')
    expect(consulta('fetchConteoVotosAsambleas')).toContain("rpc('portal_conteo_votos_asambleas'")
    expect(consulta('fetchConteoVotosAsambleas')).toContain('p_asamblea_ids: asambleaIds')
  })

  it('vota el propietario en la base y en la pantalla', () => {
    expect(sql).toContain('mis_unidades_propietario_ids()')
    expect(portal).toMatch(/esPropietario \? \(/)
  })
})

describe('20261104000050 · el arnés corre en CI', () => {
  it('coverage.yml ejecuta supabase/tests/voto_residente_asambleas/run.sh', () => {
    expect(coverage).toContain('run: supabase/tests/voto_residente_asambleas/run.sh')
  })
})

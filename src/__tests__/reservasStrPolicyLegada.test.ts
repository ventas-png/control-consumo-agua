import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// reservas_str sin la policy legada `str_cliente_portal` (20261104000150)
//
// `20260514000006` recreó la FOR ALL `str_cliente_portal` después de que
// `20260514000004` la reemplazara por policies por comando, y `20260519000003`
// no la barrió. Su WITH CHECK comparaba columnas sin calificar dentro del
// subquery (`s.unidad_id = unidad_id` es `s.unidad_id = s.unidad_id`): un
// residente con alguna renta corta aprobada daba de alta reservas en cualquier
// unidad de cualquier empresa. Producción nunca la tuvo.
//
// QUÉ VERIFICA ESTO, Y QUÉ NO. Que el agujero exista y quede cerrado sin
// quitarle al residente lo suyo se prueba EJECUTÁNDOLO en
// supabase/tests/reservas_str_portal/run.mjs, contra la cadena completa. Que
// la reconstrucción coincida con producción lo dice el auditor de drift. Aquí
// queda lo que ninguno de los dos afirma sobre sí mismo: que la prueba esté
// cableada en CI, que la migración sólo retire esa policy, que nadie la
// vuelva a crear y que la poda de la baseline viaje con el arreglo.
// ════════════════════════════════════════════════════════════════════════════

const DIR = resolve('supabase/migrations')
const MIG = '20261104000150_reservas_str_retirar_policy_legada_portal.sql'
const codigo = readFileSync(join(DIR, MIG), 'utf8').replace(/^[ \t]*--.*$/gm, '')
const posteriores = readdirSync(DIR).filter(f => f.endsWith('.sql') && f > MIG)

describe('20261104000150 retira la policy legada y nada más', () => {
  it('nombra exactamente esa policy, en su tabla', () => {
    expect(codigo).toMatch(/DROP POLICY IF EXISTS "str_cliente_portal" ON public\.reservas_str;/)
    expect(codigo.match(/DROP POLICY/g)).toHaveLength(1)
  })

  it('no recrea ninguna policy', () => {
    expect(codigo).not.toMatch(/CREATE POLICY/)
  })

  it('comprueba el RESULTADO: ni una policy de más ni una de menos', () => {
    expect(codigo).toMatch(/conserva policies fuera de las cuatro por comando/)
    expect(codigo).toMatch(/faltan policies por comando/)
  })

  it('ninguna migración posterior la vuelve a crear', () => {
    const reviven = posteriores.filter(f => /CREATE POLICY\s+"?str_cliente_portal"?\s+ON/.test(readFileSync(join(DIR, f), 'utf8')))
    expect(reviven).toEqual([])
  })
})

describe('la prueba y la baseline', () => {
  it('la prueba ejecutable está cableada en CI', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('node supabase/tests/reservas_str_portal/run.mjs')
  })

  it('la prueba exige ver el agujero antes de dar por bueno el arreglo', () => {
    const run = readFileSync(resolve('supabase/tests/reservas_str_portal/run.mjs'), 'utf8')
    expect(run).toMatch(/el agujero no se reprodujo/)
    expect(run).toMatch(/throw new Error\('control previo'\)/)
  })

  it('la entrada de drift se poda en el mismo cambio, y queda dicho por qué', () => {
    const baseline = JSON.parse(readFileSync(resolve('scripts/schema-drift/drift-conocido.json'), 'utf8')) as {
      grupos: Record<string, unknown>
      _HISTORIA: string
    }
    expect(Object.keys(baseline.grupos)).not.toContain('tabla:reservas_str/policies')
    expect(baseline._HISTORIA).toContain('20261104000150')
  })
})

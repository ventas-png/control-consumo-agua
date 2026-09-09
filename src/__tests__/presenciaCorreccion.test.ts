import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de la corrección y la anulación de marcajes (20260908000200).
//
// ALCANCE. La conducta —que el motivo se exija, que anular saque las horas de la
// planilla, que lo anulado se pueda volver a marcar— la prueba
// supabase/tests/presencia_correccion contra un Postgres real, y es más fuerte
// que cualquier regex. Aquí vive lo que una prueba de conducta no expresa bien:
// que el código NO GANE ciertas cosas. Un `foto_entrada = ...` colado en el
// UPDATE de la corrección, o un DELETE en el de la anulación, pasarían todas las
// invariantes de conducta que hoy existen y romperían la garantía igual.
const SQL = readFileSync(
  resolve('supabase/migrations/20260908000200_presencia_correccion_y_anulacion.sql'), 'utf8')

/** SQL sin comentarios: lo que la BD ejecuta, no lo que explicamos. */
const codigo = SQL.replace(/--[^\n]*/g, '')

/** Cuerpo de una función por nombre. */
function cuerpo(nombre: string): string {
  const i = codigo.indexOf(`FUNCTION public.${nombre}(`)
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1)
  return codigo.slice(i, codigo.indexOf('$$;', i))
}

describe('corregir no reescribe lo que la cámara vio', () => {
  it('el UPDATE de la corrección no toca la evidencia ni el expediente', () => {
    const c = cuerpo('presencia_corregir')
    // Estas columnas NUNCA deben aparecer como destino de asignación aquí.
    for (const col of ['foto_entrada', 'foto_salida', 'gps_entrada', 'gps_salida',
                       'origen', 'personal_id', 'fecha', 'company_id', 'project_id']) {
      expect(c, `presencia_corregir asigna ${col}`).not.toMatch(new RegExp(`\\b${col}\\s*=`))
    }
  })

  it('la hora la escribe quien corrige, pero el sello lo pone la base', () => {
    const c = cuerpo('presencia_corregir')
    expect(c).toMatch(/corregido_por\s*=\s*\(SELECT auth\.uid\(\)\)/)
    expect(c).toMatch(/corregido_en\s*=\s*now\(\)/)
    // Ningún parámetro para falsificar el autor o el instante.
    expect(codigo).not.toMatch(/p_corregido_(por|en)/)
  })
})

describe('anular no borra', () => {
  it('ninguna de las dos RPC ejecuta un DELETE', () => {
    for (const fn of ['presencia_anular', 'presencia_corregir']) {
      expect(cuerpo(fn), `${fn} borra filas`).not.toMatch(/\bDELETE\s+FROM\b/i)
    }
  })

  it('anular solo marca la fila y conserva sus horas y su evidencia', () => {
    const c = cuerpo('presencia_anular')
    expect(c).toMatch(/anulado_en\s*=\s*v_ahora/)
    for (const col of ['hora_entrada', 'hora_salida', 'foto_entrada', 'gps_entrada']) {
      expect(c, `presencia_anular toca ${col}`).not.toMatch(new RegExp(`\\b${col}\\s*=`))
    }
  })
})

describe('los dos actos son permisos distintos', () => {
  it('corregir exige .edit y anular exige .delete', () => {
    expect(cuerpo('presencia_corregir')).toContain("'condominios.tab.presencia.edit'")
    expect(cuerpo('presencia_anular')).toContain("'condominios.tab.presencia.delete'")
  })

  it('la vista respeta esa separación', () => {
    const tab = readFileSync(
      resolve('src/components/condominios/tabs/PresenciaPersonalTab.tsx'), 'utf8')
    expect(tab).toMatch(/canEdit && \(\s*<button onClick=\{\(\) => void corregir\(r\)\}/)
    expect(tab).toMatch(/canDelete && \(\s*<button onClick=\{\(\) => void anular\(r\)\}/)
  })
})

describe('anular significa algo', () => {
  it('el cómputo de horas excluye lo anulado', () => {
    // Sin esta línea la anulación sería un adorno: la fila seguiría sumando
    // horas a la planilla.
    expect(cuerpo('calcular_horas_personal')).toMatch(/pp\.anulado_en IS NULL/)
  })

  it('y lo anulado deja libre el día para volver a marcar', () => {
    expect(codigo).toMatch(
      /CREATE UNIQUE INDEX[\s\S]{0,200}presencia_autoservicio_una_por_dia[\s\S]{0,200}anulado_en IS NULL/)
    // Y la RPC de marcaje tiene que ignorarlas, o el índice abierto no serviría.
    expect(cuerpo('presencia_marcar')).toMatch(/pp\.anulado_en IS NULL/)
  })
})

describe('la ACL', () => {
  it('las guardas internas no se le conceden a authenticated', () => {
    for (const fn of ['public.presencia_fila_editable(uuid, text)',
                      'public.presencia_nombre_de_usuario(uuid)']) {
      const esc = fn.replace(/[().*+?^${}|[\]\\]/g, '\\$&')
      expect(codigo).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM PUBLIC, anon, authenticated`))
      expect(codigo).not.toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${esc} TO authenticated`))
    }
  })

  it('las dos RPC de entrada sí, y sin anon', () => {
    for (const fn of ['public.presencia_corregir(uuid, time, time, text, text)',
                      'public.presencia_anular(uuid, text)']) {
      const esc = fn.replace(/[().*+?^${}|[\]\\]/g, '\\$&')
      expect(codigo).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM PUBLIC, anon`))
      expect(codigo).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${esc} TO authenticated`))
    }
  })
})

describe('mi_ficha con dos filas el mismo día', () => {
  it('elige una sola, y prefiere la vigente', () => {
    // Desde que lo anulado no ocupa el día, puede haber dos filas por fecha. Un
    // LEFT JOIN llano devolvería las dos y la pantalla tomaría una al azar.
    const c = cuerpo('presencia_mi_ficha')
    expect(c).toMatch(/LEFT JOIN LATERAL/)
    expect(c).toMatch(/ORDER BY \(p2\.anulado_en IS NULL\) DESC/)
    expect(c).toMatch(/LIMIT 1/)
  })

  it('se redeclara con DROP, porque cambia sus columnas de salida', () => {
    expect(codigo).toMatch(/DROP FUNCTION IF EXISTS public\.presencia_mi_ficha\(uuid\);/)
  })
})

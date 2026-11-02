import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards de FORMA de 20261119000000 (objetos perdidos: área del catálogo,
// quién lo encontró, fotos, custodia y entrega con firma). La conducta —los
// snapshots desde la ficha, el personal o el área de otro condominio, la
// entrega sin receptor, sin firma, con firma ajena o no subida, el sello de
// servidor, la entrega inmutable, las bajas de empleados y usuarios— se
// verificó ejecutando la migración contra el esquema reconstruido (ver el PR).
// Aquí quedan los filos que un test de conducta no ve.

const MIG = resolve('supabase/migrations/20261119000000_objetos_perdidos_custodia_entrega.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

describe('20261119000000 — forma de la migración', () => {
  it('ningún LIKE ejecutable usa un guion bajo sin escapar', () => {
    const infractores: string[] = []
    for (const m of sql.matchAll(/LIKE\s+'([^']*)'/g)) {
      const patron = m[1]
      if (/(^|[^\\])_/.test(patron)) infractores.push(patron)
    }
    expect(infractores, `patrones con comodín accidental: ${infractores.join(', ')}`).toEqual([])
  })

  it('la única SECURITY DEFINER es la del trigger, con search_path vacío y cerrada a todos los roles del cliente', () => {
    const definer = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?SECURITY DEFINER/g)].map(m => m[1])
    expect(definer).toEqual(['objetos_perdidos_coherente'])
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = ''/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.objetos_perdidos_coherente\(\) FROM PUBLIC, anon, authenticated;/)
  })

  it('las FK son por tenant: áreas con RESTRICT y personal con SET NULL de su propia columna', () => {
    for (const [col, fk] of [['area_encontrado_id', 'objetos_area_encontrado_tenant_fk'], ['area_almacenamiento_id', 'objetos_area_almacenamiento_tenant_fk']]) {
      expect(sql, fk).toMatch(new RegExp(`${fk}\\s+FOREIGN KEY \\(${col}, company_id, project_id\\)\\s+REFERENCES public\\.areas_condominio \\(id, company_id, project_id\\)\\s+ON DELETE RESTRICT;`))
    }
    for (const [col, fk] of [['encontrado_por_personal_id', 'objetos_encontrado_por_personal_fk'], ['custodio_personal_id', 'objetos_custodio_personal_fk']]) {
      expect(sql, fk).toMatch(new RegExp(`${fk}\\s+FOREIGN KEY \\(${col}, company_id, project_id\\)\\s+REFERENCES public\\.personal_condominio \\(id, company_id, project_id\\)\\s+ON DELETE SET NULL \\(${col}\\);`))
    }
  })

  it('la entrega exige receptor y firma subida en la carpeta del condominio, y el sello lo pone el servidor', () => {
    expect(sql).toMatch(/starts_with\(v_firma, NEW\.project_id::text \|\| '\/objetos-perdidos\/firmas\/'\)/)
    expect(sql).toMatch(/FROM storage\.objects o\s+WHERE o\.bucket_id = 'condominios-media' AND o\.name = v_firma/)
    expect(sql).toMatch(/NEW\.entregado_en\s+:= now\(\);/)
    expect(sql).toMatch(/NEW\.entregado_por\s+:= auth\.uid\(\);/)
    expect(sql).toMatch(/objetos_entrega_completa CHECK/)
  })

  it('no toca policies, grants ni el bucket', () => {
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/)
    expect(sql).not.toMatch(/\bGRANT\b/)
    expect(sql).not.toMatch(/storage\.buckets/)
  })
})

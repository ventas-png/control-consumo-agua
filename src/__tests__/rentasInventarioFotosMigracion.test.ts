import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUCKET_RENTAS_INVENTARIO } from '../domain/shared/buckets'
import { MAX_FOTOS_ARTICULO } from '../domain/rentas/logica'

// Guards de FORMA de 20261202000000 (fotos del inventario de Rentas). La
// conducta —quién ve, sube y borra, la carpeta de la propiedad, el tope de 6—
// la ejerce supabase/tests/rentas_inventario_fotos/run.sh como cada persona,
// con mutantes. Aquí quedan los filos que esa prueba no ve: que el cliente y la
// base hablen del mismo bucket y del mismo tope.

const MIG = resolve('supabase/migrations/20261202000000_rentas_inventario_fotos.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

describe('20261202000000 — forma de la migración', () => {
  it('el bucket del cliente es el que crea la migración, privado y sólo JPEG', () => {
    expect(sql).toContain(`VALUES ('${BUCKET_RENTAS_INVENTARIO}', '${BUCKET_RENTAS_INVENTARIO}', false, 5242880, ARRAY['image/jpeg']::text[])`)
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE\s+SET public = false,/)
  })

  it('el tope de fotos del formulario es el del CHECK', () => {
    expect(sql).toMatch(new RegExp(`CHECK \\(cardinality\\(fotos\\) <= ${MAX_FOTOS_ARTICULO}\\b`))
  })

  it('sin policy de UPDATE en el bucket: una foto no se sustituye', () => {
    const creadas = [...sql.matchAll(/CREATE POLICY (\w+)\s+ON storage\.objects FOR (\w+)/g)].map(m => `${m[1]}:${m[2]}`)
    expect(creadas.sort()).toEqual([
      'rentas_inventario_fotos_delete:DELETE', 'rentas_inventario_fotos_insert:INSERT', 'rentas_inventario_fotos_select:SELECT',
    ])
  })

  it('la función DEFINER de la policy queda cerrada a PUBLIC y anon, abierta a authenticated', () => {
    expect(sql).toMatch(/FUNCTION public\.rentas_inventario_foto_permitida\(p_ruta text, p_accion text\)[\s\S]*?SECURITY DEFINER\s+SET search_path = ''/)
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.rentas_inventario_foto_permitida(text, text) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT  EXECUTE ON FUNCTION public.rentas_inventario_foto_permitida(text, text) TO authenticated;')
  })

  it('las carpetas se comparan como texto: ningún cast a uuid de una ruta que manda el cliente', () => {
    expect(sql).not.toMatch(/split_part\([^)]*\)::uuid/)
    expect(sql).not.toMatch(/foldername\([^)]*\)\)\[\d\]::uuid/)
  })
})

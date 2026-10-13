// El lector de migraciones SQL de las pruebas (src/test/sqlMigraciones.ts): las formas que entiende y las que NO debe dar por buenas.
import { describe, expect, it } from 'vitest'
import { permisosSembrados, rechazosCompras, sentencias, sinComentarios } from '../sqlMigraciones'

const FILA = (k: string) => `('${k}', 'platform_contabilidad', 'Compras y pagos — ${k}', 'Descripción de ${k}.')`

describe('sinComentarios / sentencias', () => {
  it('quita comentarios de línea y de bloque pero no toca lo que parece comentario dentro de un literal', () => {
    const sql = "-- INSERT INTO permissions VALUES ('x','y','z','w');\nSELECT 'a -- b', 'c /* d */' /* quitar; esto */; -- cola"
    expect(sinComentarios(sql)).toBe("\nSELECT 'a -- b', 'c /* d */'  ; ")
  })

  it('parte por «;» solo fuera de literales (un «;» dentro de una descripción no corta la sentencia)', () => {
    expect(sentencias("SELECT 'a;b'; SELECT 2;").map((x) => x.trim())).toEqual(["SELECT 'a;b'", 'SELECT 2'])
  })

  it('respeta la comilla escapada («\'\'») dentro de un literal', () => {
    expect(sentencias("SELECT 'it''s; ok'; SELECT 2").map((x) => x.trim())).toEqual(["SELECT 'it''s; ok'", 'SELECT 2'])
  })
})

describe('permisosSembrados · las formas de INSERT que entiende', () => {
  it('INSERT INTO public.permissions (…) VALUES (…), (…) con lista de columnas', () => {
    const sql = `INSERT INTO public.permissions (key, category, label, description) VALUES\n  ${FILA('a.b.c')},\n  ${FILA('a.b.d')}\nON CONFLICT (key) DO NOTHING;`
    expect(permisosSembrados(sql).map((p) => [p.key, p.category, p.label])).toEqual([
      ['a.b.c', 'platform_contabilidad', 'Compras y pagos — a.b.c'],
      ['a.b.d', 'platform_contabilidad', 'Compras y pagos — a.b.d'],
    ])
  })

  it('sin «public.» y sin lista de columnas (orden por omisión: key, category, label, description)', () => {
    const [p] = permisosSembrados(`INSERT INTO permissions VALUES ${FILA('x.y.z')};`)
    expect(p).toEqual({ key: 'x.y.z', category: 'platform_contabilidad', label: 'Compras y pagos — x.y.z', description: 'Descripción de x.y.z.' })
  })

  it('INSERT … SELECT con literales (y UNION ALL) y con SELECT … FROM (VALUES …)', () => {
    const sel = `INSERT INTO public.permissions (key, category, label, description)
      SELECT 'p.q.r', 'cat', 'Etiqueta R', 'Desc R'
      UNION ALL SELECT 'p.q.s', 'cat', 'Etiqueta S', NULL
      ON CONFLICT (key) DO NOTHING;`
    expect(permisosSembrados(sel).map((p) => [p.key, p.description])).toEqual([['p.q.r', 'Desc R'], ['p.q.s', null]])
    const val = `INSERT INTO public.permissions (key, category, label, description)
      SELECT v.k, v.c, v.l, v.d FROM (VALUES ('m.n.o', 'cat', 'Etiqueta O', 'Desc O')) AS v(k, c, l, d);`
    expect(permisosSembrados(val).map((p) => p.key)).toEqual(['m.n.o'])
  })

  it('respeta el orden de las columnas declarado y las comillas escapadas', () => {
    const sql = `INSERT INTO public.permissions (category, key, description, label) VALUES ('c', 'k.l.m', 'Desc ''con'' comillas', 'Etiqueta; con punto y coma');`
    expect(permisosSembrados(sql)[0]).toEqual({ key: 'k.l.m', category: 'c', label: 'Etiqueta; con punto y coma', description: "Desc 'con' comillas" })
  })

  it('dentro de un DO $$ … $$ (INSERT ejecutado por un bloque) también', () => {
    const sql = `DO $$ BEGIN\n  INSERT INTO public.permissions (key, category, label, description) VALUES ${FILA('d.o.k')} ON CONFLICT DO NOTHING;\nEND $$;`
    expect(permisosSembrados(sql).map((p) => p.key)).toEqual(['d.o.k'])
  })

  it('NO toma lo que está comentado ni las filas de OTRAS tablas (role_permissions)', () => {
    const sql = `-- INSERT INTO public.permissions VALUES ${FILA('comentada.x.y')};\n/* INSERT INTO permissions VALUES ${FILA('bloque.x.y')}; */
      INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ('r', 'k.l.m', 'allow');`
    expect(permisosSembrados(sql)).toEqual([])
  })

  it('una fila construida con funciones no se da por sembrada (la prueba que la necesite fallará en voz alta)', () => {
    const sql = `INSERT INTO public.permissions (key, category, label, description) SELECT k, 'cat', format('Etiqueta %s', k), NULL FROM unnest(ARRAY['a.b.c']) k;`
    expect(permisosSembrados(sql)).toEqual([])
  })
})

describe('rechazosCompras · RAISE EXCEPTION con código COMPRAS_*', () => {
  it('lee el mensaje y el SQLSTATE por nombre de condición, con o sin comillas, y por código de cinco caracteres', () => {
    const sql = `
      RAISE EXCEPTION 'COMPRAS_A_UNO: uno %.', x USING ERRCODE = insufficient_privilege;
      RAISE EXCEPTION 'COMPRAS_A_DOS: dos' USING ERRCODE = 'check_violation';
      RAISE EXCEPTION 'COMPRAS_A_TRES: tres' USING ERRCODE = '22023', HINT = 'ayuda';
      RAISE EXCEPTION 'COMPRAS_A_CUATRO: cuatro «con ñ» y ''comillas''';`
    expect(rechazosCompras(sql).map((r) => [r.codigo, r.sqlstate])).toEqual([
      ['COMPRAS_A_UNO', '42501'], ['COMPRAS_A_DOS', '23514'], ['COMPRAS_A_TRES', '22023'], ['COMPRAS_A_CUATRO', 'P0001'],
    ])
    expect(rechazosCompras(sql)[3].texto).toBe("COMPRAS_A_CUATRO: cuatro «con ñ» y 'comillas'")
  })

  it('lee un RAISE partido en varias líneas, con argumentos antes del USING', () => {
    const sql = `RAISE EXCEPTION 'COMPRAS_X_Y: para % tu perfil necesita «%».',\n    p_paso,\n    CASE p WHEN 'a' THEN 'A' ELSE p END\n    USING ERRCODE = 'insufficient_privilege';`
    expect(rechazosCompras(sql)).toEqual([{ codigo: 'COMPRAS_X_Y', texto: 'COMPRAS_X_Y: para % tu perfil necesita «%».', sqlstate: '42501' }])
  })

  it('ignora los que no son COMPRAS_*, los comentados, y no confunde el ERRCODE de un RAISE con el del siguiente', () => {
    const sql = `-- RAISE EXCEPTION 'COMPRAS_COMENTADO: no' USING ERRCODE = 'check_violation';
      RAISE EXCEPTION 'otro error' USING ERRCODE = 'check_violation';
      RAISE EXCEPTION 'COMPRAS_P: p';
      RAISE EXCEPTION 'COMPRAS_Q: q' USING ERRCODE = 'unique_violation';`
    expect(rechazosCompras(sql).map((r) => [r.codigo, r.sqlstate])).toEqual([['COMPRAS_P', 'P0001'], ['COMPRAS_Q', '23505']])
  })

  it('una condición que no conoce hace FALLAR la lectura (no se adivina el SQLSTATE)', () => {
    expect(() => rechazosCompras(`RAISE EXCEPTION 'COMPRAS_Z: z' USING ERRCODE = condicion_inventada;`)).toThrow(/ERRCODE desconocido/)
  })
})

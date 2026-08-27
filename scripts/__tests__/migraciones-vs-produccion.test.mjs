// ════════════════════════════════════════════════════════════════════════════
// Pruebas de migraciones-vs-produccion: producción tiene que tener todo lo que
// declara una migración YA APLICADA.
//
// Se prueban las funciones puras con esquemas sintéticos —sin red y sin tocar
// ningún proyecto— porque lo que hay que fijar es el CRITERIO, no la consulta:
// qué se exige, qué no, y sobre todo qué NO se reporta para que la guarda sea
// usable en un PR con migraciones nuevas. vitest recoge este archivo por su
// patrón por defecto.
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'

import { comparar, versionDe } from '../migraciones-vs-produccion.mjs'

/** Construye el argumento `columnasProd` desde un objeto plano. */
function prod(tablas) {
  return {
    tablasProd: new Set(Object.keys(tablas)),
    columnasProd: new Map(Object.entries(tablas).map(([t, cs]) => [t, new Set(cs)])),
  }
}

const AREAS = {
  nombre: '20260424000059_rutas_ronda.sql',
  sql: `CREATE TABLE areas_condominio (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  nombre text NOT NULL,
  activo boolean NOT NULL DEFAULT true
);`,
}

describe('versionDe', () => {
  it('toma el prefijo de la versión, no el resto del nombre', () => {
    expect(versionDe('20260424000059_rutas_ronda.sql')).toBe('20260424000059')
    expect(versionDe('20260904000500_reparar_prerrequisitos_limpieza.sql')).toBe('20260904000500')
  })
})

describe('comparar · el incidente del 2026-08-27', () => {
  it('reporta la columna que la migración aplicada declara y producción no tiene', () => {
    // Esto es literalmente el run 33095288091: `20260424000059` está registrada
    // y `areas_condominio.activo` no existe. Con esta guarda el fallo llega como
    // un rojo con nombre, no como un 42703 a mitad de un apply a producción.
    const r = comparar({
      registradas: new Set(['20260424000059']),
      migraciones: [AREAS],
      ...prod({ areas_condominio: ['id', 'company_id', 'nombre'] }),
    })

    expect(r.columnasFaltantes).toEqual([
      'areas_condominio.activo — declarada en 20260424000059_rutas_ronda.sql',
    ])
  })

  it('no reporta nada cuando producción sí tiene la columna', () => {
    const r = comparar({
      registradas: new Set(['20260424000059']),
      migraciones: [AREAS],
      ...prod({ areas_condominio: ['id', 'company_id', 'nombre', 'activo'] }),
    })

    expect(r.columnasFaltantes).toEqual([])
    expect(r.comprobadas).toBe(4)
  })
})

describe('comparar · sólo juzga lo que YA se aplicó', () => {
  it('ignora una migración que NO está registrada', () => {
    // Es el caso que hace la guarda usable: un PR que agrega una migración
    // declara columnas que producción legítimamente todavía no tiene. Sin este
    // filtro la guarda fallaría en cada PR con migración y se aprendería a
    // ignorarla — el destino de types-drift.yml.
    const r = comparar({
      registradas: new Set(),
      migraciones: [AREAS],
      ...prod({ areas_condominio: ['id', 'company_id', 'nombre'] }),
    })

    expect(r.columnasFaltantes).toEqual([])
    expect(r.aplicadas).toBe(0)
    expect(r.comprobadas).toBe(0)
  })

  it('no deja de exigir una columna que sólo una migración PENDIENTE dropea', () => {
    // La pendiente no ha corrido: en producción la columna debería seguir ahí.
    // Calcular el esquema esperado con TODAS las migraciones ocultaría el hueco.
    const r = comparar({
      registradas: new Set(['20260424000059']),
      migraciones: [
        AREAS,
        {
          nombre: '20260910000000_quitar_activo.sql',
          sql: `ALTER TABLE public.areas_condominio DROP COLUMN activo;`,
        },
      ],
      ...prod({ areas_condominio: ['id', 'company_id', 'nombre'] }),
    })

    expect(r.columnasFaltantes).toHaveLength(1)
    expect(r.columnasFaltantes[0]).toContain('areas_condominio.activo')
  })
})

describe('comparar · el esquema esperado se calcula sumando y restando', () => {
  it('no exige una columna que una migración aplicada posterior eliminó', () => {
    const r = comparar({
      registradas: new Set(['20260424000059', '20260501000000']),
      migraciones: [
        AREAS,
        {
          nombre: '20260501000000_quitar_activo.sql',
          sql: `ALTER TABLE public.areas_condominio DROP COLUMN IF EXISTS activo;`,
        },
      ],
      ...prod({ areas_condominio: ['id', 'company_id', 'nombre'] }),
    })

    expect(r.columnasFaltantes).toEqual([])
  })

  it('no exige el nombre viejo de una columna renombrada', () => {
    const r = comparar({
      registradas: new Set(['20260424000059', '20260501000000']),
      migraciones: [
        AREAS,
        {
          nombre: '20260501000000_renombrar.sql',
          sql: `ALTER TABLE public.areas_condominio RENAME COLUMN activo TO vigente;`,
        },
      ],
      ...prod({ areas_condominio: ['id', 'company_id', 'nombre', 'vigente'] }),
    })

    expect(r.columnasFaltantes).toEqual([])
  })

  it('no exige una tabla que una migración aplicada posterior eliminó', () => {
    // Caso real del repositorio: `mudanzas`, `user_module_permissions` y
    // `password_reset_tokens` se crean y se dropean en migraciones distintas.
    const r = comparar({
      registradas: new Set(['20260424000059', '20260501000000']),
      migraciones: [
        AREAS,
        {
          nombre: '20260501000000_borrar_tabla.sql',
          sql: `DROP TABLE IF EXISTS public.areas_condominio CASCADE;`,
        },
      ],
      ...prod({}),
    })

    expect(r.tablasFaltantes).toEqual([])
    expect(r.columnasFaltantes).toEqual([])
  })
})

describe('comparar · legibilidad del informe', () => {
  it('reporta la tabla ausente UNA vez, no cada una de sus columnas', () => {
    const r = comparar({
      registradas: new Set(['20260424000059']),
      migraciones: [AREAS],
      ...prod({ otra_tabla: ['id'] }),
    })

    expect(r.tablasFaltantes).toEqual([
      'areas_condominio — creada en 20260424000059_rutas_ronda.sql',
    ])
    expect(r.columnasFaltantes).toEqual([])
  })
})

describe('comparar · allowlist', () => {
  const faltante = {
    registradas: new Set(['20260424000059']),
    migraciones: [AREAS],
    ...prod({ areas_condominio: ['id', 'company_id', 'nombre'] }),
  }

  it('resta la deuda declarada', () => {
    const r = comparar({
      ...faltante,
      allowlist: { columnas: [{ tabla: 'areas_condominio', columna: 'activo', reason: 'deuda' }] },
    })

    expect(r.columnasFaltantes).toEqual([])
    expect(r.allowlistObsoleto).toEqual([])
  })

  it('delata la entrada que ya no aplica', () => {
    // Sin esto la lista sólo crece: cada entrada muerta tapa un hallazgo futuro
    // sobre la misma columna y acaba siendo un "permitir todo" de facto.
    const r = comparar({
      registradas: new Set(['20260424000059']),
      migraciones: [AREAS],
      ...prod({ areas_condominio: ['id', 'company_id', 'nombre', 'activo'] }),
      allowlist: { columnas: [{ tabla: 'areas_condominio', columna: 'activo', reason: 'ya repuesta' }] },
    })

    expect(r.allowlistObsoleto).toEqual(['columna areas_condominio.activo'])
  })

  it('acepta la forma corta `tabla.columna` además del objeto', () => {
    const r = comparar({ ...faltante, allowlist: { columnas: ['areas_condominio.activo'] } })
    expect(r.columnasFaltantes).toEqual([])
  })
})

describe('comparar · precisión del aviso de allowlist obsoleto', () => {
  it('no marca como obsoleta la columna allowlistada de una tabla que falta entera', () => {
    // Falta porque falta la tabla, no porque se haya repuesto. Mandar a retirar
    // esa excepción haría que reapareciera en cuanto la tabla volviera.
    const r = comparar({
      registradas: new Set(['20260424000059']),
      migraciones: [AREAS],
      ...prod({ otra: ['id'] }),
      allowlist: {
        tablas: [{ tabla: 'areas_condominio', reason: 'nunca se creó en prod' }],
        columnas: [{ tabla: 'areas_condominio', columna: 'activo', reason: 'idem' }],
      },
    })

    expect(r.tablasFaltantes).toEqual([])
    expect(r.allowlistObsoleto).toEqual([])
  })
})

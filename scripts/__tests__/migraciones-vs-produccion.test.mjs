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

import {
  CONSTRAINTS_CRITICOS,
  comparar,
  compararConstraints,
  normalizarDef,
  versionDe,
} from '../migraciones-vs-produccion.mjs'

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

// ── Constraints críticos: la definición se exige, no el nombre ───────────────
//
// El caso que fija estas pruebas es tareas_bloque_estado_check: producción
// tenía un CHECK con ESE nombre y el vocabulario legacy, el guard por conname
// de 20260907000100 lo dio por bueno, y este script estaba verde porque solo
// miraba tablas y columnas. El criterio nuevo: nombre correcto + definición
// distinta = hallazgo.

const CANONICA =
  "CHECK ((estado = ANY (ARRAY['pendiente'::text, 'completada'::text, 'con_observacion'::text, 'omitida'::text])))"
const LEGACY =
  "CHECK ((estado = ANY (ARRAY['pendiente'::text, 'en_curso'::text, 'completado'::text, 'omitido'::text])))"

/** Un CHECK real del catálogo, con la forma de la query `constraints`. */
function check(definition, { convalidated = true } = {}) {
  return {
    table_name: 'tareas_bloque',
    constraint_name: 'tareas_bloque_estado_check',
    definition,
    convalidated,
  }
}

const REGISTRADA_LA_REPARACION = new Set(['20260907000700'])

describe('compararConstraints · el homónimo incompatible', () => {
  it('declara tareas_bloque_estado_check como crítico desde 20260907000700', () => {
    // Si alguien retira la entrada, todo lo demás de esta sección prueba una
    // lista vacía y el guard vuelve a no ver el homónimo.
    expect(CONSTRAINTS_CRITICOS).toContainEqual(
      expect.objectContaining({
        tabla: 'tareas_bloque',
        constraint: 'tareas_bloque_estado_check',
        desdeVersion: '20260907000700',
        validado: true,
      }),
    )
  })

  it('FALLA cuando el nombre coincide pero la definición es la legacy', () => {
    // Restaurar el constraint viejo bajo el mismo nombre es exactamente el
    // drift que el guard por conname no vio. Tiene que salir rojo.
    const hallazgos = compararConstraints({
      registradas: REGISTRADA_LA_REPARACION,
      constraintsProd: [check(LEGACY)],
    })
    expect(hallazgos).toHaveLength(1)
    expect(hallazgos[0]).toContain('tareas_bloque.tareas_bloque_estado_check')
    expect(hallazgos[0]).toContain('DEFINICIÓN')
    expect(hallazgos[0]).toContain(LEGACY)
  })

  it('pasa con la definición canónica validada', () => {
    expect(
      compararConstraints({
        registradas: REGISTRADA_LA_REPARACION,
        constraintsProd: [check(CANONICA)],
      }),
    ).toEqual([])
  })

  it('FALLA si la definición es correcta pero quedó NOT VALID', () => {
    // 20260907000700 valida; un convalidated=false significa que el histórico
    // volvió a quedar sin garantía.
    const hallazgos = compararConstraints({
      registradas: REGISTRADA_LA_REPARACION,
      constraintsProd: [check(CANONICA, { convalidated: false })],
    })
    expect(hallazgos).toHaveLength(1)
    expect(hallazgos[0]).toContain('convalidated=false')
  })

  it('FALLA si el constraint desapareció', () => {
    const hallazgos = compararConstraints({
      registradas: REGISTRADA_LA_REPARACION,
      constraintsProd: [],
    })
    expect(hallazgos).toHaveLength(1)
    expect(hallazgos[0]).toContain('AUSENTE')
  })

  it('FALLA si aparece un SEGUNDO CHECK sobre estado bajo otro nombre, aunque el canónico esté intacto', () => {
    // Los CHECKs aplican todos a la vez: el legacy bajo otro nombre vuelve a
    // rechazar los cierres canónicos con 23514 mientras el nombrado sigue
    // perfecto — el mismo incidente por la puerta de al lado.
    const hallazgos = compararConstraints({
      registradas: REGISTRADA_LA_REPARACION,
      constraintsProd: [
        check(CANONICA),
        { ...check(LEGACY, { convalidated: false }), constraint_name: 'tareas_bloque_estado_check_old' },
      ],
    })
    expect(hallazgos).toHaveLength(1)
    expect(hallazgos[0]).toContain('tareas_bloque_estado_check_old')
    expect(hallazgos[0]).toContain('CHECK ADICIONAL')
  })

  it('no confunde los CHECKs de OTRAS columnas de la misma tabla', () => {
    // prioridad y anulación viven en tareas_bloque y no tocan `estado`.
    const hallazgos = compararConstraints({
      registradas: REGISTRADA_LA_REPARACION,
      constraintsProd: [
        check(CANONICA),
        {
          table_name: 'tareas_bloque',
          constraint_name: 'tareas_bloque_prioridad_check',
          definition:
            "CHECK (((prioridad IS NULL) OR (prioridad = ANY (ARRAY['baja'::text, 'media'::text, 'alta'::text]))))",
          convalidated: true,
        },
      ],
    })
    expect(hallazgos).toEqual([])
  })

  it('no exige nada mientras la reparación NO esté registrada', () => {
    // Mismo acotamiento que las columnas: antes del apply, producción tiene
    // legítimamente la forma vieja; exigir la nueva daría rojo en cada deploy.
    expect(
      compararConstraints({
        registradas: new Set(['20260907000600']),
        constraintsProd: [check(LEGACY, { convalidated: false })],
      }),
    ).toEqual([])
  })

  it('normaliza espacios y el sufijo NOT VALID antes de comparar', () => {
    // pg_get_constraintdef imprime `... NOT VALID` mientras no se valida, y
    // los saltos de línea de un dump no deben contar como drift.
    expect(normalizarDef(`${CANONICA} NOT VALID`)).toBe(normalizarDef(CANONICA))
    expect(normalizarDef(CANONICA.replace(/, /g, ',\n  '))).toBe(
      normalizarDef(CANONICA.replace(/, /g, ', ')),
    )
    // …pero la normalización no puede tragarse una diferencia REAL de valores.
    expect(normalizarDef(LEGACY)).not.toBe(normalizarDef(CANONICA))
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

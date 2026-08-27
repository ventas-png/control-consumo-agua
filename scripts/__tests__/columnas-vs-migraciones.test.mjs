// ════════════════════════════════════════════════════════════════════════════
// Contrato: ninguna columna que la app nombre puede faltar en las migraciones.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA. cuotas_condominio.{fecha_pago,metodo_pago,
// referencia_pago} existían SÓLO en producción, añadidas a mano y nunca
// capturadas en una migración. Producción funcionaba; el sandbox de los E2E
// —construido entero desde supabase/migrations— devolvía 400 en la proyección
// de cuotas, runQuery se comía el error, y la pestaña de cobranza se degradaba
// EN SILENCIO a leer el `estado` legacy: «📤 Emitir» seguía saliendo en filas
// ya emitidas y la prueba «emite una cuota pendiente» quedaba en rojo aunque
// la fila SÍ transicionaba en la base.
//
// Ese diagnóstico costó una corrida de CI entera. Aquí cuesta un `npm test`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  analizar,
  columnasDeLasMigraciones,
  constantesDe,
  fuentesDe,
  partirEnComasDePrimerNivel,
  selectsDe,
} from '../columnas-vs-migraciones.mjs'

const RAIZ = resolve(import.meta.dirname, '../..')
const MIGRACIONES = resolve(RAIZ, 'supabase/migrations')

describe('la guarda de verdad: src/ contra supabase/migrations', () => {
  const informe = analizar({ dirMigraciones: MIGRACIONES, archivos: fuentesDe(resolve(RAIZ, 'src')) })

  it('ninguna columna seleccionada falta en las migraciones', () => {
    expect(informe.faltantes).toEqual([])
  })

  it('comprueba una cantidad significativa de columnas (si cae a cero, se rompió el parser)', () => {
    // Un parser roto devuelve 0 faltantes por vacuidad y el verde miente. Este
    // piso hace ruido si los .select() dejan de reconocerse.
    expect(informe.comprobadas).toBeGreaterThan(400)
  })

  it('lo que NO se analiza queda declarado, no oculto', () => {
    // '*' y recursos embebidos no se pueden atribuir a la tabla del .from()
    // sin adivinar. Se descartan a propósito; el número se imprime para que un
    // recorte silencioso no se lea como "está todo cubierto".
    expect(Array.isArray(informe.descartados)).toBe(true)
    console.log(
      `columnas comprobadas: ${informe.comprobadas} · ` +
        `.select() no analizables: ${informe.descartados.length} · ` +
        `tablas sin CREATE TABLE (vistas): ${informe.sinCreateTable.join(', ') || 'ninguna'}`,
    )
  })
})

describe('la migración del drift crea las siete columnas', () => {
  // Sin este archivo el bloque de arriba se pone rojo (comprobado borrándolo:
  // 6 faltantes, las tres columnas de pago por partida doble). Estas
  // aserciones cubren además las tres que la app ESCRIBE y no selecciona, que
  // el analizador no puede ver.
  const sql = readFileSync(
    resolve(MIGRACIONES, '20260904000000_columnas_solo_en_produccion.sql'),
    'utf8',
  )

  it('cuotas_condominio recupera los datos del pago', () => {
    for (const c of ['fecha_pago', 'metodo_pago', 'referencia_pago', 'comprobante_url']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`))
    }
  })

  it('contadores, tarifas y unidades recuperan updated_by_name', () => {
    // Las ESCRIBEN ContadoresSection:127, TarifasSection:175 y
    // UnidadesSection:212 en cada guardado: sin la columna el update da 400.
    for (const t of ['contadores', 'tarifas', 'unidades']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS updated_by_name`))
    }
    const cols = columnasDeLasMigraciones([sql])
    for (const t of ['contadores', 'tarifas', 'unidades']) {
      expect(cols.get(t)).toContain('updated_by_name')
    }
  })

  it('es idempotente: todo va con IF NOT EXISTS (en producción ya existen)', () => {
    // Sin los comentarios: la cabecera del archivo también dice "ADD COLUMN".
    const ddl = sql.replace(/--[^\n]*/g, '')
    const adds = ddl.match(/ADD COLUMN/g) ?? []
    const guardados = ddl.match(/ADD COLUMN IF NOT EXISTS/g) ?? []
    expect(adds).toHaveLength(7)
    expect(guardados).toHaveLength(7)
  })
})

describe('el parser de migraciones', () => {
  it('parte por las comas de PRIMER nivel: numeric(12,2) no es dos columnas', () => {
    expect(partirEnComasDePrimerNivel('a int, b numeric(12,2), c text').map((s) => s.trim()))
      .toEqual(['a int', 'b numeric(12,2)', 'c text'])
  })

  it('lee las columnas de un CREATE TABLE', () => {
    const cols = columnasDeLasMigraciones([
      `CREATE TABLE IF NOT EXISTS public.t (
         id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         monto numeric(12,2) NOT NULL,
         notas text,
         CONSTRAINT t_uk UNIQUE (id, monto)
       );`,
    ])
    expect([...cols.get('t')].sort()).toEqual(['id', 'monto', 'notas'])
  })

  it('no confunde una definición de tabla con una columna', () => {
    const cols = columnasDeLasMigraciones([
      `CREATE TABLE public.t (
         id uuid,
         PRIMARY KEY (id),
         UNIQUE (id),
         CHECK (id IS NOT NULL),
         FOREIGN KEY (id) REFERENCES public.o(id)
       );`,
    ])
    expect([...cols.get('t')]).toEqual(['id'])
  })

  it('suma las columnas de los ALTER TABLE … ADD COLUMN posteriores', () => {
    const cols = columnasDeLasMigraciones([
      'CREATE TABLE public.t (\n  id uuid\n);',
      'ALTER TABLE public.t ADD COLUMN IF NOT EXISTS a text, ADD COLUMN IF NOT EXISTS b date;',
      'ALTER TABLE t ADD COLUMN c int;',
    ])
    expect([...cols.get('t')].sort()).toEqual(['a', 'b', 'c', 'id'])
  })

  it('ignora lo comentado: una columna en un -- no existe', () => {
    const cols = columnasDeLasMigraciones([
      'CREATE TABLE public.t (\n  id uuid\n);\n-- ALTER TABLE public.t ADD COLUMN fantasma text;',
    ])
    expect(cols.get('t').has('fantasma')).toBe(false)
  })
})

describe('el parser de .select()', () => {
  it('resuelve una constante del mismo archivo (así se nombra CUOTA_AGREGADO_COLS)', () => {
    const { usos } = selectsDe("const COLS = `id,\n  monto`\ndb.from('t').select(COLS)")
    expect(usos).toEqual([{ tabla: 't', columnas: ['id', 'monto'] }])
  })

  it('lee un literal directo, con filtros encadenados en medio', () => {
    const { usos } = selectsDe("db.from('t')\n  .select('id, monto')\n  .eq('x', 1)")
    expect(usos).toEqual([{ tabla: 't', columnas: ['id', 'monto'] }])
  })

  it('descarta —sin inventar— los que traen * o recursos embebidos', () => {
    for (const arg of ["'*'", "'*, unidades(nombre)'", "'id, unidades(nombre)'"]) {
      const { usos, descartados } = selectsDe(`db.from('t').select(${arg})`)
      expect(usos).toEqual([])
      expect(descartados).toHaveLength(1)
    }
  })

  it('descarta lo que no puede resolver, en vez de darlo por bueno', () => {
    const { usos, descartados } = selectsDe("db.from('t').select(colsDeOtroArchivo)")
    expect(usos).toEqual([])
    expect(descartados[0]).toMatch(/no es literal ni constante local/)
  })

  it('no atribuye a una tabla el .select() de otra', () => {
    const { usos } = selectsDe("db.from('a').eq('x',1)\ndb.from('b').select('id')")
    expect(usos).toEqual([{ tabla: 'b', columnas: ['id'] }])
  })

  it('quita el alias de PostgREST: `alias:columna` es la columna', () => {
    expect(selectsDe("db.from('t').select('alias:monto')").usos[0].columnas).toEqual(['monto'])
  })

  it('constantesDe lee tanto backticks como comillas simples', () => {
    const c = constantesDe("const A = `x`\nconst B = 'y'")
    expect([c.get('A'), c.get('B')]).toEqual(['x', 'y'])
  })
})

describe('columnasDeLasMigraciones · DDL dinámico', () => {
  it('ignora `ALTER TABLE public.%I` en vez de inventarse una tabla llamada `public`', () => {
    // Varias migraciones hacen EXECUTE format('ALTER TABLE public.%I ADD COLUMN
    // …', tabla) sobre una lista calculada en ejecución. Sin el lookahead el
    // motor retrocedía, capturaba `public` como nombre de tabla y le colgaba las
    // columnas de todas esas sentencias. La primera corrida de
    // migraciones-vs-produccion contra producción reportó justo eso: una tabla
    // fantasma `public` ausente. No poder resolverlo es correcto; adivinarlo no.
    const porTabla = columnasDeLasMigraciones([
      `DO $$ BEGIN
         EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS project_id uuid', t);
       END $$;`,
    ])

    expect(porTabla.has('public')).toBe(false)
    expect([...porTabla.keys()]).toEqual([])
  })

  it('sigue leyendo el ALTER TABLE normal con esquema explícito', () => {
    const porTabla = columnasDeLasMigraciones([
      `ALTER TABLE public.areas_condominio ADD COLUMN IF NOT EXISTS activo boolean;`,
    ])

    expect([...porTabla.get('areas_condominio')]).toEqual(['activo'])
  })
})

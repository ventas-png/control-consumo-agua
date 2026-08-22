// Guards ESTÁTICOS de la migración de cierre posfusión (20260903000000).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; no ejecuta nada. La verificación
// CONDUCTUAL —que aborte cuando debe, que conserve el respaldo, que converja al
// reaplicarse— vive en scripts/cierre-posfusion-sandbox.sh, contra un Postgres
// de verdad.
//
// Lo que sí puede afirmarse leyendo: que la migración no se afloje con el
// tiempo. Las dos regresiones realistas son (1) que alguien le añada un
// `IF EXISTS` o un `EXCEPTION WHEN OTHERS` para que "pase" en un entorno donde
// falla, convirtiéndola en fail-open; y (2) que la comparación con el respaldo
// deje de cubrir todos los campos que la unificación escribió, que es la forma
// silenciosa de volverla vacua.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const MIGRATIONS = resolve('supabase/migrations')
const CIERRE = '20260903000000_recepcion_cierre_posfusion.sql'
const MOTOR = '20260829000600_recepcion_motor_unico.sql'
const INTEGRIDAD = '20260901000000_recepcion_integridad_final.sql'

const sql = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8')
const cierre = sql(CIERRE)

/** El bloque `array_remove(ARRAY[…], NULL)` que enumera los campos comparados. */
function bloqueDeComparacion(): string {
  const i = cierre.indexOf('array_remove(ARRAY[')
  const j = cierre.indexOf('], NULL) AS campos', i)
  expect(i, 'no se encontró el array de campos comparados').toBeGreaterThan(-1)
  expect(j, 'no se encontró el cierre del array de campos').toBeGreaterThan(i)
  return cierre.slice(i, j)
}

describe('la migración es append-only y posterior a la cadena de recepción', () => {
  it('su versión es mayor que la última de la cadena', () => {
    expect(CIERRE.slice(0, 14) > '20260902000000').toBe(true)
  })

  it('no reescribe ninguna migración histórica: sólo se referencia a sí misma', () => {
    // Citar otras versiones en comentarios está bien; ejecutar DDL sobre sus
    // objetos con ALTER/DROP fuera de lo declarado, no.
    const sentencias = cierre
      .split('\n')
      .filter(l => !l.trimStart().startsWith('--'))
      .join('\n')
    expect(sentencias).not.toMatch(/DROP\s+(TABLE|VIEW)\s+(IF\s+EXISTS\s+)?public\.paquetes_recibidos/i)
    expect(sentencias).not.toMatch(/DROP\s+VIEW/i)
  })
})

describe('sección 1 · la auditoría no puede divergir de la constraint', () => {
  const vocabulario = (texto: string) => {
    const m = texto.match(
      /WHEN\s+'paquete'\s+THEN\s+estado\s+IN\s*\(([^)]*)\)[\s\S]*?WHEN\s+'correspondencia'\s+THEN\s+estado\s+IN\s*\(([^)]*)\)/,
    )
    expect(m, 'no se pudo extraer el vocabulario').not.toBeNull()
    const limpia = (s: string) => s.split(',').map(x => x.trim().replace(/'/g, '')).sort()
    return { paquete: limpia(m![1]), correspondencia: limpia(m![2]) }
  }

  it('audita exactamente el mismo vocabulario que declara paquetes_estado_chk', () => {
    // Si alguien amplía el CHECK y no la auditoría, la migración abortaría por
    // filas que la constraint sí acepta. Si lo amplía al revés, VALIDATE
    // fallaría con el mensaje pobre que la auditoría existe para evitar.
    expect(vocabulario(cierre)).toEqual(vocabulario(sql(INTEGRIDAD)))
  })

  it('el vocabulario es el declarado, no otro', () => {
    expect(vocabulario(cierre)).toEqual({
      paquete: ['devuelto', 'entregado', 'pendiente'],
      correspondencia: ['archivado', 'atendido', 'devuelto', 'pendiente'],
    })
  })

  it('enumera las combinaciones ofensoras, no sólo su total', () => {
    expect(cierre).toMatch(/GROUP BY clase, estado/)
    expect(cierre).toMatch(/array_agg\(id ORDER BY id\)/)
    expect(cierre).toMatch(/string_agg\(/)
  })

  it('aborta con RAISE EXCEPTION, no con un aviso', () => {
    const i = cierre.indexOf('fuera del vocabulario')
    expect(i).toBeGreaterThan(-1)
    expect(cierre.slice(Math.max(0, i - 200), i)).toMatch(/RAISE EXCEPTION/)
  })
})

describe('sección 2 · el CHECK se valida', () => {
  it('ejecuta VALIDATE CONSTRAINT sobre paquetes_estado_chk', () => {
    expect(cierre).toMatch(
      /ALTER TABLE public\.paquetes_recibidos\s+VALIDATE CONSTRAINT paquetes_estado_chk;/,
    )
  })

  it('la validación va DESPUÉS de la auditoría', () => {
    // Sobre las SENTENCIAS, no sobre el texto: los comentarios de la sección 1
    // nombran `VALIDATE CONSTRAINT` para explicar por qué la auditoría existe.
    const ejecutable = cierre
      .split('\n')
      .filter(l => !l.trimStart().startsWith('--'))
      .join('\n')
    expect(ejecutable.indexOf('fuera del vocabulario'))
      .toBeLessThan(ejecutable.indexOf('VALIDATE CONSTRAINT'))
  })
})

describe('sección 3 · la vista de compatibilidad se conserva', () => {
  it('no la borra', () => {
    expect(cierre).not.toMatch(/DROP\s+VIEW[\s\S]*correspondencia_condominio/i)
  })

  it('deja escrito por qué se queda', () => {
    expect(cierre).toMatch(/COMMENT ON VIEW public\.correspondencia_condominio IS/)
    expect(cierre).toMatch(/RETENIDA A PROPÓSITO/)
  })
})

describe('sección 4 · la retirada del respaldo compara TODO lo que se migró', () => {
  // El guard que de verdad importa. La comparación se vuelve vacua sin que nada
  // más lo note si deja de cubrir un campo: la migración seguiría en verde y el
  // respaldo se borraría igual, sólo que sin haber comprobado ese campo.
  const COLUMNAS_INSERT = (() => {
    const motor = sql(MOTOR)
    const i = motor.indexOf('INSERT INTO public.paquetes_recibidos (')
    const j = motor.indexOf(')', i)
    return motor
      .slice(i + 'INSERT INTO public.paquetes_recibidos ('.length, j)
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)
  })()

  // `id` y `clase` no entran en la comparación campo a campo: los cubre el
  // chequeo de existencia, que exige la fila por id Y con la clase correcta.
  const COMPARABLES = COLUMNAS_INSERT.filter(c => c !== 'id' && c !== 'clase')

  it('el INSERT original escribió las 28 columnas que creemos', () => {
    expect(COLUMNAS_INSERT).toHaveLength(28)
    expect(COLUMNAS_INSERT).toContain('destinatario_tipo')
    expect(COLUMNAS_INSERT).toContain('hora_recepcion')
  })

  it.each(COMPARABLES)('compara %s', (columna) => {
    expect(bloqueDeComparacion()).toContain(`'${columna}'`)
  })

  it('usa IS DISTINCT FROM, que no se traga los NULL', () => {
    const bloque = bloqueDeComparacion()
    expect((bloque.match(/IS DISTINCT FROM/g) ?? []).length).toBe(COMPARABLES.length)
  })

  it('exige la fila por id Y por clase antes de comparar nada', () => {
    expect(cierre).toMatch(/WHERE p\.id = r\.id AND p\.clase = 'correspondencia'/)
  })

  it('reproduce el relleno de acuse en vez de tomarlo por divergencia', () => {
    expect(cierre).toContain('No registrado (acuse anterior a 2026-08-31)')
    expect(cierre).toMatch(/hubo_relleno/)
  })

  it('replica las normalizaciones del INSERT original', () => {
    for (const trozo of [
      "'carta','notificacion_legal','factura','circular','otro'",
      "'pendiente','atendido','archivado'",
      "WHEN 'salida' THEN 'saliente'",
      "r.prioridad = 'urgente'",
    ]) {
      expect(cierre).toContain(trozo)
    }
  })
})

describe('la migración es fail-closed', () => {
  const sinComentarios = cierre
    .split('\n')
    .filter(l => !l.trimStart().startsWith('--'))
    .join('\n')

  it('el DROP del respaldo no lleva IF EXISTS', () => {
    // Con IF EXISTS, un DROP que no encuentra la tabla —porque alguien la
    // renombró, o porque se está mirando el esquema equivocado— pasaría por
    // éxito.
    expect(sinComentarios).toMatch(/DROP TABLE public\.correspondencia_condominio_respaldo;/)
    expect(sinComentarios).not.toMatch(/DROP TABLE IF EXISTS/i)
  })

  it('no traga excepciones', () => {
    expect(sinComentarios).not.toMatch(/EXCEPTION\s+WHEN/i)
    expect(sinComentarios).not.toMatch(/ON CONFLICT/i)
  })

  it('la única rama silenciosa es la tabla ya retirada', () => {
    const notices = sinComentarios.match(/RAISE NOTICE/g) ?? []
    const excepciones = sinComentarios.match(/RAISE EXCEPTION/g) ?? []
    expect(sinComentarios).toMatch(/to_regclass\('public\.correspondencia_condominio_respaldo'\) IS NULL/)
    expect(sinComentarios).toMatch(/ya fue retirada/)
    // Tres avisos informativos y tres abortos: vocabulario, faltantes y
    // divergentes.
    expect(notices.length).toBeGreaterThanOrEqual(3)
    expect(excepciones).toHaveLength(3)
  })
})

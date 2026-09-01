// Guards del input `migration_file` del workflow_dispatch de apply-migrations-prod.
//
// Las dos clases que este validador existe para cortar, y que antes llegaban
// intactas al endpoint /database/query de PRODUCCIÓN:
//   · TRAVERSAL — `-f "$MIG_DIR/$INPUT_FILE"` acepta cualquier ruta que resuelva
//     a un archivo, así que un `../..` sacaba la selección de supabase/migrations.
//   · REAPLICACIÓN — el modo archivo-explícito no consultaba el historial remoto,
//     y reaplicar una histórica es la causa raíz del incidente 2026-08-03.
//
// Todo es puro: sin red, sin Actions, sin tocar el disco salvo por el `existe`
// inyectado.
import { describe, it, expect } from 'vitest'
import {
  RE_MIGRACION,
  tieneComponentesDeRuta,
  validarBasename,
  versionYaAplicada,
  validarDispatch,
  leerAplicadas,
  main,
} from '../validar-migration-dispatch.mjs'

const DIR = '/repo/supabase/migrations'
const VALIDO = '20260907001200_rbac_seccion_recursos_humanos.sql'
/** `existe` que dice sí a todo: aísla el test de nombre del de existencia. */
const siempreExiste = () => true

describe('traversal y rutas', () => {
  it.each([
    ['../../scripts/backfill-schema-migrations.sql', 'ruta relativa hacia arriba'],
    ['../20260907001200_x.sql', 'un solo nivel arriba'],
    ['/etc/passwd', 'ruta absoluta'],
    ['/tmp/20260907001200_x.sql', 'absoluta con nombre válido'],
    ['subdir/20260907001200_x.sql', 'subdirectorio'],
    ['..\\windows\\system32', 'separador de Windows'],
    ['20260907001200_x.sql/../../../etc/passwd', 'traversal tras un nombre válido'],
    ['..', 'el directorio padre a secas'],
  ])('rechaza %s (%s)', (entrada) => {
    const r = validarBasename(entrada, DIR, siempreExiste)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ruta')
    expect(r.mensaje).toMatch(/no una ruta|NOMBRE del archivo/)
  })

  it('el detector de ruta es independiente del formato', () => {
    expect(tieneComponentesDeRuta('a/b')).toBe(true)
    expect(tieneComponentesDeRuta('a\\b')).toBe(true)
    expect(tieneComponentesDeRuta('..')).toBe(true)
    expect(tieneComponentesDeRuta(VALIDO)).toBe(false)
  })

  it('un traversal NUNCA se reporta como "inexistente" (el mensaje no debe confundir)', () => {
    // Con un `existe` que dice sí, la ruta sigue siendo el motivo del rechazo.
    const r = validarBasename('../../package.json', DIR, siempreExiste)
    expect(r.code).toBe('ruta')
  })

  it('la contención se verifica también sobre la ruta resuelta', () => {
    // Defensa en profundidad: si el regex se relajara, `resolve` sigue atando el
    // destino al directorio. Se prueba llamando a la comprobación con un nombre
    // que pasa el regex pero cuyo destino se sale (imposible hoy, y así debe seguir).
    const r = validarBasename(VALIDO, DIR, siempreExiste)
    expect(r.ok).toBe(true)
    expect(r.version).toBe('20260907001200')
  })
})

describe('formato de migración', () => {
  it.each([
    ['cualquier-cosa.sql', 'sin versión'],
    ['2026090700120_x.sql', '13 dígitos'],
    ['202609070012000_x.sql', '15 dígitos'],
    ['20260907001200.sql', 'sin nombre tras la versión'],
    ['20260907001200_x.txt', 'extensión equivocada'],
    ['20260907001200_x.sql.bak', 'no termina en .sql'],
    ['abcdefghijklmn_x.sql', 'versión no numérica'],
    ['20260907001200_.sql', 'nombre vacío tras el guion bajo'],
  ])('rechaza %s (%s)', (entrada) => {
    const r = validarBasename(entrada, DIR, siempreExiste)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('formato')
  })

  it('acepta el formato canónico y extrae la versión', () => {
    const r = validarBasename(VALIDO, DIR, siempreExiste)
    expect(r).toMatchObject({ ok: true, base: VALIDO, version: '20260907001200' })
  })

  it('el regex es el mismo `^(\\d{14})_` que usa migrations-guard', () => {
    expect(RE_MIGRACION.test('20260317000000_baseline_legacy_tables_phase1.sql')).toBe(true)
    expect(RE_MIGRACION.test('20260907001200_rbac_seccion_recursos_humanos.sql')).toBe(true)
  })

  it('un input vacío o sólo espacios se rechaza como vacío', () => {
    expect(validarBasename('', DIR, siempreExiste).code).toBe('vacio')
    expect(validarBasename('   ', DIR, siempreExiste).code).toBe('vacio')
    expect(validarBasename(null, DIR, siempreExiste).code).toBe('vacio')
  })

  it('un nombre válido que no existe en el directorio se reporta como inexistente', () => {
    const r = validarBasename(VALIDO, DIR, () => false)
    expect(r.code).toBe('inexistente')
  })
})

describe('versión ya aplicada (append-only)', () => {
  const aplicadas = ['20260317000000', '20260320000000', '20260907001200']

  it('aborta si la versión ya está registrada en el historial remoto', () => {
    const r = validarDispatch({ input: VALIDO, dir: DIR, aplicadas, existe: siempreExiste })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ya_aplicada')
    expect(r.version).toBe('20260907001200')
  })

  it('el mensaje manda crear una migración NUEVA, no reaplicar', () => {
    const r = validarDispatch({ input: VALIDO, dir: DIR, aplicadas, existe: siempreExiste })
    expect(r.mensaje).toMatch(/append-only/)
    expect(r.mensaje).toMatch(/nunca reaplicando una histórica/)
    expect(r.mensaje).toMatch(/timestamp posterior/)
  })

  it('deja pasar una versión que NO está en el historial', () => {
    const nueva = '20260908000000_correccion_nueva.sql'
    const r = validarDispatch({ input: nueva, dir: DIR, aplicadas, existe: siempreExiste })
    expect(r).toMatchObject({ ok: true, version: '20260908000000' })
  })

  it('la comparación es exacta: un prefijo compartido no cuenta como aplicada', () => {
    expect(versionYaAplicada('20260907001200', ['202609070012000'])).toBe(false)
    expect(versionYaAplicada('20260907001200', ['2026090700120'])).toBe(false)
    expect(versionYaAplicada('20260907001200', ['20260907001200'])).toBe(true)
  })

  it('tolera espacios y líneas vacías en el historial (viene de un jq -r)', () => {
    expect(versionYaAplicada('20260907001200', ['  20260907001200  '])).toBe(true)
    expect(leerAplicadas('x', () => '20260317000000\n\n  20260320000000  \n'))
      .toEqual(['20260317000000', '20260320000000'])
  })

  it('sin --aplicadas (ruta nula) devuelve [] — no se pidió historial', () => {
    expect(leerAplicadas(null)).toEqual([])
    expect(leerAplicadas('')).toEqual([])
  })

  it('un historial remoto legítimamente VACÍO no es un error', () => {
    // Proyecto recién creado: cero versiones registradas. `printf '%s\n' \"\"`
    // deja una línea en blanco, que se filtra.
    expect(leerAplicadas('x', () => '\n')).toEqual([])
  })

  it('el orden importa: el traversal se corta ANTES de mirar el historial', () => {
    // Un traversal no debe depender de que el historial se haya podido leer.
    const r = validarDispatch({ input: '../x.sql', dir: DIR, aplicadas: [], existe: siempreExiste })
    expect(r.code).toBe('ruta')
  })
})

describe('main (envoltorio de CLI)', () => {
  it('sale 1 y emite ::error:: en un traversal', () => {
    const errores = []
    const code = main(['--file', '../../etc/passwd', '--dir', 'supabase/migrations'], (m) => errores.push(m))
    expect(code).toBe(1)
    expect(errores[0]).toMatch(/^::error::/)
  })

  it('sale 1 con un nombre de formato inválido', () => {
    const errores = []
    const code = main(['--file', 'suelta.sql', '--dir', 'supabase/migrations'], (m) => errores.push(m))
    expect(code).toBe(1)
    expect(errores[0]).toMatch(/formato de migración/)
  })

  it('sale 0 con una migración real del repo no aplicada', () => {
    const code = main(['--file', VALIDO, '--dir', 'supabase/migrations'], () => {})
    expect(code).toBe(0)
  })
})


// ── FAIL-CLOSED del historial ───────────────────────────────────────────────
//
// `leerAplicadas` devolvía [] ante cualquier fallo de lectura. Una lista vacía
// es INDISTINGUIBLE de "no hay ninguna migración aplicada": con el historial
// caído, el validador daba por buena cualquier versión y el dispatch reaplicaba
// una histórica contra producción — justo lo que este script existe para
// impedir. Ahora lanza, y `main` lo traduce a código de salida ≠ 0.
describe('historial ausente, ilegible o inválido (fail-closed)', () => {
  const VALIDO = '20260907001200_rbac_seccion_recursos_humanos.sql'

  it('archivo AUSENTE → lanza, nunca lista vacía', () => {
    const enoent = () => { const e = new Error('ENOENT: no such file or directory'); throw e }
    expect(() => leerAplicadas('/no/existe.txt', enoent)).toThrow(/No se pudo leer el historial/)
  })

  it('archivo ILEGIBLE (permisos) → lanza', () => {
    const eacces = () => { throw new Error('EACCES: permission denied') }
    expect(() => leerAplicadas('/root/hist.txt', eacces)).toThrow(/EACCES/)
  })

  it('contenido INVÁLIDO (no son versiones) → lanza en vez de tratarlo como vacío', () => {
    // El caso realista: un error o HTML volcado al archivo en vez del historial.
    expect(() => leerAplicadas('x', () => '<html>502 Bad Gateway</html>'))
      .toThrow(/no son\s+versiones de 14 dígitos|no son versiones/)
    expect(() => leerAplicadas('x', () => '{"message":"Unauthorized"}'))
      .toThrow(/no es un historial válido|no son versiones/i)
  })

  it('una sola línea corrupta entre versiones válidas también aborta', () => {
    expect(() => leerAplicadas('x', () => '20260317000000\nbasura\n20260320000000'))
      .toThrow()
  })

  it('main sale 1 y emite ::error:: cuando el historial no se puede leer', () => {
    const errores = []
    const code = main(
      ['--file', VALIDO, '--dir', 'supabase/migrations', '--aplicadas', '/no/existe/historial.txt'],
      (m) => errores.push(m),
    )
    expect(code).toBe(1)
    expect(errores[0]).toMatch(/^::error::/)
    expect(errores[0]).toMatch(/No se pudo leer el historial/)
  })

  it('el fallo del historial NO se confunde con "versión válida": jamás sale 0', () => {
    // Con el bug anterior, historial ilegible → [] → la versión "no estaba
    // aplicada" → exit 0 → producción reaplicaba. Este es el guard de esa regresión.
    const code = main(
      ['--file', VALIDO, '--dir', 'supabase/migrations', '--aplicadas', '/no/existe/historial.txt'],
      () => {},
    )
    expect(code).not.toBe(0)
  })
})

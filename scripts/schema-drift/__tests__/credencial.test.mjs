// Las piezas PURAS del auditor de credenciales.
//
// No hay modo live: no existe una credencial soportada que pueda leer
// producción sin alcanzar el contenido de las integraciones —ver
// `decision-net-pg_net.md`—, así que el camino que se conectaba a una base
// remota se retiró.
//
// Lo que corre contra un Postgres real vive en `auditar.mjs
// --prueba-credencial`, con un clúster DESECHABLE que la propia prueba levanta.
// Acá va lo que puede tener bugs sin necesidad de una base: la DECISIÓN sobre
// una credencial ya medida, que es donde vivió el bug que importaba —la primera
// versión comparaba `=== 't'` contra un SQL que devolvía 'true', así que los
// controles de superusuario, BYPASSRLS, CREATEROLE y CREATEDB no rechazaban
// nada. Un guard roto de esa forma no rompe ninguna prueba: falla ABIERTO y
// calla.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  juzgarCredencial, SECDEF_PERMITIDAS, avisarCredencial, clasificarLectura,
  LECTURA_TOLERADA, SQL_PRIVS_TABLA, SIN_REMEDIO_SOPORTADO, AVISO_SIN_REMEDIO,
} from '../auditar.mjs'

const sana = {
  usuario: 'drift_readonly',
  // Citado por Postgres con `quote_ident`, no por una plantilla de JavaScript.
  usuario_sql: 'drift_readonly',
  superusuario: 'false', bypassrls: 'false', crear_roles: 'false',
  crear_bases: 'false', replicacion: 'false',
  solo_lectura: 'on', version: '17.6.1', search_path: '"$user", public, extensions',
}
// Una tabla llega como `nombre\x1desquema\x1dprocedencia\x1dflags`: los dos
// primeros ya citados desde SQL, la procedencia con `+` entre fuentes. El
// cuarto campo depende de la dimensión: los privilegios detectados en
// `escribientes`/`secuencias`/`columnas`, y el marcador `ext` en `leibles`.
const T = (nombre, esquema, via = 'drift_readonly', flags = '') =>
  `${nombre}\x1d${esquema}\x1d${via}\x1d${flags}`
const reglas = (m, opciones) => juzgarCredencial(m, opciones).map(r => r.regla)

describe('juzgarCredencial', () => {
  it('acepta una credencial que sólo puede leer el catálogo', () => {
    expect(juzgarCredencial(sana)).toEqual([])
  })

  // LA REGRESIÓN. Las dos grafías tienen que rechazar; aceptar sólo una es
  // exactamente el bug, y no se nota hasta que alguien conecta un superusuario.
  for (const grafia of ['true', 't']) {
    it(`rechaza un superusuario escrito «${grafia}»`, () => {
      expect(reglas({ ...sana, superusuario: grafia })).toContain('SUPERUSUARIO')
    })
  }

  const atributos = [
    ['bypassrls', 'BYPASSRLS'],
    ['crear_roles', 'CREATEROLE'],
    ['crear_bases', 'CREATEDB'],
    ['replicacion', 'REPLICATION'],
  ]
  for (const [campo, regla] of atributos) {
    it(`rechaza ${regla}`, () => expect(reglas({ ...sana, [campo]: 'true' })).toContain(regla))
  }

  it('rechaza que pueda escribir', () => {
    expect(reglas({ ...sana, escribibles: T('public.clientes', 'public', 'drift_readonly', 'INSERT') }))
      .toContain('ESCRITURA')
  })

  it('rechaza SELECT a nivel tabla: la huella sale del catálogo, no de los datos', () => {
    expect(reglas({ ...sana, leibles: [T('public.clientes', 'public'), T('public.facturas', 'public')].join('\x1e') }))
      .toContain('SELECT DE TABLA')
  })

  it('rechaza privilegios por columna, que has_table_privilege no ve', () => {
    expect(reglas({ ...sana, columnas: T('public.usuarios', 'public', 'drift_readonly', 'SELECT (email)') }))
      .toContain('PRIVILEGIO POR COLUMNA')
  })

  it('rechaza CREATE sobre un esquema', () => {
    expect(reglas({ ...sana, crear_esquemas: 'public' })).toContain('CREATE SOBRE ESQUEMA')
  })

  it('rechaza cualquier membresía: con NOINHERIT sigue alcanzable por SET ROLE', () => {
    expect(reglas({ ...sana, membresias: 'authenticated' })).toContain('MEMBRESÍA')
  })

  it('rechaza la sesión que no quedó en solo lectura', () => {
    expect(reglas({ ...sana, solo_lectura: 'off' })).toContain('SESIÓN DE ESCRITURA')
  })

  it('rechaza un esquema del search_path sin USAGE, y dice el GRANT que lo arregla', () => {
    const r = juzgarCredencial({ ...sana, sin_usage: 'extensions' })
    expect(r.map(x => x.regla)).toContain('SIN USAGE EN EL SEARCH_PATH')
    expect(r[0].remedio).toBe('GRANT USAGE ON SCHEMA extensions TO drift_readonly;')
  })

  it('junta TODOS los motivos, no se planta en el primero', () => {
    const r = reglas({ ...sana, superusuario: 'true', replicacion: 'true', crear_esquemas: 'public' })
    expect(r).toEqual(expect.arrayContaining(['SUPERUSUARIO', 'REPLICATION', 'CREATE SOBRE ESQUEMA']))
  })

  it('cada motivo trae un remedio en SQL, no sólo un reproche', () => {
    for (const r of juzgarCredencial({ ...sana, bypassrls: 'true', leibles: T('public.clientes', 'public') })) {
      expect(r.remedio.length).toBeGreaterThan(0)
    }
  })
})

describe('juzgarCredencial · SECURITY DEFINER', () => {
  // Cada elemento llega como `identidad\x1dprocedencia`: por dónde alcanza el
  // privilegio a esta credencial. PUBLIC, un GRANT directo, o una membresía.
  const F = (ident, via) => `${ident}\x1d${via}`
  const conSecdef = {
    ...sana,
    secdef: [F('public.reindexar(text)', 'PUBLIC'), F('extensions.sd_ext()', 'drift_readonly')]
      .join('\x1e'),
  }

  it('rechaza una función SECURITY DEFINER al alcance de la credencial', () => {
    expect(reglas(conSecdef)).toContain('SECURITY DEFINER')
  })

  it('el motivo nombra las funciones y por dónde le llegan', () => {
    const r = juzgarCredencial(conSecdef).find(x => x.regla === 'SECURITY DEFINER')
    expect(r.detalle).toContain('public.reindexar(text) [vía PUBLIC]')
    expect(r.detalle).toContain('extensions.sd_ext() [vía drift_readonly]')
  })

  // EL REMEDIO DEPENDE DE LA PROCEDENCIA, y equivocarlo es peor que no darlo:
  // `REVOKE … FROM PUBLIC` sobre una función concedida directamente al auditor
  // no hace absolutamente nada, y deja creer que el agujero se cerró.
  it('propone revocar a PUBLIC cuando el privilegio viene de PUBLIC', () => {
    const r = juzgarCredencial({ ...sana, secdef: F('public.reindexar(text)', 'PUBLIC') })[0]
    expect(r.remedio).toContain('REVOKE EXECUTE ON FUNCTION public.reindexar(text) FROM PUBLIC;')
  })

  it('propone revocar AL AUDITOR cuando el GRANT es directo', () => {
    const r = juzgarCredencial({ ...sana, secdef: F('public.reindexar(text)', 'drift_readonly') })[0]
    expect(r.remedio).toContain('REVOKE EXECUTE ON FUNCTION public.reindexar(text) FROM drift_readonly;')
    expect(r.remedio).not.toContain('FROM PUBLIC')
  })

  // Y cuando llega por una membresía, NO se revoca al rol intermedio: puede ser
  // `authenticated`, y revocarle rompe la aplicación. Se quita la membresía.
  it('cuando llega por una membresía propone quitar la membresía, no tocar el rol', () => {
    const r = juzgarCredencial({
      ...sana, membresias: 'authenticated', secdef: F('public.get_my_company_id()', 'authenticated'),
    }).find(x => x.regla === 'SECURITY DEFINER')
    expect(r.remedio).toContain('REVOKE authenticated FROM drift_readonly;')
    expect(r.remedio).not.toContain('REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM authenticated')
  })

  it('una allowlist explícita levanta el rechazo SÓLO de lo que declara', () => {
    const permitidas = new Map([['public.get_my_company_id()', 'ayudante de RLS, no toca datos']])
    const dos = { ...sana, secdef: [F('public.reindexar(text)', 'PUBLIC'),
                                    F('public.get_my_company_id()', 'PUBLIC')].join('\x1e') }
    expect(reglas(dos, { permitidas })).toContain('SECURITY DEFINER')
    expect(reglas({ ...sana, secdef: F('public.get_my_company_id()', 'PUBLIC') }, { permitidas }))
      .toEqual([])
  })

  // TRIPWIRE. Que la lista esté vacía no es un detalle de implementación: es la
  // postura. Llenarla es afirmar que esa función, corriendo como su dueño, no
  // le da a esta credencial nada que no debería tener — y eso lo firma quien
  // revisa el PR que agrega la línea, no el auditor.
  it('la allowlist por defecto está vacía', () => {
    expect([...SECDEF_PERMITIDAS.keys()]).toEqual([])
  })
})

describe('juzgarCredencial · la medición tiene que estar completa', () => {
  // Un campo que no llegó se lee `undefined`, `cierto(undefined)` es falso y la
  // regla que lo mira deja de rechazar. Es la misma forma de fallar abierto que
  // el 't' contra 'true', por otro camino: acá el guard no se equivoca, no se
  // entera. Si falta algo, no se juzga.
  for (const campo of ['superusuario', 'bypassrls', 'replicacion', 'solo_lectura']) {
    it(`rechaza si no llegó «${campo}» en vez de darlo por falso`, () => {
      const incompleta = { ...sana }
      delete incompleta[campo]
      expect(reglas(incompleta)).toEqual(['MEDICIÓN INCOMPLETA'])
    })
  }
})
describe('juzgarCredencial · los remedios salen de lo que se detectó', () => {
  // El escaneo mira TODOS los esquemas no internos, así que un remedio fijado a
  // `public` es falso cuando la tabla está en `auth` o en un esquema propio: se
  // pega, no cambia nada, y el guard vuelve a saltar.
  it('nombra el esquema real, no public', () => {
    const r = juzgarCredencial({ ...sana, leibles: T('auth.users', 'auth') })[0]
    expect(r.remedio).toBe('REVOKE SELECT ON ALL TABLES IN SCHEMA auth FROM drift_readonly;')
  })

  it('emite una línea por cada esquema detectado, sin repetir', () => {
    const r = juzgarCredencial({
      ...sana,
      escribibles: [T('auth.users', 'auth', 'drift_readonly', 'INSERT, UPDATE, DELETE, TRUNCATE'),
                    T('auth.sessions', 'auth', 'drift_readonly', 'INSERT, UPDATE, DELETE, TRUNCATE'),
                    T('mio.t', 'mio', 'drift_readonly', 'INSERT, UPDATE, DELETE, TRUNCATE')].join('\x1e'),
    })[0]
    expect(r.remedio.split('\n').map(l => l.trim())).toEqual([
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA auth FROM drift_readonly;',
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA mio FROM drift_readonly;',
    ])
  })

  // Los nombres los cita Postgres con `format('%I')`/`quote_ident`, así que
  // llegan listos para pegar. Lo que se comprueba aquí es que el remedio los
  // use TAL CUAL y no vuelva a envolverlos ni los parta por el punto.
  it('respeta las comillas que puso Postgres en nombres raros', () => {
    const r = juzgarCredencial({
      ...sana,
      usuario: 'Drift Readonly', usuario_sql: '"Drift Readonly"',
      leibles: T('"mi esquema"."mi.tabla"', '"mi esquema"', '"Drift Readonly"'),
    })[0]
    expect(r.remedio).toBe('REVOKE SELECT ON ALL TABLES IN SCHEMA "mi esquema" FROM "Drift Readonly";')
    expect(r.detalle).toContain('"mi esquema"."mi.tabla"')
  })

  // `ON ALL TABLES` no revoca un GRANT por columna, y un marcador `<columnas>`
  // no es SQL: el remedio nombra las columnas REALES, ya citadas por Postgres.
  it('el privilegio por columna nombra la tabla y las columnas reales', () => {
    const r = juzgarCredencial({
      ...sana, columnas: T('auth.users', 'auth', 'drift_readonly', 'SELECT (email, "raro nombre")'),
    })[0]
    expect(r.remedio).toContain(
      'REVOKE SELECT (email, "raro nombre") ON auth.users FROM drift_readonly;')
    expect(r.remedio).not.toContain('<columnas>')
  })

  it('los remedios de atributo usan el nombre citado del rol', () => {
    const r = juzgarCredencial({
      ...sana, usuario: 'Drift Readonly', usuario_sql: '"Drift Readonly"', bypassrls: 'true',
    })[0]
    expect(r.remedio).toBe('ALTER ROLE "Drift Readonly" NOBYPASSRLS;')
  })
})

describe('juzgarCredencial · SECURITY DEFINER, fuentes acumuladas', () => {
  const F = (ident, via) => `${ident}\x1d${via}`
  const lineas = (m) =>
    juzgarCredencial(m).find(x => x.regla === 'SECURITY DEFINER').remedio.split('\n').map(l => l.trim())

  // PUBLIC, un GRANT directo, una membresía y la propiedad pueden darse A LA
  // VEZ. Cerrar sólo la primera deja el camino abierto por las otras, y el
  // diagnóstico habría dicho que estaba resuelto.
  it('PUBLIC + grant directo: las dos líneas', () => {
    const l = lineas({ ...sana, secdef: F('public.f()', 'PUBLIC+drift_readonly') })
    expect(l).toContain('REVOKE EXECUTE ON FUNCTION public.f() FROM PUBLIC;')
    expect(l).toContain('REVOKE EXECUTE ON FUNCTION public.f() FROM drift_readonly;')
  })

  it('membresía + grant directo: se revoca el grant y se quita la membresía', () => {
    const l = lineas({
      ...sana, membresias: 'authenticated', secdef: F('public.f()', 'authenticated+drift_readonly'),
    })
    expect(l).toContain('REVOKE EXECUTE ON FUNCTION public.f() FROM drift_readonly;')
    expect(l.some(x => x.startsWith('REVOKE authenticated FROM drift_readonly;'))).toBe(true)
  })

  // LA REGLA QUE NO SE NEGOCIA: el rol intermedio es de la aplicación.
  // Revocarle `authenticated` el EXECUTE arregla el auditor y rompe el producto.
  it('NUNCA propone revocarle el privilegio al rol intermedio', () => {
    const l = lineas({
      ...sana, membresias: 'authenticated', secdef: F('public.get_my_company_id()', 'authenticated'),
    })
    expect(l.some(x => /FROM authenticated;/.test(x))).toBe(false)
    expect(l).toContain('REVOKE authenticated FROM drift_readonly;   -- llega por membresía en ' +
                        'authenticated; NO se le revoca a authenticated, que es de la aplicación')
  })

  it('propiedad + grant directo: ceder la propiedad Y revocar el grant', () => {
    const l = lineas({ ...sana, secdef: F('mio.f()', 'drift_readonly+dueño') })
    expect(l).toContain('REVOKE EXECUTE ON FUNCTION mio.f() FROM drift_readonly;')
    expect(l.some(x => x.startsWith('ALTER FUNCTION mio.f() OWNER TO'))).toBe(true)
  })

  it('la propiedad sola también trae su remedio', () => {
    const l = lineas({ ...sana, secdef: F('mio.f()', 'dueño') })
    expect(l.some(x => x.startsWith('ALTER FUNCTION mio.f() OWNER TO'))).toBe(true)
  })

  it('sin procedencia reconocible lo dice, en vez de callarse', () => {
    const l = lineas({ ...sana, secdef: F('mio.f()', '') })
    expect(l.some(x => /no se pudo determinar la procedencia/.test(x))).toBe(true)
  })
})

describe('juzgarCredencial · tablas, remedio según la procedencia REAL', () => {
  const lineas = (m, regla) =>
    juzgarCredencial(m).find(x => x.regla === regla).remedio.split('\n').map(l => l.trim())

  // EL CASO QUE MOTIVA TODO ESTO. Si el SELECT viene de PUBLIC, un
  // `REVOKE … FROM drift_readonly` NO LO ELIMINA —no hay nada que quitarle— y
  // el diagnóstico habría dicho que estaba resuelto.
  it('de PUBLIC: revoca a PUBLIC y NUNCA al auditor', () => {
    const l = lineas({ ...sana, leibles: T('mio.t', 'mio', 'PUBLIC') }, 'SELECT DE TABLA')
    expect(l.some(x => x.startsWith('REVOKE SELECT ON mio.t FROM PUBLIC;'))).toBe(true)
    expect(l.some(x => /FROM drift_readonly;/.test(x))).toBe(false)
  })

  it('y lo marca como decisión de política, porque afecta a todos los roles', () => {
    const l = lineas({ ...sana, leibles: T('mio.t', 'mio', 'PUBLIC') }, 'SELECT DE TABLA')
    expect(l.some(x => /decisión de POLÍTICA/.test(x))).toBe(true)
  })

  it('de un grant directo: barre el esquema entero, que es lo que se quiere para un rol dedicado', () => {
    const l = lineas({ ...sana, leibles: T('mio.t', 'mio', 'drift_readonly') }, 'SELECT DE TABLA')
    expect(l).toContain('REVOKE SELECT ON ALL TABLES IN SCHEMA mio FROM drift_readonly;')
  })

  it('de una membresía: quita la membresía y NO toca el rol intermedio', () => {
    const l = lineas({
      ...sana, membresias: 'authenticated', leibles: T('mio.t', 'mio', 'authenticated'),
    }, 'SELECT DE TABLA')
    expect(l.some(x => x.startsWith('REVOKE authenticated FROM drift_readonly;'))).toBe(true)
    expect(l.some(x => /ON mio\.t FROM authenticated;/.test(x))).toBe(false)
  })

  it('de la propiedad: propone ceder el dueño', () => {
    const l = lineas({ ...sana, leibles: T('mio.t', 'mio', 'dueño') }, 'SELECT DE TABLA')
    expect(l.some(x => x.startsWith('ALTER TABLE mio.t OWNER TO'))).toBe(true)
  })

  // Y las cuatro a la vez: cerrar una sola deja abiertas las otras tres.
  it('acumula: PUBLIC + directo + membresía + propiedad, las cuatro líneas', () => {
    const l = lineas({
      ...sana, membresias: 'authenticated',
      leibles: T('mio.t', 'mio', 'PUBLIC+drift_readonly+authenticated+dueño'),
    }, 'SELECT DE TABLA')
    expect(l).toContain('REVOKE SELECT ON ALL TABLES IN SCHEMA mio FROM drift_readonly;')
    expect(l.some(x => x.startsWith('REVOKE SELECT ON mio.t FROM PUBLIC;'))).toBe(true)
    expect(l.some(x => x.startsWith('ALTER TABLE mio.t OWNER TO'))).toBe(true)
    expect(l.some(x => x.startsWith('REVOKE authenticated FROM drift_readonly;'))).toBe(true)
  })

  it('el detalle dice la procedencia de cada tabla', () => {
    const r = juzgarCredencial({ ...sana, escribibles: T('mio.t', 'mio', 'PUBLIC', 'INSERT') })[0]
    expect(r.regla).toBe('ESCRITURA')
    expect(r.detalle).toContain('mio.t [INSERT, vía PUBLIC]')
  })

  it('sin procedencia reconocible lo dice, en vez de proponer algo que no sirve', () => {
    const l = lineas({ ...sana, leibles: T('mio.t', 'mio', '') }, 'SELECT DE TABLA')
    expect(l.some(x => /no se pudo determinar la procedencia/.test(x))).toBe(true)
  })
})

// ── pg_stat_statements ──────────────────────────────────────────────────────
//
// La credencial NECESITA `USAGE` sobre `extensions` —sin él la huella no
// coincide con la del dueño—, y la extensión concede `SELECT` a `PUBLIC` sobre
// sus dos vistas. Quedan alcanzables por un requisito de corrección, no por un
// grant que alguien le haya dado a esta credencial. La decisión: no bloquear y
// AVISAR en cada corrida. Tres condiciones, y las tres tienen que darse.

describe('clasificarLectura · la tolerancia es estrecha y explícita', () => {
  const item = (nombre, via, flags) => ({
    nombre, esquema: 'extensions', via, fuentes: via.split('+').filter(Boolean), flags,
  })

  // FAIL-CLOSED. Hubo una propuesta de tolerar las dos vistas de
  // `pg_stat_statements` —son contadores, y la credencial las alcanza por
  // necesitar USAGE sobre `extensions`—. NUNCA fue aprobada por quien opera la
  // base, así que la lista está vacía y esto BLOQUEA.
  it('sin tolerancia aprobada, pg_stat_statements BLOQUEA aunque venga de PUBLIC', () => {
    const { bloquean, tolerados } = clasificarLectura([
      item('extensions.pg_stat_statements', 'PUBLIC', 'ext'),
      item('extensions.pg_stat_statements_info', 'PUBLIC', 'ext'),
    ])
    expect(tolerados).toEqual([])
    expect(bloquean).toHaveLength(2)
  })

  // Un GRANT directo ya no es «la extensión dejó su default»: es alguien
  // dándole acceso a ESTA credencial.
  it('bloquea si además hay un grant directo', () => {
    const { bloquean } = clasificarLectura([
      item('extensions.pg_stat_statements', 'PUBLIC+drift_readonly', 'ext'),
    ])
    expect(bloquean).toHaveLength(1)
  })

  it('bloquea si llega por una membresía', () => {
    const { bloquean } = clasificarLectura([
      item('extensions.pg_stat_statements', 'authenticated', 'ext'),
    ])
    expect(bloquean).toHaveLength(1)
  })

  // El nombre no alcanza: una tabla que se llame así y no pertenezca a una
  // extensión es una tabla cualquiera.
  it('bloquea si el objeto NO pertenece a una extensión, aunque se llame igual', () => {
    const { bloquean } = clasificarLectura([
      item('extensions.pg_stat_statements', 'PUBLIC', ''),
    ])
    expect(bloquean).toHaveLength(1)
  })

  it('bloquea cualquier otra vista de extensión: la lista es de dos, no una categoría', () => {
    const { bloquean } = clasificarLectura([item('extensions.otra_vista', 'PUBLIC', 'ext')])
    expect(bloquean).toHaveLength(1)
  })

  // TRIPWIRE. Que la lista esté vacía es la POSTURA, no un detalle: agregar una
  // entrada es afirmar que ese objeto, alcanzable por esa vía, no le da a la
  // credencial nada que no debería tener. Eso lo firma quien revisa el PR, no
  // el auditor — y esta prueba obliga a que sea un acto visible.
  it('la lista de tolerancias está VACÍA: nada se tolera sin aprobación', () => {
    expect([...LECTURA_TOLERADA.keys()]).toEqual([])
  })

  it('y con la lista vacía nada puede caer del lado tolerado', () => {
    const { tolerados } = clasificarLectura([
      item('extensions.pg_stat_statements', 'PUBLIC', 'ext'),
      item('extensions.lo_que_sea', 'PUBLIC', 'ext'),
      item('public.clientes', 'PUBLIC', ''),
    ])
    expect(tolerados).toEqual([])
  })
})

describe('avisarCredencial · no hay nada tolerado que anunciar', () => {
  const conStat = {
    ...sana,
    leibles: T('extensions.pg_stat_statements', 'extensions', 'PUBLIC', 'ext'),
  }

  it('pg_stat_statements bloquea, y el motivo es SELECT DE TABLA', () => {
    expect(reglas(conStat)).toContain('SELECT DE TABLA')
  })

  it('y el remedio nombra el objeto y de dónde viene el privilegio', () => {
    const r = juzgarCredencial(conStat).find(x => x.regla === 'SELECT DE TABLA')
    expect(r.detalle).toContain('extensions.pg_stat_statements [vía PUBLIC]')
    expect(r.remedio).toContain('REVOKE SELECT ON extensions.pg_stat_statements FROM PUBLIC;')
  })

  // El canal de avisos sigue existiendo: es lo que diría si alguna vez se
  // aprobara una tolerancia. Hoy no dice nada porque no hay ninguna.
  it('no anuncia nada como tolerado, porque no hay tolerancias', () => {
    expect(avisarCredencial(conStat)).toEqual([])
    expect(avisarCredencial({ ...sana, leibles: T('mio.t', 'mio', 'PUBLIC') })).toEqual([])
  })
})

// ── Secuencias ──────────────────────────────────────────────────────────────
//
// Quedaban fuera del escaneo, que sólo miraba 'r','p','v','m','f'. Y no es un
// detalle: `USAGE` o `UPDATE` sobre una secuencia dejan MOVER el contador
// —escritura de estado compartido, y un salto de correlativo se nota en la
// facturación—, y `SELECT` deja leer el último valor. `has_table_privilege` ni
// siquiera responde por USAGE.

describe('juzgarCredencial · secuencias', () => {
  // El cuarto campo son los privilegios que efectivamente tiene.
  const S = (nombre, esquema, via, privs) => `${nombre}\x1d${esquema}\x1d${via}\x1d${privs}`
  const lineas = (m) =>
    juzgarCredencial(m).find(x => x.regla === 'SECUENCIA').remedio.split('\n').map(l => l.trim())

  it('rechaza una secuencia alcanzable', () => {
    expect(juzgarCredencial({ ...sana, secuencias: S('mio.s', 'mio', 'PUBLIC', 'SELECT') })
      .map(r => r.regla)).toContain('SECUENCIA')
  })

  it('el detalle dice qué privilegios tiene y por dónde llegan', () => {
    const r = juzgarCredencial({
      ...sana, secuencias: S('mio.s', 'mio', 'PUBLIC', 'SELECT, USAGE, UPDATE'),
    })[0]
    expect(r.detalle).toContain('mio.s [SELECT, USAGE, UPDATE, vía PUBLIC]')
  })

  // De PUBLIC: `ON SEQUENCE`, y NUNCA `FROM <auditor>` — no hay nada que
  // quitarle.
  it('de PUBLIC: REVOKE … ON SEQUENCE … FROM PUBLIC, marcado como política', () => {
    const l = lineas({ ...sana, secuencias: S('mio.s', 'mio', 'PUBLIC', 'SELECT, USAGE, UPDATE') })
    expect(l.some(x => x.startsWith(
      'REVOKE SELECT, USAGE, UPDATE ON SEQUENCE mio.s FROM PUBLIC;'))).toBe(true)
    expect(l.some(x => /decisión de POLÍTICA/.test(x))).toBe(true)
    expect(l.some(x => /FROM drift_readonly;/.test(x))).toBe(false)
  })

  it('de un grant directo: ON ALL SEQUENCES IN SCHEMA', () => {
    const l = lineas({ ...sana, secuencias: S('mio.s', 'mio', 'drift_readonly', 'USAGE') })
    expect(l).toContain('REVOKE USAGE ON ALL SEQUENCES IN SCHEMA mio FROM drift_readonly;')
  })

  it('de una membresía: quita la membresía y no toca el rol intermedio', () => {
    const l = lineas({
      ...sana, membresias: 'authenticated',
      secuencias: S('mio.s', 'mio', 'authenticated', 'USAGE'),
    })
    expect(l.some(x => x.startsWith('REVOKE authenticated FROM drift_readonly;'))).toBe(true)
    expect(l.some(x => /ON SEQUENCE mio\.s FROM authenticated;/.test(x))).toBe(false)
  })

  it('de la propiedad: ALTER SEQUENCE … OWNER TO', () => {
    const l = lineas({ ...sana, secuencias: S('mio.s', 'mio', 'dueño', 'SELECT') })
    expect(l.some(x => x.startsWith('ALTER SEQUENCE mio.s OWNER TO'))).toBe(true)
  })

  it('acumula las cuatro vías', () => {
    const l = lineas({
      ...sana, membresias: 'authenticated',
      secuencias: S('mio.s', 'mio', 'PUBLIC+drift_readonly+authenticated+dueño', 'SELECT, USAGE'),
    })
    expect(l).toContain('REVOKE SELECT, USAGE ON ALL SEQUENCES IN SCHEMA mio FROM drift_readonly;')
    expect(l.some(x => x.startsWith('REVOKE SELECT, USAGE ON SEQUENCE mio.s FROM PUBLIC;'))).toBe(true)
    expect(l.some(x => x.startsWith('ALTER SEQUENCE mio.s OWNER TO'))).toBe(true)
    expect(l.some(x => x.startsWith('REVOKE authenticated FROM drift_readonly;'))).toBe(true)
  })

  it('sin secuencias alcanzables no dice nada', () => {
    expect(juzgarCredencial(sana).map(r => r.regla)).not.toContain('SECUENCIA')
  })

  // Las secuencias NO entran en la tolerancia de pg_stat_statements: esa lista
  // es de lecturas de tabla, y de dos objetos concretos.
  it('una secuencia nunca se tolera, aunque venga sólo de PUBLIC', () => {
    expect(juzgarCredencial({
      ...sana, secuencias: S('extensions.s', 'extensions', 'PUBLIC', 'SELECT'),
    }).map(r => r.regla)).toContain('SECUENCIA')
  })
})

// ── Privilegios de tabla: los detectados, y sólo ésos ───────────────────────
//
// El cuarto campo de una tabla «escribible» trae los privilegios que NO son
// SELECT y que efectivamente tiene: INSERT, UPDATE, DELETE, TRUNCATE,
// REFERENCES, TRIGGER y —desde Postgres 17— MAINTAIN. El REVOKE nombra ésos:
// un `REVOKE ALL` revocaría de más, y uno fijo revocaría de menos.

describe('juzgarCredencial · privilegios de tabla detectados', () => {
  const lineas = (m, regla = 'ESCRITURA') =>
    juzgarCredencial(m).find(x => x.regla === regla).remedio.split('\n').map(l => l.trim())

  it('revoca exactamente los privilegios detectados, no un ALL', () => {
    const l = lineas({ ...sana, escribibles: T('mio.t', 'mio', 'drift_readonly', 'TRIGGER') })
    expect(l).toContain('REVOKE TRIGGER ON ALL TABLES IN SCHEMA mio FROM drift_readonly;')
    expect(l.some(x => /ALL PRIVILEGES/.test(x))).toBe(false)
  })

  it('REFERENCES y TRIGGER cuentan, aunque no sean escritura de filas', () => {
    const r = juzgarCredencial({
      ...sana, escribibles: T('mio.t', 'mio', 'PUBLIC', 'REFERENCES, TRIGGER'),
    })[0]
    expect(r.detalle).toContain('mio.t [REFERENCES, TRIGGER, vía PUBLIC]')
    expect(r.remedio).toContain('REVOKE REFERENCES, TRIGGER ON mio.t FROM PUBLIC;')
  })

  // MAINTAIN existe desde Postgres 17 y el runner corre 16, así que la mitad
  // que toca la base se declara omitida allá; ésta la cubre entera.
  it('MAINTAIN (Postgres 17) se nombra y se revoca como cualquier otro', () => {
    const l = lineas({
      ...sana, escribibles: T('mio.t', 'mio', 'drift_readonly', 'INSERT, MAINTAIN'),
    })
    expect(l).toContain('REVOKE INSERT, MAINTAIN ON ALL TABLES IN SCHEMA mio FROM drift_readonly;')
  })

  it('de PUBLIC, con MAINTAIN, revoca a PUBLIC y no al auditor', () => {
    const l = lineas({ ...sana, escribibles: T('mio.t', 'mio', 'PUBLIC', 'MAINTAIN') })
    expect(l.some(x => x.startsWith('REVOKE MAINTAIN ON mio.t FROM PUBLIC;'))).toBe(true)
    expect(l.some(x => /FROM drift_readonly;/.test(x))).toBe(false)
  })

  // Dos tablas del mismo esquema con privilegios distintos necesitan dos
  // REVOKE distintos: usar los de la primera revoca de más en una y de menos
  // en la otra.
  it('agrupa por (privilegios, esquema), no sólo por esquema', () => {
    const l = lineas({
      ...sana,
      escribibles: [T('mio.a', 'mio', 'drift_readonly', 'INSERT'),
                    T('mio.b', 'mio', 'drift_readonly', 'UPDATE, DELETE')].join('\x1e'),
    })
    expect(l).toContain('REVOKE INSERT ON ALL TABLES IN SCHEMA mio FROM drift_readonly;')
    expect(l).toContain('REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA mio FROM drift_readonly;')
  })
})

describe('juzgarCredencial · privilegios por columna', () => {
  const C = (nombre, esquema, via, privCols) => T(nombre, esquema, via, privCols)
  const lineas = (m) =>
    juzgarCredencial(m).find(x => x.regla === 'PRIVILEGIO POR COLUMNA')
      .remedio.split('\n').map(l => l.trim())

  for (const [priv, cols] of [['SELECT', '(email)'], ['INSERT', '(id, nombre)'],
                              ['UPDATE', '(saldo)'], ['REFERENCES', '(id)']]) {
    it(`${priv} por columna: el remedio se puede pegar tal cual`, () => {
      const l = lineas({ ...sana, columnas: C('mio.t', 'mio', 'drift_readonly', `${priv} ${cols}`) })
      expect(l).toContain(`REVOKE ${priv} ${cols} ON mio.t FROM drift_readonly;`)
    })
  }

  it('de PUBLIC: revoca a PUBLIC, con las columnas, y no al auditor', () => {
    const l = lineas({ ...sana, columnas: C('mio.t', 'mio', 'PUBLIC', 'UPDATE (saldo)') })
    expect(l.some(x => x.startsWith('REVOKE UPDATE (saldo) ON mio.t FROM PUBLIC;'))).toBe(true)
    expect(l.some(x => /FROM drift_readonly;/.test(x))).toBe(false)
  })

  it('varios privilegios sobre la misma tabla salen como líneas distintas', () => {
    const l = lineas({
      ...sana,
      columnas: [C('mio.t', 'mio', 'drift_readonly', 'INSERT (a)'),
                 C('mio.t', 'mio', 'drift_readonly', 'UPDATE (b)')].join('\x1e'),
    })
    expect(l).toContain('REVOKE INSERT (a) ON mio.t FROM drift_readonly;')
    expect(l).toContain('REVOKE UPDATE (b) ON mio.t FROM drift_readonly;')
  })

  it('nunca usa `ON ALL TABLES`, que no revoca un grant por columna', () => {
    const l = lineas({ ...sana, columnas: C('mio.t', 'mio', 'drift_readonly', 'SELECT (email)') })
    expect(l.some(x => /ON ALL TABLES/.test(x))).toBe(false)
  })
})
describe('SQL_PRIVS_TABLA · la lista versionada de privilegios', () => {
  it('trae los siete que existen en toda versión soportada', () => {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                        'REFERENCES', 'TRIGGER']) {
      expect(SQL_PRIVS_TABLA).toContain(`'${priv}'`)
    }
  })

  it('condiciona MAINTAIN a server_version_num >= 170000, sin excepción', () => {
    expect(SQL_PRIVS_TABLA).toMatch(
      /CASE WHEN current_setting\('server_version_num'\)::int >= 170000\s+THEN ARRAY\['MAINTAIN'\]/)
    // MAINTAIN aparece UNA sola vez, y siempre dentro de esa rama: si alguien
    // lo agregara al array incondicional, esto rompe.
    expect(SQL_PRIVS_TABLA.match(/MAINTAIN/g)).toHaveLength(1)
    expect(SQL_PRIVS_TABLA.indexOf('MAINTAIN'))
      .toBeGreaterThan(SQL_PRIVS_TABLA.indexOf('170000'))
  })
})


// ── Objetos gestionados por el proveedor: se bloquean, no se remedian ───────
//
// Supabase Support confirmó que los grants de pg_net a PUBLIC son gestionados,
// intencionales y necesarios, que todo rol LOGIN propio los hereda, y que
// retirarlos NO es una remediación soportada. Proponer un REVOKE contra ellos
// sería dar por accionable algo que el proveedor declaró que no lo es — y en un
// proyecto gestionado ese REVOKE ni siquiera fallaría: saldría 0 sin revocar.
describe('juzgarCredencial · pg_net no lleva SQL, lleva un puntero', () => {
  const NET = {
    tabla: 'net._http_response',
    otra: 'net.http_request_queue',
    seq: 'net.http_request_queue_id_seq',
  }
  const conNet = {
    ...sana,
    escribibles: [T(NET.tabla, 'net', 'PUBLIC', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
                  T(NET.otra, 'net', 'PUBLIC', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')].join('\x1e'),
    leibles: [T(NET.tabla, 'net', 'PUBLIC'), T(NET.otra, 'net', 'PUBLIC')].join('\x1e'),
    secuencias: T(NET.seq, 'net', 'PUBLIC', 'SELECT, USAGE, UPDATE'),
  }
  const texto = () => juzgarCredencial(conNet).map(r => `${r.regla}: ${r.detalle}\n${r.remedio}`).join('\n')

  it('los tres objetos están declarados como sin remediación soportada', () => {
    expect([...SIN_REMEDIO_SOPORTADO].sort()).toEqual([NET.tabla, NET.otra, NET.seq].sort())
  })

  it('BLOQUEA por las tres reglas: detectarlos sigue siendo el trabajo', () => {
    expect(reglas(conNet)).toEqual(
      expect.arrayContaining(['ESCRITURA', 'SELECT DE TABLA', 'SECUENCIA']))
  })

  // LA REGRESIÓN QUE PIDE ESTE CAMBIO.
  it('NO emite ningún «REVOKE … net… FROM PUBLIC»', () => {
    expect(texto()).not.toMatch(/REVOKE[^\n]*\bnet\.[^\n]*FROM PUBLIC;/)
  })

  it('ni ningún otro REVOKE sobre esos objetos', () => {
    expect(texto()).not.toMatch(/REVOKE[^\n]*\bnet\./)
  })

  it('ni un ALTER que cambie su propiedad', () => {
    expect(texto()).not.toMatch(/ALTER (TABLE|SEQUENCE)[^\n]*\bnet\./)
  })

  it('dice que no hay remediación soportada y remite al registro de decisión', () => {
    expect(texto()).toContain('SIN REMEDIACIÓN SOPORTADA')
    expect(texto()).toContain('decision-net-pg_net.md')
    expect(AVISO_SIN_REMEDIO).toContain('decision-net-pg_net.md')
  })

  it('el motivo sí los nombra, con sus privilegios y su procedencia', () => {
    const r = juzgarCredencial(conNet).find(x => x.regla === 'ESCRITURA')
    expect(r.detalle).toContain(`${NET.tabla} [INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, vía PUBLIC]`)
  })

  // Y no se contagia: un objeto cualquiera del mismo esquema sí lleva remedio.
  it('un objeto NO gestionado sigue llevando su REVOKE', () => {
    const l = juzgarCredencial({ ...sana, leibles: T('net.otra_cosa', 'net', 'PUBLIC') })
      .find(x => x.regla === 'SELECT DE TABLA')
    expect(l.remedio).toContain('REVOKE SELECT ON net.otra_cosa FROM PUBLIC;')
  })
})


// ── Tripwire: ningún fixture toca los objetos gestionados ───────────────────
//
// La separación no es una convención: es la conclusión del registro de
// decisión. Los objetos de pg_net se NOMBRAN —para poder declararlos sin
// remediación soportada y para las entradas de texto de las pruebas puras— pero
// no se les ejecuta nada. Esta prueba lee el fuente del auditor y falla si
// aparece cualquier sentencia contra un nombre `net.*`.
describe('auditar.mjs · no ejecuta SQL contra objetos gestionados', () => {
  const fuente = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'auditar.mjs'), 'utf8')

  const VERBOS = ['CREATE TABLE', 'CREATE SCHEMA', 'DROP TABLE', 'DROP SCHEMA',
                  'GRANT', 'REVOKE', 'ALTER TABLE', 'ALTER SEQUENCE', 'TRUNCATE']

  for (const verbo of VERBOS) {
    it(`no hay ningún «${verbo} … net.…» en el fuente`, () => {
      // Se mira la sentencia entera: el verbo y, en la misma sentencia, un
      // nombre cualificado con el esquema `net`.
      const re = new RegExp(`\\b${verbo}\\b[^;\\n]*\\bnet\\.[a-z_]`, 'i')
      expect(fuente).not.toMatch(re)
    })
  }

  it('los nombres de pg_net sólo aparecen como DATOS o en prosa', () => {
    const lineas = fuente.split('\n').filter(l => /\bnet\.[a-z_]/.test(l))
    expect(lineas.length).toBeGreaterThan(0)   // se siguen declarando
    for (const l of lineas) {
      const esDato = /^\s*'net\.[a-z_]+',?\s*$/.test(l)          // SIN_REMEDIO_SOPORTADO
      const esProsa = /^\s*(\/\/|\*|\s*\*)/.test(l) || /decision-net-pg_net/.test(l)
      expect(esDato || esProsa).toBe(true)
    }
  })
})

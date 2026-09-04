// Las piezas puras del modo live.
//
// Lo que toca la red se prueba en `auditar.mjs --prueba-live`, contra un
// clúster desechable que hace de producción. Aquí va lo que puede tener bugs
// sin necesidad de una base: el recorte de secretos, la deducción del proyecto
// y —sobre todo— los guards que deciden si una huella recién leída se versiona
// o se rechaza.
//
// Esos guards son la última defensa antes de escribir. Un refresco incompleto
// no rompe nada: queda versionado como verdad, y a partir de ahí el auditor
// deja de ver el drift que esos grupos taparían.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  sinSecretos, refDeUrl, validarHuellaLive, diffHuellas,
  juzgarCredencial, SECDEF_PERMITIDAS, validarUrlLive, tipoDeHost,
  avisarCredencial, clasificarLectura, LECTURA_TOLERADA,
  SQL_PRIVS_TABLA, SQL_NET_PRECONDICION, SQL_NET_POSTCONDICION, SQL_NET_LOTE,
  NET_OBJETOS, NET_TABLAS, NET_SECUENCIA,
} from '../auditar.mjs'

const H = (n = 1) => ({ huella: 'a'.repeat(64), n })
const mapa = (pares) => new Map(pares)

describe('sinSecretos', () => {
  it('borra la URL completa', () => {
    const url = 'postgresql://lector:clave@db.abc.supabase.co:5432/postgres'
    expect(sinSecretos(`no se pudo conectar a ${url}`, url)).not.toContain('db.abc.supabase.co')
  })

  it('borra la contraseña aunque el mensaje traiga la URL troceada', () => {
    const url = 'postgresql://lector:s3creto@host:5432/postgres'
    expect(sinSecretos('password authentication failed for user (s3creto)', url)).not.toContain('s3creto')
  })

  it('borra una URL suelta que nadie le pasó', () => {
    // libpq reescribe la cadena en algunos errores; el recorte no puede
    // depender de que coincida carácter por carácter con la que se le dio.
    expect(sinSecretos('fallo en postgres://otro:x@host/db mientras leía')).not.toContain('otro')
  })

  it('deja intacto un texto sin secretos', () => {
    expect(sinSecretos('permission denied for schema public')).toBe('permission denied for schema public')
  })
})

describe('refDeUrl', () => {
  it('saca el ref de una conexión directa', () => {
    expect(refDeUrl('postgresql://u:p@db.nnsqmeigtgewatameexo.supabase.co:5432/postgres'))
      .toBe('nnsqmeigtgewatameexo')
  })

  it('saca el ref del usuario en una URL de pooler', () => {
    expect(refDeUrl('postgresql://postgres.nnsqmeigtgewatameexo:p@aws-0-us-east-2.pooler.supabase.com:6543/postgres'))
      .toBe('nnsqmeigtgewatameexo')
  })

  // La credencial de este auditor es un rol DEDICADO, así que su usuario en el
  // pooler no es `postgres.<ref>` sino `drift_readonly.<ref>`. Reconocer sólo
  // `postgres` dejaba sin deducir justo la URL que se va a usar en producción,
  // y el modo live se niega a correr cuando no puede deducir el proyecto.
  it('también con un rol dedicado, no sólo con `postgres`', () => {
    expect(refDeUrl('postgresql://drift_readonly.nnsqmeigtgewatameexo:p@aws-0-us-east-2.pooler.supabase.com:5432/postgres'))
      .toBe('nnsqmeigtgewatameexo')
  })

  it('y con el rol codificado en la URL', () => {
    expect(refDeUrl('postgresql://drift%5Freadonly.nnsqmeigtgewatameexo:p@aws-0-us-east-2.pooler.supabase.com:5432/postgres'))
      .toBe('nnsqmeigtgewatameexo')
  })

  it('no confunde un host que no es de Supabase', () => {
    // El sufijo con forma de ref no alcanza: el host tiene que ser de Supabase.
    expect(refDeUrl('postgresql://drift_readonly.nnsqmeigtgewatameexo:p@pooler.ejemplo.com:5432/postgres'))
      .toBeNull()
  })

  it('devuelve null cuando no se puede saber, en vez de adivinar', () => {
    // Adivinar aquí significaría versionar el sandbox como si fuera producción.
    expect(refDeUrl('postgresql://lector@/postgres?host=/tmp/sock&port=5432')).toBeNull()
    expect(refDeUrl('postgresql://u@localhost:5432/postgres')).toBeNull()
    expect(refDeUrl('no es una url')).toBeNull()
  })
})

describe('validarHuellaLive', () => {
  const sana = mapa([
    ['tabla:a/columnas', H(3)],
    ['tabla:a/grants', H(7)],
    ['tabla:b/grants', H(7)],
  ])

  it('acepta una huella sana', () => {
    expect(validarHuellaLive(sana)).toEqual([])
  })

  it('rechaza una huella vacía', () => {
    expect(validarHuellaLive(new Map())[0]).toMatch(/vacía/)
  })

  it('rechaza un valor que no sea SHA-256 de 64 hex', () => {
    const corta = mapa([['tabla:a/grants', { huella: 'abc', n: 1 }]])
    expect(validarHuellaLive(corta).some(p => /SHA-256/.test(p))).toBe(true)
  })

  // EL CASO QUE MOTIVA TODO ESTO. `information_schema.role_table_grants` es
  // relativo al rol: con la credencial de solo lectura devolvía CERO filas y
  // la huella salía con la cadena vacía en todo /grants sin que nada fallara.
  it('rechaza una huella con TODOS los /grants vacíos', () => {
    const sinGrants = mapa([
      ['tabla:a/columnas', H(3)],
      ['tabla:a/grants', H(0)],
      ['tabla:b/grants', H(0)],
    ])
    expect(validarHuellaLive(sinGrants).some(p => /VAC/i.test(p))).toBe(true)
  })

  it('acepta que ALGUNOS /grants estén vacíos: una tabla sin conceder es normal', () => {
    const parcial = mapa([['tabla:a/grants', H(0)], ['tabla:b/grants', H(7)]])
    expect(validarHuellaLive(parcial)).toEqual([])
  })

  it('rechaza si no hay ninguna dimensión /grants', () => {
    const nada = mapa([['tabla:a/columnas', H(3)]])
    expect(validarHuellaLive(nada).some(p => /grants/.test(p))).toBe(true)
  })

  it('rechaza un cambio de tamaño desmedido respecto de lo versionado', () => {
    // Leer otra base es la explicación más probable de que el catálogo se
    // reduzca a la mitad, y no es algo que deba escribirse solo.
    const previo = mapa(Array.from({ length: 100 }, (_, i) => [`tabla:t${i}/grants`, H(7)]))
    const problemas = validarHuellaLive(sana, previo)
    expect(problemas.some(p => /grupos pasó de 100 a 3/.test(p))).toBe(true)
  })

  it('deja pasar un cambio de tamaño dentro de la tolerancia', () => {
    const previo = mapa([...sana, ['tabla:c/grants', H(7)]])
    expect(validarHuellaLive(sana, previo, { tolerancia: 0.5 })).toEqual([])
  })
})

describe('diffHuellas', () => {
  it('separa agregados, eliminados y cambiados', () => {
    const previo = mapa([['a', H(1)], ['b', H(1)], ['c', H(1)]])
    const nuevo = mapa([['a', H(1)], ['b', { huella: 'b'.repeat(64), n: 1 }], ['d', H(1)]])
    const d = diffHuellas(previo, nuevo)
    expect(d.agregados).toEqual(['d'])
    expect(d.eliminados).toEqual(['c'])
    expect(d.cambiados.map(x => x.clave)).toEqual(['b'])
  })

  it('un conteo distinto con la misma huella también es un cambio', () => {
    // `n` es parte de la medición: 26 grants y 28 grants no son lo mismo
    // aunque, por imposible que sea, el hash coincidiera.
    const d = diffHuellas(mapa([['a', H(1)]]), mapa([['a', H(2)]]))
    expect(d.cambiados).toHaveLength(1)
  })

  it('no reporta nada cuando son iguales', () => {
    const m = mapa([['a', H(1)]])
    expect(diffHuellas(m, m)).toEqual({ agregados: [], eliminados: [], cambiados: [] })
  })
})

describe('refDeUrl · hosts impostores', () => {
  // El ref es lo ÚNICO que impide que un refresco lea otra base y la versione
  // como si fuera producción. Una comprobación laxa —«el host contiene
  // supabase»— acepta cualquiera de estos, y todos son registrables por
  // cualquiera. Por eso la comprobación es una lista blanca de dos formas.
  const impostores = [
    'postgresql://postgres.nnsqmeigtgewatameexo:p@pooler.supabase.com.atacante.net:5432/postgres',
    'postgresql://postgres.nnsqmeigtgewatameexo:p@aws-0-us-east-2.pooler.supabase.com.evil.io:5432/postgres',
    'postgresql://postgres.nnsqmeigtgewatameexo:p@supabase.ejemplo.com:5432/postgres',
    'postgresql://postgres.nnsqmeigtgewatameexo:p@pooler-supabase.com:5432/postgres',
    'postgresql://postgres.nnsqmeigtgewatameexo:p@mipooler.supabase.com:5432/postgres',
    'postgresql://u:p@db.nnsqmeigtgewatameexo.supabase.co.atacante.net:5432/postgres',
    'postgresql://u:p@db.nnsqmeigtgewatameexo.supabase.com:5432/postgres',
    'postgresql://u:p@notdb.nnsqmeigtgewatameexo.supabase.co:5432/postgres',
    'postgresql://u:p@db.nnsqmeigtgewatameexo.supabase.co.evil:5432/postgres',
  ]
  for (const url of impostores) {
    it(`rechaza ${new URL(url).hostname}`, () => expect(refDeUrl(url)).toBeNull())
  }

  it('acepta el host oficial del pooler, con la etiqueta de región delante', () => {
    expect(refDeUrl('postgresql://d.nnsqmeigtgewatameexo:p@aws-1-us-east-2.pooler.supabase.com:5432/x'))
      .toBe('nnsqmeigtgewatameexo')
  })

  it('no acepta `pooler.supabase.com` pelado: la forma oficial lleva región', () => {
    expect(refDeUrl('postgresql://d.nnsqmeigtgewatameexo:p@pooler.supabase.com:5432/x')).toBeNull()
  })
})

describe('refDeUrl · refs que no tienen forma de ref', () => {
  // Un ref de Supabase son 20 caracteres alfanuméricos. Deducir uno de otra
  // longitud sería inventar un proyecto, y con él la autorización para escribir
  // la instantánea.
  const casos = [
    ['19 caracteres, host directo', 'postgresql://u:p@db.nnsqmeigtgewatameex.supabase.co:5432/x'],
    ['21 caracteres, host directo', 'postgresql://u:p@db.nnsqmeigtgewatameexoo.supabase.co:5432/x'],
    ['con guion, host directo',     'postgresql://u:p@db.nnsqmeigt-gewatameexo.supabase.co:5432/x'],
    ['usuario sin punto',           'postgresql://postgres:p@aws-0-us-east-2.pooler.supabase.com:5432/x'],
    ['ref corto en el usuario',     'postgresql://postgres.corto:p@aws-0-us-east-2.pooler.supabase.com:5432/x'],
    ['sin usuario',                 'postgresql://:p@aws-0-us-east-2.pooler.supabase.com:5432/x'],
  ]
  for (const [nombre, url] of casos) {
    it(`no deduce nada con ${nombre}`, () => expect(refDeUrl(url)).toBeNull())
  }
})

// ── El veredicto sobre la credencial, regla por regla ───────────────────────
//
// El camino de punta a punta —rol real, conexión por URL, un rol por
// privilegio— se prueba en `auditar.mjs --prueba-live`. Acá se prueba la
// DECISIÓN, que es donde vivió el bug que importaba: la primera versión
// comparaba `=== 't'` contra un SQL que devolvía 'true', así que los controles
// de superusuario, BYPASSRLS, CREATEROLE y CREATEDB no rechazaban nada. Un
// guard roto de esa forma no rompe ninguna prueba: falla ABIERTO y calla.

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

// ── La cadena de conexión ───────────────────────────────────────────────────
//
// La lista blanca del hostname NO alcanza. libpq acepta parámetros en la URI y
// varios mandan sobre el destino: con `hostaddr` se conecta a esa IP y usa
// `host` sólo para el certificado, así que una URL con un host oficial habla
// con otra máquina. `options=` deshace por URL el read-only que `PGOPTIONS`
// fija por entorno. Por eso la lista blanca es de PARÁMETROS.

const DIRECTA = 'postgresql://drift_readonly:s3creto@db.nnsqmeigtgewatameexo.supabase.co:5432/postgres'
const POOLER = 'postgresql://drift_readonly.nnsqmeigtgewatameexo:s3creto@aws-1-us-east-2.pooler.supabase.com:5432/postgres'
const problemas = (url) => validarUrlLive(url).problemas

describe('validarUrlLive · lo que se acepta', () => {
  it('la conexión directa con sslmode=require', () => {
    expect(problemas(`${DIRECTA}?sslmode=require`)).toEqual([])
  })

  it('el Session Pooler con sslmode=require', () => {
    expect(problemas(`${POOLER}?sslmode=require`)).toEqual([])
  })

  it('verify-full con su sslrootcert, sin un solo aviso', () => {
    const r = validarUrlLive(`${DIRECTA}?sslmode=verify-full&sslrootcert=/etc/ssl/supabase.crt`)
    expect(r.problemas).toEqual([])
    expect(r.avisos).toEqual([])
  })

  it('y los parámetros documentados que no cambian el destino', () => {
    expect(problemas(`${POOLER}?sslmode=require&connect_timeout=15&application_name=drift`)).toEqual([])
  })

  // El socket de dominio Unix no puede alcanzar otra máquina: es lo que usa
  // `--prueba-live` contra su clúster desechable, y no es un bypass — que eso
  // no termine versionado como producción lo cuida el guard del proyecto.
  it('un socket local, que no puede salir de la máquina', () => {
    expect(problemas('postgresql://drift_lector@/postgres?host=/tmp/live-x&port=55432')).toEqual([])
  })
})

describe('validarUrlLive · redirección del destino', () => {
  it('rechaza hostaddr: libpq se conecta a ESA IP y el host queda de fachada', () => {
    const p = problemas(`${DIRECTA}?sslmode=require&hostaddr=203.0.113.9`)
    expect(p.some(x => /hostaddr/.test(x))).toBe(true)
  })

  it('rechaza host= en la query, aunque el hostname sea oficial', () => {
    expect(problemas(`${DIRECTA}?sslmode=require&host=otro-host.ejemplo.com`)
      .some(x => /«host»/.test(x))).toBe(true)
  })

  it('rechaza una lista de varios hosts', () => {
    expect(problemas('postgresql://u:p@aws-1-us-east-2.pooler.supabase.com:5432,evil.example:5432/postgres?sslmode=require')
      .some(x => /VARIOS hosts/.test(x))).toBe(true)
  })

  it('rechaza un host que no es oficial', () => {
    expect(problemas('postgresql://u:p@pooler.supabase.com.atacante.net:5432/postgres?sslmode=require')
      .some(x => /no es ninguno de los dos oficiales/.test(x))).toBe(true)
  })

  for (const clave of ['port', 'dbname', 'user', 'password', 'service', 'servicefile', 'options']) {
    it(`rechaza «${clave}», que cambia a qué base o con qué identidad se conecta`, () => {
      expect(problemas(`${DIRECTA}?sslmode=require&${clave}=x`)
        .some(x => x.includes(`«${clave}»`))).toBe(true)
    })
  }

  it('rechaza un parámetro que no esté documentado', () => {
    expect(problemas(`${DIRECTA}?sslmode=require&target_session_attrs=any`)
      .some(x => /no está en la lista documentada/.test(x))).toBe(true)
  })

  // libpq se queda con el ÚLTIMO valor, así que `verify-full&…=disable` se lee
  // seguro y se conecta inseguro. Un duplicado nunca es un descuido inocuo.
  it('rechaza parámetros repetidos', () => {
    expect(problemas(`${DIRECTA}?sslmode=verify-full&sslmode=disable`)
      .some(x => /repetido/.test(x))).toBe(true)
  })
})

describe('validarUrlLive · TLS', () => {
  it('rechaza la conexión sin sslmode', () => {
    expect(problemas(DIRECTA).some(x => /falta «sslmode»/.test(x))).toBe(true)
  })

  for (const modo of ['disable', 'allow', 'prefer']) {
    it(`rechaza sslmode=${modo}, que deja caer la conexión a texto plano`, () => {
      expect(problemas(`${DIRECTA}?sslmode=${modo}`).some(x => x.includes(`sslmode=${modo}`))).toBe(true)
    })
  }

  it('acepta verify-ca y verify-full', () => {
    for (const modo of ['verify-ca', 'verify-full']) {
      expect(problemas(`${DIRECTA}?sslmode=${modo}&sslrootcert=/etc/ssl/supabase.crt`)).toEqual([])
    }
  })

  // `require` cifra pero no verifica el certificado: protege del que escucha,
  // no del que se hace pasar por la base. Se acepta, y se recomienda subir.
  it('con require acepta y recomienda verify-full', () => {
    const r = validarUrlLive(`${DIRECTA}?sslmode=require`)
    expect(r.problemas).toEqual([])
    expect(r.avisos.some(a => /verify-full/.test(a))).toBe(true)
  })

  it('con verify-full sin sslrootcert acepta y avisa', () => {
    const r = validarUrlLive(`${DIRECTA}?sslmode=verify-full`)
    expect(r.problemas).toEqual([])
    expect(r.avisos.some(a => /sslrootcert/.test(a))).toBe(true)
  })
})

describe('validarUrlLive · lo que nunca puede salir en un mensaje', () => {
  // Estos textos van al log de Actions. Un host se puede nombrar; una
  // contraseña, jamás.
  it('ningún mensaje contiene la contraseña', () => {
    const sucias = [
      DIRECTA, `${DIRECTA}?sslmode=disable`, `${DIRECTA}?sslmode=require&hostaddr=203.0.113.9`,
      `${POOLER}?sslmode=require&options=-c%20x`, `${POOLER}?sslmode=a&sslmode=b`,
    ]
    for (const url of sucias) {
      const r = validarUrlLive(url)
      for (const linea of [...r.problemas, ...r.avisos]) expect(linea).not.toContain('s3creto')
    }
  })

  it('lo que no es una cadena de Postgres se rechaza sin más', () => {
    expect(problemas('https://db.nnsqmeigtgewatameexo.supabase.co').length).toBe(1)
    expect(problemas('').length).toBe(1)
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

describe('validarUrlLive · la base viaja en el path, no en un parámetro', () => {
  // Rechazar `?dbname=` no alcanza: en una URI normal el nombre de la base ES
  // el path. `…/otra_base` cambia qué se mide sin tocar un solo parámetro, y un
  // refresco que midiera otra base la versionaría como si fuera producción.
  it('acepta /postgres en la conexión directa', () => {
    expect(problemas(`${DIRECTA}?sslmode=require`)).toEqual([])
  })

  it('acepta /postgres en el Session Pooler', () => {
    expect(problemas(`${POOLER}?sslmode=require`)).toEqual([])
  })

  const sinPath = 'postgresql://drift_readonly:s3creto@db.nnsqmeigtgewatameexo.supabase.co:5432'
  const casos = [
    ['otra base', `${sinPath}/otra_base?sslmode=require`, /se espera exactamente/],
    ['base vacía', `${sinPath}/?sslmode=require`, /no declara base/],
    ['sin path', `${sinPath}?sslmode=require`, /no declara base/],
    ['segmento de más', `${sinPath}/postgres/extra?sslmode=require`, /se espera exactamente/],
    ['barra final', `${sinPath}/postgres/?sslmode=require`, /se espera exactamente/],
    // `%70ostgres` decodifica a `postgres` y libpq lo acepta. Un secreto
    // legítimo no se escribe así: aceptarlo sólo daría formas de esconder algo
    // a la vista, y la comparación es en crudo por eso.
    ['path codificado', `${sinPath}/%70ostgres?sslmode=require`, /escapes %xx/],
  ]
  for (const [nombre, url, patron] of casos) {
    it(`rechaza ${nombre}`, () => expect(problemas(url).some(x => patron.test(x))).toBe(true))
  }
})

describe('validarUrlLive · el puerto es parte del destino', () => {
  const conPuerto = (p) =>
    `postgresql://drift_readonly.nnsqmeigtgewatameexo:s3creto@aws-1-us-east-2.pooler.supabase.com:${p}/postgres?sslmode=require`

  it('acepta 5432, que es el modo sesión', () => {
    expect(problemas(conPuerto(5432))).toEqual([])
  })

  // 6543 es el modo TRANSACCIÓN del pooler, y ahí `PGOPTIONS` no rige: el guard
  // de solo lectura se caería sin que nada avise. Por eso no se soporta.
  it('rechaza 6543: en modo transacción PGOPTIONS no rige', () => {
    expect(problemas(conPuerto(6543)).some(x => /modo SESIÓN/.test(x))).toBe(true)
  })

  it('rechaza un puerto arbitrario', () => {
    expect(problemas(conPuerto(31337)).some(x => /no está soportado/.test(x))).toBe(true)
  })

  it('rechaza un puerto que no es un número', () => {
    expect(problemas(conPuerto('54a32')).some(x => /no es un número/.test(x))).toBe(true)
  })

  it('exige el puerto explícito, no el implícito de libpq', () => {
    expect(problemas('postgresql://u:p@db.nnsqmeigtgewatameexo.supabase.co/postgres?sslmode=require')
      .some(x => /no declara puerto/.test(x))).toBe(true)
  })

  // El puerto no puede descartarse al sacar el hostname: es parte del destino.
  it('el host se reconoce igual con puerto', () => {
    expect(tipoDeHost('db.nnsqmeigtgewatameexo.supabase.co')).toBe('directo')
    expect(tipoDeHost('aws-1-us-east-2.pooler.supabase.com')).toBe('pooler')
    expect(tipoDeHost('pooler.supabase.com.atacante.net')).toBeNull()
  })
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

  it('tolera pg_stat_statements cuando es de una extensión y viene sólo de PUBLIC', () => {
    const { bloquean, tolerados } = clasificarLectura([
      item('extensions.pg_stat_statements', 'PUBLIC', 'ext'),
      item('extensions.pg_stat_statements_info', 'PUBLIC', 'ext'),
    ])
    expect(bloquean).toEqual([])
    expect(tolerados).toHaveLength(2)
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

  it('la lista es exactamente esas dos, y cada una trae su justificación', () => {
    expect([...LECTURA_TOLERADA.keys()].sort()).toEqual([
      'extensions.pg_stat_statements', 'extensions.pg_stat_statements_info',
    ])
    for (const razon of LECTURA_TOLERADA.values()) expect(razon.length).toBeGreaterThan(80)
  })
})

describe('avisarCredencial · lo tolerado se dice en voz alta', () => {
  const conStat = {
    ...sana,
    leibles: T('extensions.pg_stat_statements', 'extensions', 'PUBLIC', 'ext'),
  }

  it('no bloquea', () => {
    expect(juzgarCredencial(conStat)).toEqual([])
  })

  // Un guard que tolera algo en silencio deja de ser un guard: a los tres meses
  // nadie recuerda qué está tolerado ni por qué.
  it('pero lo nombra, con su procedencia y su justificación', () => {
    const [aviso] = avisarCredencial(conStat)
    expect(aviso).toContain('extensions.pg_stat_statements [vía PUBLIC]')
    expect(aviso).toContain('pg_stat_statements')
    expect(aviso).toContain('REVOKE SELECT ON extensions.pg_stat_statements FROM PUBLIC;')
    expect(aviso).toContain('decisión de política')
  })

  it('y no avisa de lo que sí bloquea', () => {
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

// ── La propuesta de `net` y el código no se pueden separar ─────────────────
//
// Los dos bloques SQL que la propuesta le pide a quien opere la base son los
// MISMOS que `--prueba-live` ejecuta contra un clúster real. Si alguien edita
// uno de los dos lados, esto rompe: un documento que dice una cosa y una prueba
// que verifica otra es peor que no tener ninguno de los dos.
describe('propuesta-net-publico.md · el documento y lo probado son lo mismo', () => {
  const doc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'propuesta-net-publico.md'), 'utf8')

  it('trae el LOTE COMPLETO textualmente, el mismo que corre la prueba', () => {
    expect(doc).toContain(SQL_NET_LOTE.trim())
  })

  it('y con él, la precondición y la postcondición', () => {
    expect(doc).toContain(SQL_NET_PRECONDICION)
    expect(doc).toContain(SQL_NET_POSTCONDICION)
  })

  it('sigue marcada como NO APLICADA y no aplicable como migración normal', () => {
    expect(doc).toMatch(/NO APLICADA, y NO aplicable como una migración normal/)
  })

  it('exige que Supabase Support mande el lote como UNA SOLA transacción', () => {
    expect(doc).toMatch(/Supabase Support tiene que ejecutar el lote completo como una única\s+transacción/)
    expect(doc).toMatch(/No dividido en partes/)
  })

  it('exige ON_ERROR_STOP y explica por qué', () => {
    expect(doc).toContain('ON_ERROR_STOP')
    expect(doc).toMatch(/sale 0/)
  })

  it('dice que hace falta autoridad del propietario, vía Supabase Support', () => {
    expect(doc).toMatch(/Supabase Support/)
    expect(doc).toMatch(/no es superusuario/)
    expect(doc).toMatch(/no es miembro de .?`?supabase_admin/)
  })

  it('advierte que el REVOKE sin autoridad SALE 0 en vez de fallar', () => {
    expect(doc).toMatch(/no privileges could be revoked/)
  })

  it('declara que WITH GRANT OPTION NO es autoridad suficiente', () => {
    expect(doc).toMatch(/`WITH GRANT OPTION` \*\*no cuenta\*\*/)
    expect(doc).toMatch(/no alcanza el grant que hizo otro otorgante/)
  })

  it('prohíbe los cuatro atajos, por nombre', () => {
    for (const atajo of ['SET ROLE supabase_admin', 'OWNER TO postgres',
                         'SECURITY DEFINER', 'ALTER EXTENSION pg_net']) {
      expect(doc).toContain(atajo)
    }
  })

  it('enumera los OCHO privilegios de tabla', () => {
    expect(doc).toMatch(/los \*\*ocho\*\* privilegios de tabla/)
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                        'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(doc).toContain(priv)
    }
  })

  it('usa la secuencia real y nunca inventa una para _http_response', () => {
    expect(doc).toContain(NET_SECUENCIA)
    expect(doc).not.toContain('_http_response_id_seq')
  })
})

// ── El LOTE: una transacción, tres objetos, cero placeholders ─────────────
describe('SQL_NET_LOTE · la plantilla ejecutable', () => {
  it('abre con BEGIN y cierra con COMMIT', () => {
    const sentencias = SQL_NET_LOTE.split('\n').map(l => l.trim()).filter(Boolean)
    expect(sentencias.filter(l => l === 'BEGIN;')).toHaveLength(1)
    expect(sentencias.filter(l => l === 'COMMIT;')).toHaveLength(1)
    expect(sentencias.indexOf('BEGIN;')).toBeLessThan(sentencias.indexOf('COMMIT;'))
  })

  it('lleva la precondición ANTES de cualquier REVOKE', () => {
    expect(SQL_NET_LOTE.indexOf(SQL_NET_PRECONDICION))
      .toBeLessThan(SQL_NET_LOTE.indexOf('REVOKE ALL PRIVILEGES'))
  })

  it('y la postcondición DESPUÉS del último REVOKE, antes del COMMIT', () => {
    const post = SQL_NET_LOTE.indexOf(SQL_NET_POSTCONDICION)
    expect(post).toBeGreaterThan(SQL_NET_LOTE.lastIndexOf('REVOKE ALL PRIVILEGES'))
    expect(post).toBeLessThan(SQL_NET_LOTE.lastIndexOf('COMMIT;'))
  })

  it('revoca sobre los tres objetos y sobre ningún otro', () => {
    for (const t of NET_TABLAS) expect(SQL_NET_LOTE).toContain(t)
    expect(SQL_NET_LOTE).toContain(`ON SEQUENCE ${NET_SECUENCIA} FROM PUBLIC`)
    // La secuencia va por ON SEQUENCE, nunca colada en el ON TABLE.
    const onTable = SQL_NET_LOTE.slice(SQL_NET_LOTE.indexOf('ON TABLE'),
                                       SQL_NET_LOTE.indexOf('FROM PUBLIC'))
    expect(onTable).not.toContain(NET_SECUENCIA)
  })

  it('no lleva NINGÚN placeholder sin sustituir', () => {
    expect(SQL_NET_LOTE).not.toMatch(/<[a-zA-ZñáéíóúÁÉÍÓÚ][^>\n]*>/)
  })

  it('no toca el USAGE del esquema, que la propuesta conserva a propósito', () => {
    expect(SQL_NET_LOTE).not.toMatch(/REVOKE[^;]*ON SCHEMA net/)
  })

  it('no contiene ninguno de los atajos prohibidos', () => {
    for (const atajo of ['SET ROLE', 'OWNER TO', 'SECURITY DEFINER', 'ALTER EXTENSION']) {
      expect(SQL_NET_LOTE).not.toContain(atajo)
    }
  })
})

// ── Autoridad: tres formas, y el grant option no es una ───────────────────
describe('SQL_NET_PRECONDICION · qué cuenta como autoridad', () => {
  it('enumera EXACTAMENTE los tres objetos', () => {
    for (const o of NET_OBJETOS) expect(SQL_NET_PRECONDICION).toContain(`'${o}'`)
    expect(NET_OBJETOS).toHaveLength(3)
  })

  it('valida la forma: dos tablas (relkind r) y una secuencia (relkind S)', () => {
    expect(SQL_NET_PRECONDICION).toMatch(/relkind <> 'r'/)
    expect(SQL_NET_PRECONDICION).toMatch(/relkind <> 'S'/)
  })

  it('aborta si falta alguno de los tres', () => {
    expect(SQL_NET_PRECONDICION).toMatch(/ausentes IS NOT NULL/)
    expect(SQL_NET_PRECONDICION).toMatch(/PRECONDICIÓN FALLIDA: falta\(n\)/)
  })

  it('acepta sólo superusuario, propietario o membresía', () => {
    expect(SQL_NET_PRECONDICION).toContain('IF NOT (soy_super OR r.duenio = yo OR r.soy_miembro) THEN')
  })

  it('NO usa el grant option para decidir: sólo lo informa', () => {
    // La única aparición de `gopt` en una condición sería un IF/AND; se exige
    // que no haya ninguna. Si alguien lo reintroduce como autoridad, rompe.
    expect(SQL_NET_PRECONDICION).not.toMatch(/OR\s+(r\.)?gopt/)
    expect(SQL_NET_PRECONDICION).not.toMatch(/OR\s+r\.con_grant_option/)
    expect(SQL_NET_PRECONDICION).toMatch(/informativo, NO es autoridad/)
  })

  it('inspecciona el OTORGANTE real de cada grant a PUBLIC', () => {
    expect(SQL_NET_PRECONDICION).toMatch(/pg_get_userbyid\(a\.grantor\)/)
    expect(SQL_NET_PRECONDICION).toMatch(/otorgantes_publico/)
  })

  it('mide la secuencia con has_sequence_privilege, nunca con has_table_privilege', () => {
    // La rama de relkind 'S' usa la función de secuencias…
    expect(SQL_NET_PRECONDICION).toMatch(
      /WHEN r\.relkind = 'S'\s+THEN \(SELECT bool_and\(has_sequence_privilege/)
    // …y has_table_privilege queda del otro lado del CASE, en el ELSE.
    const iSeq = SQL_NET_PRECONDICION.indexOf('has_sequence_privilege')
    const iTab = SQL_NET_PRECONDICION.indexOf('has_table_privilege')
    expect(iSeq).toBeGreaterThan(-1)
    expect(iTab).toBeGreaterThan(iSeq)
  })
})

describe('SQL_NET_POSTCONDICION · exactamente los tres objetos', () => {
  it('los enumera a los tres', () => {
    for (const o of NET_OBJETOS) expect(SQL_NET_POSTCONDICION).toContain(`'${o}'`)
  })

  it('exige que los tres sigan existiendo', () => {
    expect(SQL_NET_POSTCONDICION).toMatch(/hallados <> array_length\(esperados, 1\)/)
  })

  it('lee del ACL y falla si PUBLIC (grantee 0) conserva algo', () => {
    expect(SQL_NET_POSTCONDICION).toMatch(/a\.grantee = 0/)
    expect(SQL_NET_POSTCONDICION).toMatch(/RAISE EXCEPTION 'POSTCONDICIÓN FALLIDA/)
  })

  it('dice que revierte la transacción entera, incluidos los REVOKE que sí fueron', () => {
    expect(SQL_NET_POSTCONDICION).toMatch(/revierte la transacción ENTERA/)
  })
})

// ── MAINTAIN sólo existe desde Postgres 17 ────────────────────────────────
//
// El nombre no puede aparecer en NINGÚN texto que un servidor 16 vaya a
// analizar: ni como literal de `has_table_privilege` —ahí no devuelve falso,
// lanza «unrecognized privilege type»— ni dentro de un `GRANT`, donde sería un
// error de sintaxis. La única forma segura es armar el array en tiempo de
// ejecución, y eso es lo que se fija acá.
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

  it('la precondición usa esa misma lista, no una copia a mano', () => {
    expect(SQL_NET_PRECONDICION).toContain(SQL_PRIVS_TABLA)
  })
})

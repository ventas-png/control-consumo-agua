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

import { describe, it, expect } from 'vitest'
import {
  sinSecretos, refDeUrl, validarHuellaLive, diffHuellas,
  juzgarCredencial, SECDEF_PERMITIDAS,
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
  superusuario: 'false', bypassrls: 'false', crear_roles: 'false',
  crear_bases: 'false', replicacion: 'false',
  solo_lectura: 'on', version: '17.6.1', search_path: '"$user", public, extensions',
}
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
    expect(reglas({ ...sana, escribibles: 'public.clientes' })).toContain('ESCRITURA')
  })

  it('rechaza SELECT a nivel tabla: la huella sale del catálogo, no de los datos', () => {
    expect(reglas({ ...sana, leibles: 'public.clientes\x1epublic.facturas' }))
      .toContain('SELECT DE TABLA')
  })

  it('rechaza SELECT por columna, que has_table_privilege no ve', () => {
    expect(reglas({ ...sana, leibles_columna: 'public.usuarios' })).toContain('SELECT POR COLUMNA')
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
    for (const r of juzgarCredencial({ ...sana, bypassrls: 'true', leibles: 'public.clientes' })) {
      expect(r.remedio.length).toBeGreaterThan(0)
    }
  })
})

describe('juzgarCredencial · SECURITY DEFINER', () => {
  const conSecdef = {
    ...sana,
    secdef: 'public.update_user_password(text, text)\x1epublic.get_my_company_id()',
  }

  it('rechaza una función SECURITY DEFINER al alcance de la credencial', () => {
    expect(reglas(conSecdef)).toContain('SECURITY DEFINER')
  })

  it('el motivo nombra las funciones, que es lo que hay que ir a cerrar', () => {
    const r = juzgarCredencial(conSecdef).find(x => x.regla === 'SECURITY DEFINER')
    expect(r.detalle).toContain('public.update_user_password(text, text)')
  })

  it('una allowlist explícita levanta el rechazo SÓLO de lo que declara', () => {
    const permitidas = new Map([['public.get_my_company_id()', 'ayudante de RLS, no toca datos']])
    expect(reglas(conSecdef, { permitidas })).toContain('SECURITY DEFINER')
    expect(reglas({ ...conSecdef, secdef: 'public.get_my_company_id()' }, { permitidas })).toEqual([])
  })

  // TRIPWIRE. Que la lista esté vacía no es un detalle de implementación: es la
  // postura. Llenarla es afirmar que esa función, corriendo como su dueño, no
  // le da a esta credencial nada que no debería tener — y eso lo firma quien
  // revisa el PR que agrega la línea, no el auditor. Medido en producción el
  // 2026-09-03: 26 funciones SECURITY DEFINER de `public` son ejecutables por
  // PUBLIC, entre ellas `update_user_password` y `request_password_reset`.
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

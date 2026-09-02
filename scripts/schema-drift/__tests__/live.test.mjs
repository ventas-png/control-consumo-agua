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
import { sinSecretos, refDeUrl, validarHuellaLive, diffHuellas } from '../auditar.mjs'

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

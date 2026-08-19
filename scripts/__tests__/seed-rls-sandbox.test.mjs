// ════════════════════════════════════════════════════════════════════════════
// Pruebas de las salvaguardas de destino del seed del sandbox RLS.
//
// El script usa la service_role (BYPASSRLS: lee y escribe CUALQUIER tenant) y
// crea empresas y usuarios. Apuntarlo al proyecto equivocado no es un fallo de
// CI, es contaminar datos de un cliente. La lista negra del ref de producción
// no basta por sí sola: protege contra UN proyecto conocido y deja pasar
// cualquier otro. De ahí la exigencia de declarar SEED_EXPECTED_REF.
//
// Importar el módulo NO siembra nada (main() está gateado a ejecución directa).
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import { refDeUrl, validarUrlSandbox } from '../seed-rls-sandbox.mjs'

const COBERTURA = {
  dominiosSandboxPermitidos: ['supabase.co', 'supabase.in'],
  refProduccionProhibido: 'nnsqmeigtgewatameexo',
}

const SANDBOX = 'https://abcdefghijklmnop.supabase.co'
const REF_SANDBOX = 'abcdefghijklmnop'

describe('refDeUrl', () => {
  it('extrae ref y dominio', () => {
    expect(refDeUrl(SANDBOX)).toEqual({ ref: REF_SANDBOX, dominio: 'supabase.co' })
  })

  it('tolera la barra final', () => {
    expect(refDeUrl(`${SANDBOX}/`)?.ref).toBe(REF_SANDBOX)
  })

  it('rechaza lo que no tiene forma de URL de proyecto', () => {
    expect(refDeUrl('')).toBeNull()
    expect(refDeUrl('supabase.co')).toBeNull()
    expect(refDeUrl('http://abc.supabase.co')).toBeNull()   // sin https
    expect(refDeUrl('https://abc.supabase.co/rest/v1')).toBeNull()
  })
})

describe('validarUrlSandbox — camino feliz', () => {
  it('acepta un sandbox declarado que coincide con la URL', () => {
    const r = validarUrlSandbox(SANDBOX, REF_SANDBOX, COBERTURA)
    expect(r).toEqual({ ok: true, ref: REF_SANDBOX })
  })
})

describe('validarUrlSandbox — producción', () => {
  it('rechaza el ref de producción aunque se declare a propósito', () => {
    const prod = `https://${COBERTURA.refProduccionProhibido}.supabase.co`
    const r = validarUrlSandbox(prod, COBERTURA.refProduccionProhibido, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('PRODUCCIÓN')
  })
})

describe('validarUrlSandbox — dominio no reconocido', () => {
  it('rechaza un host que no es Supabase', () => {
    const r = validarUrlSandbox('https://abcdefghijklmnop.evil.example', REF_SANDBOX, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('no está reconocido como Supabase')
  })

  it('acepta subdominios de un dominio permitido', () => {
    const r = validarUrlSandbox('https://abc.db.supabase.co', 'abc', COBERTURA)
    expect(r.ok).toBe(true)
  })

  it('rechaza una URL malformada', () => {
    const r = validarUrlSandbox('no-es-una-url', REF_SANDBOX, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('no tiene la forma')
  })
})

describe('validarUrlSandbox — declaración obligatoria del destino', () => {
  it('rechaza si no se declaró SEED_EXPECTED_REF', () => {
    const r = validarUrlSandbox(SANDBOX, '', COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('SEED_EXPECTED_REF')
    // El mensaje sugiere el ref correcto para que arreglarlo sea trivial.
    expect(r.motivo).toContain(REF_SANDBOX)
  })

  it('rechaza si el ref declarado NO coincide con la URL', () => {
    const r = validarUrlSandbox(SANDBOX, 'otro-sandbox-distinto', COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('NO coincide')
  })

  it('el descuido típico: URL de otro proyecto con el ref del sandbox declarado', () => {
    // Copiar-pegar la URL equivocada teniendo el ref correcto declarado es
    // exactamente el accidente que este cerrojo evita.
    const r = validarUrlSandbox('https://proyecto-de-un-cliente.supabase.co', REF_SANDBOX, COBERTURA)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('NO coincide')
  })
})

describe('validarUrlSandbox — contra el manifiesto REAL', () => {
  it('el coverage.json del repo prohíbe el ref de producción y lista dominios', async () => {
    const { cargarCobertura } = await import('../assert-rls-ejecutado.mjs')
    const real = cargarCobertura()
    expect(real.refProduccionProhibido).toBeTruthy()
    expect(real.dominiosSandboxPermitidos.length).toBeGreaterThan(0)

    const prod = `https://${real.refProduccionProhibido}.supabase.co`
    expect(validarUrlSandbox(prod, real.refProduccionProhibido, real).ok).toBe(false)
  })
})


// ════════════════════════════════════════════════════════════════════════════
// Búsqueda de usuarios de Auth: consulta FILTRADA, no listado paginado.
// ════════════════════════════════════════════════════════════════════════════
// EVIDENCIA REAL contra el sandbox, con sólo 4 usuarios en el proyecto:
//
//   page=1 per_page=1  → 200
//   page=1 per_page=2  → 200
//   page=1 per_page=3  → 200
//   page=1 per_page=4  → AuthRetryableFetchError 500
//   page=4 per_page=1  → AuthRetryableFetchError 500
//
// Esto REFUTA la hipótesis anterior ("perPage 1000 es demasiado; con 50 se
// arregla"). No hay un límite de tamaño que respetar: lo que rompe es que la
// respuesta incluya UN REGISTRO CONCRETO del listado general. `per_page=3` cabe
// porque se detiene antes de él; `page=4, per_page=1` falla porque cae justo
// encima. Bajar el tamaño de página sólo mueve la frontera — con otro orden, o
// con un usuario más, el registro vuelve a entrar y el seed vuelve a morir.
//
// La consulta filtrada nunca lo materializa:
//   GET /auth/v1/admin/users?page=1&per_page=1&filter=rls-a%40sandbox.invalid → 200
// y con ella el seed llegó a "Sandbox listo y VERIFICADO como ambos usuarios".
import { buscarUsuarioPorEmail, detalleErrorAuth, upsertUsuario } from '../seed-rls-sandbox.mjs'

const URL_SANDBOX = 'https://jwpmivhvlstslncrtokb.supabase.co'
const CLAVE = 'service-role-de-juguete'

/** fetch de mentira que registra la petición y devuelve la respuesta indicada. */
function fetchFalso(respuesta) {
  const peticiones = []
  const impl = async (url, opciones) => {
    peticiones.push({ url, opciones })
    if (typeof respuesta === 'function') return respuesta(url, opciones)
    return respuesta
  }
  impl.peticiones = peticiones
  return impl
}

const respuestaOk = (users) => ({
  ok: true,
  status: 200,
  json: async () => ({ users }),
})

const buscar = (fetchImpl, email) =>
  buscarUsuarioPorEmail({ url: URL_SANDBOX, serviceKey: CLAVE, fetchImpl }, email)

describe('buscarUsuarioPorEmail — consulta filtrada', () => {
  it('encuentra al usuario existente', async () => {
    const usuario = { id: 'id-a', email: 'rls-a@sandbox.invalid' }
    const f = fetchFalso(respuestaOk([usuario]))

    expect(await buscar(f, 'rls-a@sandbox.invalid')).toEqual(usuario)
  })

  it('pide el endpoint admin con filter, page=1 y per_page=1', async () => {
    const f = fetchFalso(respuestaOk([]))
    await buscar(f, 'rls-a@sandbox.invalid')

    const { url } = f.peticiones[0]
    expect(url).toContain('/auth/v1/admin/users')
    expect(url).toContain('page=1')
    expect(url).toContain('per_page=1')
    // El email va URL-encoded: la arroba rompería el query string.
    expect(url).toContain('filter=rls-a%40sandbox.invalid')
  })

  it('NO pagina el listado general: una sola petición y sin per_page grande', async () => {
    const f = fetchFalso(respuestaOk([]))
    await buscar(f, 'nadie@sandbox.invalid')

    expect(f.peticiones).toHaveLength(1)
    expect(f.peticiones[0].url).not.toMatch(/per_page=(?!1\b)\d+/)
  })

  it('manda apikey y Authorization Bearer con la service_role', async () => {
    const f = fetchFalso(respuestaOk([]))
    await buscar(f, 'rls-a@sandbox.invalid')

    const { headers } = f.peticiones[0].opciones
    expect(headers.apikey).toBe(CLAVE)
    expect(headers.Authorization).toBe(`Bearer ${CLAVE}`)
  })

  it('devuelve null cuando el usuario no existe', async () => {
    const f = fetchFalso(respuestaOk([]))
    expect(await buscar(f, 'nadie@sandbox.invalid')).toBeNull()
  })

  it('la comparación final es EXACTA: una coincidencia parcial no se acepta', async () => {
    // `filter` es una búsqueda parcial del lado del servidor, así que buscar
    // "rls-a@sandbox.invalid" puede devolver "otro-rls-a@sandbox.invalid".
    // Aceptarlo sería reutilizar la identidad de otro usuario.
    const f = fetchFalso(respuestaOk([
      { id: 'id-otro', email: 'otro-rls-a@sandbox.invalid' },
      { id: 'id-largo', email: 'rls-a@sandbox.invalid.mx' },
    ]))

    expect(await buscar(f, 'rls-a@sandbox.invalid')).toBeNull()
  })

  it('la comparación NO distingue mayúsculas (los emails no son sensibles a caja)', async () => {
    const f = fetchFalso(respuestaOk([{ id: 'id-a', email: 'RLS-A@Sandbox.Invalid' }]))
    expect((await buscar(f, 'rls-a@sandbox.invalid'))?.id).toBe('id-a')
  })

  it('elige la coincidencia exacta aunque venga acompañada de parciales', async () => {
    const f = fetchFalso(respuestaOk([
      { id: 'id-otro', email: 'otro-rls-a@sandbox.invalid' },
      { id: 'id-a', email: 'rls-a@sandbox.invalid' },
    ]))
    expect((await buscar(f, 'rls-a@sandbox.invalid'))?.id).toBe('id-a')
  })
})

describe('buscarUsuarioPorEmail — fail-closed', () => {
  it('un HTTP no-2xx aborta en vez de asumir que no existe', async () => {
    // Tratar un 500 como "no existe" haría que el seed CREARA un usuario que ya
    // estaba: dos identidades para el mismo email.
    const f = fetchFalso({ ok: false, status: 500, statusText: 'Internal Server Error' })
    await expect(buscar(f, 'rls-a@sandbox.invalid')).rejects.toThrow(/HTTP 500/)
  })

  it('el error de HTTP no filtra la clave, las cabeceras ni el cuerpo', async () => {
    const f = fetchFalso({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ eco: `apikey=${CLAVE}` }),
    })

    await expect(buscar(f, 'rls-a@sandbox.invalid')).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(CLAVE),
      }),
    )
  })

  it('un cuerpo que no es JSON aborta', async () => {
    const f = fetchFalso({
      ok: true,
      status: 200,
      json: async () => { throw new Error('Unexpected token < in JSON') },
    })
    await expect(buscar(f, 'rls-a@sandbox.invalid')).rejects.toThrow(/no es JSON válido/)
  })

  it('`users` ausente o de otro tipo aborta: "no lo sé" no es "no existe"', async () => {
    for (const cuerpo of [{}, { users: null }, { users: 'nope' }, { users: { 0: 'x' } }]) {
      const f = fetchFalso({ ok: true, status: 200, json: async () => cuerpo })
      await expect(buscar(f, 'rls-a@sandbox.invalid')).rejects.toThrow(/arreglo `users`/)
    }
  })

  it('un fallo de red aborta sin exponer la petición', async () => {
    // La URL lleva el email y las cabeceras la service_role: ni una ni otras
    // pueden acabar en el log.
    const f = fetchFalso(() => { throw new Error('ECONNREFUSED') })
    const promesa = buscar(f, 'rls-a@sandbox.invalid')

    await expect(promesa).rejects.toThrow(/ECONNREFUSED/)
    await expect(promesa).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(CLAVE) }),
    )
  })
})

describe('detalleErrorAuth — diagnóstico seguro', () => {
  it('compone name, status, code y message', () => {
    const d = detalleErrorAuth({ name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: 'boom' })
    expect(d).toBe('name=AuthApiError status=500 code=unexpected_failure message=boom')
  })

  it('serializa el message cuando no es una cadena', () => {
    // GoTrue devolvió literalmente `{}` en el fallo del listado: quedarse con
    // `.message` borraba la única pista útil, el status.
    expect(detalleErrorAuth({ status: 500, message: {} })).toContain('message={}')
    expect(detalleErrorAuth({ status: 500, message: { a: 1 } })).toContain('message={"a":1}')
    expect(detalleErrorAuth({ status: 500, message: null })).toContain('message=null')
    expect(detalleErrorAuth({ status: 500 })).toContain('message=(sin mensaje)')
  })

  it('no lanza ante un message cíclico', () => {
    const ciclico = { self: null }
    ciclico.self = ciclico
    expect(() => detalleErrorAuth({ status: 500, message: ciclico })).not.toThrow()
  })

  it('conserva status=0 y no lo confunde con ausente', () => {
    expect(detalleErrorAuth({ status: 0, message: 'x' })).toContain('status=0')
  })

  it('NO filtra headers, cuerpo crudo ni nada parecido a una credencial', () => {
    const d = detalleErrorAuth({
      name: 'AuthApiError',
      status: 500,
      message: 'fallo',
      headers: { Authorization: 'Bearer sk-secreta' },
      response: { body: 'service_role=clave-secretisima' },
      apiKey: 'clave-que-no-debe-salir',
    })
    expect(d).not.toContain('Bearer')
    expect(d).not.toContain('sk-secreta')
    expect(d).not.toContain('service_role')
    expect(d).not.toContain('clave-que-no-debe-salir')
    expect(d).toBe('name=AuthApiError status=500 message=fallo')
  })

  it('tolera un error nulo', () => {
    expect(detalleErrorAuth(null)).toContain('desconocido')
  })
})

describe('upsertUsuario — idempotencia', () => {
  /** Cliente admin de mentira: registra creaciones y actualizaciones. */
  function adminFalso() {
    const creados = []
    const actualizados = []
    return {
      creados,
      actualizados,
      auth: {
        admin: {
          async createUser({ email }) {
            const nuevo = { id: `nuevo-${email}`, email }
            creados.push(nuevo)
            return { data: { user: nuevo }, error: null }
          },
          async updateUserById(id) {
            actualizados.push(id)
            return { data: null, error: null }
          },
        },
      },
    }
  }

  it('actualiza la contraseña si el usuario existe y NO crea otro', async () => {
    const admin = adminFalso()
    const id = await upsertUsuario(admin, 'a@sandbox.invalid', 'clave', async () => ({ id: 'id-a' }))

    expect(id).toBe('id-a')
    expect(admin.actualizados).toEqual(['id-a'])
    expect(admin.creados, 'no debe crearse un usuario duplicado').toEqual([])
  })

  it('crea el usuario si no existe', async () => {
    const admin = adminFalso()
    const id = await upsertUsuario(admin, 'nuevo@sandbox.invalid', 'clave', async () => null)

    expect(id).toBe('nuevo-nuevo@sandbox.invalid')
    expect(admin.creados).toHaveLength(1)
    expect(admin.actualizados).toEqual([])
  })

  it('dos corridas seguidas dejan UN solo usuario', async () => {
    // La definición operativa de idempotente. El buscador de mentira imita al
    // real: tras crearlo, la siguiente búsqueda ya lo encuentra.
    const admin = adminFalso()
    const registro = new Map()
    const buscarReg = async (email) => registro.get(email) ?? null

    const primera = await upsertUsuario(admin, 'rls-a@sandbox.invalid', 'clave-1', buscarReg)
    registro.set('rls-a@sandbox.invalid', { id: primera })
    const segunda = await upsertUsuario(admin, 'rls-a@sandbox.invalid', 'clave-2', buscarReg)

    expect(segunda).toBe(primera)
    expect(admin.creados).toHaveLength(1)
    expect(admin.actualizados).toEqual([primera])
  })

  it('un fallo de la búsqueda ABORTA en vez de crear a ciegas', async () => {
    const admin = adminFalso()
    const buscarRoto = async () => { throw new Error('HTTP 500') }

    await expect(upsertUsuario(admin, 'a@sandbox.invalid', 'clave', buscarRoto)).rejects.toThrow(/500/)
    expect(admin.creados, 'no debe crear nada si no sabe si ya existe').toEqual([])
  })
})

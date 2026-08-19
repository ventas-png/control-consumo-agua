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
// Listado de usuarios de Auth: paginación real.
// ════════════════════════════════════════════════════════════════════════════
// FALLO REPRODUCIDO contra el sandbox jwpmivhvlstslncrtokb:
//
//   listUsers({ page: 1, perPage: 1 })     → OK
//   listUsers({ perPage: 1000 })           → AuthApiError status 500, message "{}"
//   listUsers({ page: 1, perPage: 1000 })  → AuthApiError status 500
//
// Es decir: el problema es el TAMAÑO DE PÁGINA, no las credenciales ni la
// ausencia de `page`. El seed pedía 1000 usuarios de una vez y moría ahí, antes
// de sembrar nada.
//
// Y el `perPage: 1000` era frágil por dos motivos independientes del bug: sólo
// funcionaba mientras el proyecto tuviera menos de 1000 usuarios, y el error se
// reportaba como `listUsers: {}` —message vacío, status perdido— que es
// exactamente lo que impidió diagnosticarlo a la primera.
import {
  PAGINA_USUARIOS,
  buscarUsuarioPorEmail,
  detalleErrorAuth,
  upsertUsuario,
} from '../seed-rls-sandbox.mjs'

const usuario = (n) => ({ id: `id-${n}`, email: `u${n}@sandbox.invalid` })

/**
 * Cliente admin de mentira sobre una lista de usuarios, que pagina de verdad y
 * REGISTRA cada llamada. Las llamadas registradas son lo que permite afirmar
 * que nunca se pide una página mayor que la permitida.
 */
function adminFalso(usuarios, { errorEnPagina = null, error = null } = {}) {
  const llamadas = []
  const creados = []
  const actualizados = []

  return {
    llamadas,
    creados,
    actualizados,
    auth: {
      admin: {
        async listUsers(opciones) {
          llamadas.push(opciones)
          if (error) return { data: null, error }
          if (errorEnPagina !== null && opciones.page === errorEnPagina) {
            return { data: null, error: { name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: '{}' } }
          }
          const desde = (opciones.page - 1) * opciones.perPage
          return { data: { users: usuarios.slice(desde, desde + opciones.perPage) }, error: null }
        },
        async createUser({ email }) {
          const nuevo = { id: `nuevo-${email}`, email }
          creados.push(nuevo)
          usuarios.push(nuevo)
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

describe('buscarUsuarioPorEmail — paginación', () => {
  it('nunca pide una página mayor que PAGINA_USUARIOS, y ésta es 50', () => {
    // La regresión concreta: perPage 1000 devuelve 500 en el sandbox real.
    expect(PAGINA_USUARIOS).toBe(50)
  })

  it('encuentra al usuario en la PRIMERA página y no pide una segunda', async () => {
    const admin = adminFalso([usuario(1), usuario(2), usuario(3)])
    const hallado = await buscarUsuarioPorEmail(admin, 'u2@sandbox.invalid')

    expect(hallado?.id).toBe('id-2')
    expect(admin.llamadas).toEqual([{ page: 1, perPage: 50 }])
  })

  it('encuentra al usuario en la SEGUNDA página', async () => {
    // 50 usuarios llenan la primera página, así que el objetivo sólo aparece
    // tras pedir la siguiente. Con la versión anterior —una única consulta— este
    // caso dependía por completo de que cupiera en el primer lote.
    const usuarios = Array.from({ length: 50 }, (_, i) => usuario(i))
    usuarios.push({ id: 'id-objetivo', email: 'objetivo@sandbox.invalid' })

    const admin = adminFalso(usuarios)
    const hallado = await buscarUsuarioPorEmail(admin, 'objetivo@sandbox.invalid')

    expect(hallado?.id).toBe('id-objetivo')
    expect(admin.llamadas).toEqual([
      { page: 1, perPage: 50 },
      { page: 2, perPage: 50 },
    ])
  })

  it('devuelve null cuando el usuario no existe, tras agotar las páginas', async () => {
    const usuarios = Array.from({ length: 120 }, (_, i) => usuario(i))
    const admin = adminFalso(usuarios)

    expect(await buscarUsuarioPorEmail(admin, 'nadie@sandbox.invalid')).toBeNull()
    // 120 usuarios = dos páginas llenas + una de 20 (incompleta ⇒ es la última).
    expect(admin.llamadas.map((l) => l.page)).toEqual([1, 2, 3])
  })

  it('para en una página vacía sin pedir más', async () => {
    const admin = adminFalso([])
    expect(await buscarUsuarioPorEmail(admin, 'nadie@sandbox.invalid')).toBeNull()
    expect(admin.llamadas).toHaveLength(1)
  })

  it('para cuando el total es múltiplo exacto de la página', async () => {
    // 100 usuarios = dos páginas llenas; la tercera vuelve vacía y corta el bucle.
    const admin = adminFalso(Array.from({ length: 100 }, (_, i) => usuario(i)))
    expect(await buscarUsuarioPorEmail(admin, 'nadie@sandbox.invalid')).toBeNull()
    expect(admin.llamadas.map((l) => l.page)).toEqual([1, 2, 3])
  })

  it('EN NINGÚN caso solicita perPage mayor que 50', async () => {
    const admin = adminFalso(Array.from({ length: 200 }, (_, i) => usuario(i)))
    await buscarUsuarioPorEmail(admin, 'nadie@sandbox.invalid')

    expect(admin.llamadas.length).toBeGreaterThan(1)
    for (const l of admin.llamadas) {
      expect(l.perPage, `perPage ${l.perPage} supera el máximo seguro`).toBeLessThanOrEqual(50)
      expect(l.page, 'page debe empezar en 1, no en 0').toBeGreaterThanOrEqual(1)
    }
  })

  it('propaga el error de listUsers CONSERVANDO status y code', async () => {
    // Lo que hacía indiagnosticable el fallo real: `${error.message}` daba
    // "listUsers: {}" y el status 500 se perdía por el camino.
    const admin = adminFalso([], {
      error: { name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: '{}' },
    })

    await expect(buscarUsuarioPorEmail(admin, 'x@sandbox.invalid')).rejects.toThrow(/status=500/)
    await expect(buscarUsuarioPorEmail(admin, 'x@sandbox.invalid')).rejects.toThrow(/code=unexpected_failure/)
    await expect(buscarUsuarioPorEmail(admin, 'x@sandbox.invalid')).rejects.toThrow(/AuthApiError/)
  })

  it('el error dice en qué página y con qué tamaño falló', async () => {
    const usuarios = Array.from({ length: 60 }, (_, i) => usuario(i))
    const admin = adminFalso(usuarios, { errorEnPagina: 2 })

    await expect(buscarUsuarioPorEmail(admin, 'nadie@sandbox.invalid'))
      .rejects.toThrow(/page=2, perPage=50/)
  })
})

describe('detalleErrorAuth — diagnóstico seguro', () => {
  it('compone name, status, code y message', () => {
    const d = detalleErrorAuth({ name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: 'boom' })
    expect(d).toBe('name=AuthApiError status=500 code=unexpected_failure message=boom')
  })

  it('serializa el message cuando no es una cadena', () => {
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
    // Se le pasa un error con basura sensible en campos que NO deben leerse.
    const d = detalleErrorAuth({
      name: 'AuthApiError',
      status: 500,
      message: 'fallo',
      headers: { Authorization: 'Bearer sk-secreta' },
      __isAuthError: true,
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
  it('actualiza la contraseña si el usuario existe y NO crea otro', async () => {
    const admin = adminFalso([usuario(1), { id: 'id-a', email: 'a@sandbox.invalid' }])

    const id = await upsertUsuario(admin, 'a@sandbox.invalid', 'clave-nueva')

    expect(id).toBe('id-a')
    expect(admin.actualizados).toEqual(['id-a'])
    expect(admin.creados, 'no debe crearse un usuario duplicado').toEqual([])
  })

  it('lo encuentra aunque esté en una página posterior, sin duplicarlo', async () => {
    // Es el caso que el `perPage: 1000` disimulaba: con paginación rota, un
    // usuario existente pero fuera del primer lote se habría vuelto a crear.
    const usuarios = Array.from({ length: 50 }, (_, i) => usuario(i))
    usuarios.push({ id: 'id-b', email: 'b@sandbox.invalid' })
    const admin = adminFalso(usuarios)

    const id = await upsertUsuario(admin, 'b@sandbox.invalid', 'clave')

    expect(id).toBe('id-b')
    expect(admin.creados).toEqual([])
    expect(admin.actualizados).toEqual(['id-b'])
  })

  it('crea el usuario si no existe', async () => {
    const admin = adminFalso([usuario(1)])
    const id = await upsertUsuario(admin, 'nuevo@sandbox.invalid', 'clave')

    expect(id).toBe('nuevo-nuevo@sandbox.invalid')
    expect(admin.creados).toHaveLength(1)
    expect(admin.actualizados).toEqual([])
  })

  it('dos corridas seguidas dejan UN solo usuario', async () => {
    // La definición operativa de idempotente: correr el seed dos veces no puede
    // dejar dos identidades con el mismo email.
    const admin = adminFalso([])

    const primera = await upsertUsuario(admin, 'rls-a@sandbox.invalid', 'clave-1')
    const segunda = await upsertUsuario(admin, 'rls-a@sandbox.invalid', 'clave-2')

    expect(segunda).toBe(primera)
    expect(admin.creados).toHaveLength(1)
    expect(admin.actualizados).toEqual([primera])
  })
})

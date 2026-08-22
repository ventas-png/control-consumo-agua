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
// Búsqueda de usuarios de Auth: consulta FILTRADA y PAGINADA.
// ════════════════════════════════════════════════════════════════════════════
// EVIDENCIA REAL contra el sandbox, con sólo 4 usuarios en el proyecto:
//
//   page=1 per_page=1  → 200      page=1 per_page=4  → AuthRetryableFetchError 500
//   page=1 per_page=2  → 200      page=4 per_page=1  → AuthRetryableFetchError 500
//   page=1 per_page=3  → 200
//
// Refuta la hipótesis "perPage 1000 es demasiado, con 50 se arregla": no hay un
// límite de tamaño, rompe INCLUIR UN REGISTRO CONCRETO en la respuesta. Por eso
// el listado general se abandona y se consulta con `filter`.
//
// Pero una sola página filtrada tampoco bastaba. GoTrue aplica el filtro
// aproximadamente como
//
//     email LIKE '%filter%' OR full_name ILIKE '%filter%'
//
// así que con `per_page=1` una coincidencia PARCIAL más reciente puede ocupar el
// único resultado y ocultar al usuario exacto. El seed concluiría que no existe,
// lo crearía otra vez y rompería la idempotencia.
import {
  PAGINA_FILTRO,
  buscarUsuarioPorEmail,
  detalleErrorAuth,
  upsertUsuario,
} from '../seed-rls-sandbox.mjs'

const URL_SANDBOX = 'https://jwpmivhvlstslncrtokb.supabase.co'
const CLAVE = 'service-role-de-juguete'
const EMAIL = 'rls-a@sandbox.invalid'

const usuario = (n, email) => ({ id: `id-${n}`, email: email ?? `u${n}@sandbox.invalid` })

/**
 * fetch de mentira que pagina de VERDAD sobre una lista, respetando el
 * `per_page` pedido. Nunca devuelve más filas de las solicitadas: una respuesta
 * que no respeta la paginación no representa a ningún servidor real y volvería
 * vacua la prueba.
 */
function fetchPaginado(usuarios, { errorEnPagina = null, transformar = null } = {}) {
  const peticiones = []
  const impl = async (url, opciones) => {
    const u = new URL(url)
    const page = Number(u.searchParams.get('page'))
    const perPage = Number(u.searchParams.get('per_page'))
    peticiones.push({ url, page, perPage, filter: u.searchParams.get('filter'), opciones })

    if (errorEnPagina !== null && page === errorEnPagina) {
      return { ok: false, status: 500, statusText: 'Internal Server Error' }
    }
    const desde = (page - 1) * perPage
    const lote = usuarios.slice(desde, desde + perPage)
    return { ok: true, status: 200, json: async () => (transformar ? transformar(lote) : { users: lote }) }
  }
  impl.peticiones = peticiones
  return impl
}

/** fetch que devuelve una respuesta fija (para los casos de forma inválida). */
function fetchFijo(respuesta) {
  const peticiones = []
  const impl = async (url, opciones) => {
    peticiones.push({ url, opciones })
    if (typeof respuesta === 'function') return respuesta(url, opciones)
    return respuesta
  }
  impl.peticiones = peticiones
  return impl
}

const buscar = (fetchImpl, email = EMAIL) =>
  buscarUsuarioPorEmail({ url: URL_SANDBOX, serviceKey: CLAVE, fetchImpl }, email)

describe('buscarUsuarioPorEmail — consulta filtrada', () => {
  it('encuentra al usuario existente', async () => {
    const u = usuario('a', EMAIL)
    expect(await buscar(fetchPaginado([u]))).toEqual(u)
  })

  it('pide el endpoint admin con filter y page desde 1', async () => {
    const f = fetchPaginado([])
    await buscar(f)
    const p = f.peticiones[0]
    expect(p.url).toContain('/auth/v1/admin/users')
    expect(p.page).toBe(1)
    expect(p.filter).toBe(EMAIL)
    expect(p.url).toContain('filter=rls-a%40sandbox.invalid')
  })

  it('NO vuelve al listado general: toda petición lleva filter', async () => {
    const f = fetchPaginado(Array.from({ length: PAGINA_FILTRO * 2 }, (_, i) => usuario(i)))
    await buscar(f)
    expect(f.peticiones.length).toBeGreaterThan(1)
    for (const p of f.peticiones) expect(p.filter).toBe(EMAIL)
  })

  it('manda apikey y Authorization Bearer con la service_role', async () => {
    const f = fetchPaginado([])
    await buscar(f)
    const { headers } = f.peticiones[0].opciones
    expect(headers.apikey).toBe(CLAVE)
    expect(headers.Authorization).toBe(`Bearer ${CLAVE}`)
  })
})

describe('buscarUsuarioPorEmail — la exacta no se pierde entre las parciales', () => {
  it('una coincidencia PARCIAL que aparece ANTES no se acepta ni tapa a la exacta', () => {
    // El escenario del hallazgo: el filtro es LIKE '%…%', así que `otro-rls-a@…`
    // casa igual y puede venir primero.
    const lista = [usuario('otro', `otro-${EMAIL}`), usuario('a', EMAIL)]
    return expect(buscar(fetchPaginado(lista))).resolves.toMatchObject({ id: 'id-a' })
  })

  it('la exacta se encuentra aunque esté en una página POSTERIOR', async () => {
    // Con una sola página filtrada, esto devolvía null y el seed duplicaba.
    const parciales = Array.from({ length: PAGINA_FILTRO }, (_, i) => usuario(i, `p${i}-${EMAIL}`))
    const f = fetchPaginado([...parciales, usuario('a', EMAIL)])

    expect((await buscar(f))?.id).toBe('id-a')
    expect(f.peticiones.map((p) => p.page)).toEqual([1, 2])
  })

  it('devuelve null cuando NO hay coincidencia exacta, sólo parciales', async () => {
    const lista = [usuario('otro', `otro-${EMAIL}`), usuario('largo', `${EMAIL}.mx`)]
    expect(await buscar(fetchPaginado(lista))).toBeNull()
  })

  it('la comparación NO distingue mayúsculas', async () => {
    const f = fetchPaginado([{ id: 'id-a', email: 'RLS-A@Sandbox.Invalid' }])
    expect((await buscar(f))?.id).toBe('id-a')
  })

  it('DOS coincidencias exactas abortan: es un estado inconsistente', async () => {
    // No se elige una al azar: dos identidades con el mismo email significan que
    // el proyecto está en un estado que nadie entiende.
    const f = fetchPaginado([{ id: 'id-1', email: EMAIL }, { id: 'id-2', email: EMAIL }])
    await expect(buscar(f)).rejects.toThrow(/2 usuarios con ese email exacto/)
  })

  it('ninguna respuesta de prueba devuelve más filas que el per_page pedido', async () => {
    // Si el doble no respeta la paginación, las pruebas de arriba no representan
    // a ningún servidor real y no prueban nada.
    const f = fetchPaginado(Array.from({ length: PAGINA_FILTRO * 3 }, (_, i) => usuario(i)))
    await buscar(f)
    for (const p of f.peticiones) {
      expect(p.perPage).toBe(PAGINA_FILTRO)
    }
    // Y se comprueba sobre la respuesta real del doble, no sólo sobre la petición.
    const resp = await f(`${URL_SANDBOX}/auth/v1/admin/users?page=1&per_page=${PAGINA_FILTRO}&filter=x`, {})
    expect((await resp.json()).users.length).toBeLessThanOrEqual(PAGINA_FILTRO)
  })
})

describe('buscarUsuarioPorEmail — fail-closed', () => {
  it('un HTTP no-2xx en la PRIMERA página aborta', async () => {
    const f = fetchFijo({ ok: false, status: 500, statusText: 'Internal Server Error' })
    await expect(buscar(f)).rejects.toThrow(/HTTP 500/)
  })

  it('un HTTP 500 en una página POSTERIOR aborta: el listado queda incompleto', async () => {
    // Quedarse con lo recogido hasta ahí sería concluir "no existe" con datos a
    // medias — y crear un duplicado.
    const parciales = Array.from({ length: PAGINA_FILTRO }, (_, i) => usuario(i, `p${i}-${EMAIL}`))
    const f = fetchPaginado([...parciales, usuario('a', EMAIL)], { errorEnPagina: 2 })
    await expect(buscar(f)).rejects.toThrow(/HTTP 500.*página 2/s)
  })

  it('el error de HTTP no filtra la clave, las cabeceras ni el cuerpo', async () => {
    const f = fetchFijo({
      ok: false, status: 403, statusText: 'Forbidden',
      json: async () => ({ eco: `apikey=${CLAVE}` }),
    })
    await expect(buscar(f)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(CLAVE) }),
    )
  })

  it('un cuerpo que no es JSON aborta', async () => {
    const f = fetchFijo({
      ok: true, status: 200,
      json: async () => { throw new Error('Unexpected token < in JSON') },
    })
    await expect(buscar(f)).rejects.toThrow(/no es JSON válido/)
  })

  it('`users` ausente o de otro tipo aborta: "no lo sé" no es "no existe"', async () => {
    for (const cuerpo of [{}, { users: null }, { users: 'nope' }, { users: { 0: 'x' } }]) {
      const f = fetchFijo({ ok: true, status: 200, json: async () => cuerpo })
      await expect(buscar(f)).rejects.toThrow(/arreglo `users`/)
    }
  })

  it('una página con MÁS filas de las pedidas aborta por incoherente', async () => {
    const f = fetchPaginado([], {
      transformar: () => ({ users: Array.from({ length: PAGINA_FILTRO + 5 }, (_, i) => usuario(i)) }),
    })
    await expect(buscar(f)).rejects.toThrow(/Paginación incoherente/)
  })

  it('un listado filtrado interminable aborta en vez de girar para siempre', async () => {
    // Un backend que devolviera siempre una página llena dejaría el bucle vivo.
    const f = fetchFijo({
      ok: true, status: 200,
      json: async () => ({ users: Array.from({ length: PAGINA_FILTRO }, (_, i) => usuario(i)) }),
    })
    await expect(buscar(f)).rejects.toThrow(/Resultado ambiguo/)
  })

  it('un fallo de red aborta sin exponer la petición', async () => {
    const f = fetchFijo(() => { throw new Error('ECONNREFUSED') })
    await expect(buscar(f)).rejects.toThrow(/ECONNREFUSED/)
    await expect(buscar(f)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(CLAVE) }),
    )
  })

  it('ningún mensaje de error incluye la URL completa', async () => {
    // La URL lleva el email en el query string; el mensaje lo nombra aparte,
    // pero no debe arrastrar el endpoint ni sus parámetros.
    const f = fetchFijo({ ok: false, status: 502, statusText: 'Bad Gateway' })
    await expect(buscar(f)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('/auth/v1/admin/users') }),
    )
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
    const d = detalleErrorAuth({
      name: 'AuthApiError', status: 500, message: 'fallo',
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
    const id = await upsertUsuario(admin, EMAIL, 'clave', async () => ({ id: 'id-a' }))
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
    const admin = adminFalso()
    const registro = new Map()
    const buscarReg = async (email) => registro.get(email) ?? null

    const primera = await upsertUsuario(admin, EMAIL, 'clave-1', buscarReg)
    registro.set(EMAIL, { id: primera })
    const segunda = await upsertUsuario(admin, EMAIL, 'clave-2', buscarReg)

    expect(segunda).toBe(primera)
    expect(admin.creados).toHaveLength(1)
    expect(admin.actualizados).toEqual([primera])
  })

  it('un fallo de la búsqueda ABORTA en vez de crear a ciegas', async () => {
    const admin = adminFalso()
    const buscarRoto = async () => { throw new Error('HTTP 500') }
    await expect(upsertUsuario(admin, EMAIL, 'clave', buscarRoto)).rejects.toThrow(/500/)
    expect(admin.creados, 'no debe crear nada si no sabe si ya existe').toEqual([])
  })

  it('con la exacta en una página posterior, NO duplica', async () => {
    // La cadena completa: búsqueda paginada real + upsert.
    const admin = adminFalso()
    const parciales = Array.from({ length: PAGINA_FILTRO }, (_, i) => usuario(i, `p${i}-${EMAIL}`))
    const f = fetchPaginado([...parciales, { id: 'id-a', email: EMAIL }])

    const id = await upsertUsuario(admin, EMAIL, 'clave', (e) => buscar(f, e))
    expect(id).toBe('id-a')
    expect(admin.creados).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gate por CLASE: el fixture de cuatro usuarios de la MISMA empresa.
// ════════════════════════════════════════════════════════════════════════════
// Estas pruebas no siembran nada (no hay Supabase que sembrar): fijan el
// CONTRATO del fixture y las propiedades del script que no se pueden comprobar
// corriéndolo — que no imprima la service_role, que rote las contraseñas y que
// los ocho secretos que emite sean exactamente los que el preflight exige.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLASE_USUARIOS } from '../seed-rls-sandbox.mjs'
import { VARIABLES_CLASE } from '../rls-preflight.mjs'

const RAIZ_SEED = join(dirname(fileURLToPath(import.meta.url)), '..')
const FUENTE_SEED = readFileSync(join(RAIZ_SEED, 'seed-rls-sandbox.mjs'), 'utf8')

describe('fixture del gate por clase', () => {
  it('son CUATRO usuarios y cubren los ocho secretos que exige el preflight', () => {
    expect(CLASE_USUARIOS).toHaveLength(4)
    const emitidos = CLASE_USUARIOS.flatMap((u) => [
      `RLS_USER_${u.key}_EMAIL`, `RLS_USER_${u.key}_PASSWORD`,
    ])
    // Si el seed emitiera unos nombres y el preflight esperara otros, el
    // operador configuraría ocho secretos y el job seguiría en rojo sin decir
    // por qué.
    expect(emitidos.sort()).toEqual([...VARIABLES_CLASE].sort())
  })

  it('los dos granulares NO son administrativos', () => {
    // `user_has_permission` le dice true a TODO a super_admin/company_owner/
    // admin (20260518000008). Con un admin como "operador de paquetería", el
    // gate de SELECT/INSERT/UPDATE por clase sencillamente no se vería y la
    // suite pasaría sin comprobar nada.
    const administrativos = ['admin', 'company_owner', 'super_admin', 'superadmin']
    for (const key of ['PAQ', 'CORR']) {
      const u = CLASE_USUARIOS.find((x) => x.key === key)
      expect(administrativos, `${key} no puede tener un rol administrativo`).not.toContain(u.role)
      expect(u.rbac, `${key} necesita un rol RBAC granular`).toBeTruthy()
    }
  })

  it('admin y owner llevan exactamente los roles que el DELETE por clase necesita', () => {
    // DELETE de correspondencia sólo lo puede company_owner; el admin es el
    // control negativo y el owner el positivo. Sin ambos, la prueba central
    // ("un admin no borra una notificación legal") no se puede montar.
    expect(CLASE_USUARIOS.find((u) => u.key === 'ADMIN').role).toBe('admin')
    expect(CLASE_USUARIOS.find((u) => u.key === 'OWNER').role).toBe('company_owner')
    // Y ninguno de los dos lleva rol RBAC granular: su poder viene del rol.
    expect(CLASE_USUARIOS.find((u) => u.key === 'ADMIN').rbac).toBeNull()
    expect(CLASE_USUARIOS.find((u) => u.key === 'OWNER').rbac).toBeNull()
  })

  it('los permisos de los granulares son disjuntos y de la clase que dicen', () => {
    const paq = CLASE_USUARIOS.find((u) => u.key === 'PAQ')
    const corr = CLASE_USUARIOS.find((u) => u.key === 'CORR')
    expect(paq.rbac).toBe('paq')
    expect(corr.rbac).toBe('corr')
    expect(paq.rbac).not.toBe(corr.rbac)
  })

  it('los seis emails son distintos entre sí y del dominio reservado', () => {
    const emails = CLASE_USUARIOS.map((u) => u.email)
    expect(new Set(emails).size).toBe(emails.length)
    // `.invalid` está reservado por RFC 2606: ninguna de estas cuentas puede
    // recibir correo de verdad ni colisionar con una persona.
    for (const e of emails) expect(e).toMatch(/@sandbox\.invalid$/)
  })
})

describe('el seed no filtra la service_role ni deja contraseñas viejas', () => {
  it('la service_role entra por variable de entorno y nunca se imprime', () => {
    expect(FUENTE_SEED).toContain('env.SEED_SERVICE_ROLE_KEY')
    // Ninguna línea que imprima puede llevar la clave. Se mira el código, no
    // los comentarios: la cabecera habla de ella a propósito.
    const codigo = FUENTE_SEED.split('\n').filter((l) => !/^\s*\/\//.test(l))
    const impresiones = codigo.filter((l) => /console\.(log|error)|\blog\(/.test(l))
    for (const l of impresiones) {
      expect(l, `esta línea podría imprimir la service_role:\n${l}`).not.toMatch(/\bKEY\b|serviceKey/)
    }
  })

  it('no se escribe ningún archivo: nada queda en disco', () => {
    const codigo = FUENTE_SEED.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(codigo).not.toMatch(/writeFileSync|appendFileSync|createWriteStream/)
  })

  it('las contraseñas se ROTAN también para los usuarios que ya existían', () => {
    // Si no se reescribieran, las impresas al final no serían las válidas y el
    // operador configuraría secretos que no dejan iniciar sesión.
    expect(FUENTE_SEED).toMatch(/updateUserById\(existing\.id, \{ password: pass \}\)/)
    // Y cada usuario del gate recibe una contraseña nueva por corrida.
    expect(FUENTE_SEED).toMatch(/for \(const u of CLASE_USUARIOS\)[\s\S]{0,120}const pass = password\(\)/)
  })

  it('el fixture CONVERGE: no acumula permisos ni roles de corridas anteriores', () => {
    // Un rol al que una corrida vieja le dejó la otra clave concedería las dos
    // clases, y "no ve la otra" pasaría a ser imposible de fallar.
    // Ahora el conjunto declarado tiene varias claves, así que la limpieza es
    // `not.in(...)` en vez de un `neq` a una sola.
    expect(FUENTE_SEED).toMatch(/from\('role_permissions'\)\s*\n?\s*\.delete\(\)\.eq\('role_id', roleId\)\.not\('permission_key', 'in', lista\)/)
    expect(FUENTE_SEED).toMatch(/from\('user_roles'\)\.delete\(\)\.eq\('user_id', userId\)/)
  })

  it('verifica el login de CADA usuario antes de emitir los secretos', () => {
    expect(FUENTE_SEED).toMatch(/signInWithPassword\(\{ email: u\.email, password: u\.pass \}\)/)
    // Y no basta con entrar: se comprueba que los permisos efectivos son los
    // que la suite supone, o el fixture podría estar probando lo contrario.
    expect(FUENTE_SEED).toMatch(/rpc\('user_has_permission', \{ perm_key: clave \}\)/)
    expect(FUENTE_SEED).toMatch(/rpc\('get_my_company_id'\)/)
  })

  it('cualquier fallo de la verificación impide el mensaje de "listo"', () => {
    const iFallos = FUENTE_SEED.indexOf('fallos.push(...await verificarGateDeClase')
    const iCorte = FUENTE_SEED.indexOf('if (fallos.length > 0) {', iFallos)
    const iListo = FUENTE_SEED.indexOf('Sandbox listo y VERIFICADO')
    expect(iFallos).toBeGreaterThan(0)
    // El corte tiene que estar ENTRE la verificación y la emisión de secretos.
    expect(iCorte).toBeGreaterThan(iFallos)
    expect(iListo).toBeGreaterThan(iCorte)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// El esquema del motor único: sin él, «Sandbox listo» es mentira.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA. El seed crea empresas, proyectos, unidades, roles y
// usuarios; nada de eso toca `paquetes_recibidos`. Un sandbox sin las
// migraciones de recepción pasaba el seed entero sin un fallo y el script
// remataba con «✅ Sandbox listo y VERIFICADO». Con los quince secretos ya
// puestos, el harness falló ocho veces con
// `column paquetes_recibidos.clase does not exist` mientras el seed afirmaba
// que todo estaba en orden.
import {
  CADENA_RECEPCION,
  CADENA_RECEPCION_ARCHIVOS,
  COLUMNAS_RECEPCION,
  clasificarErrorEsquema,
  mensajeEsquemaAusente,
  verificarEsquemaRecepcion,
} from '../seed-rls-sandbox.mjs'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/** Doble del cliente admin: responde por columna, no por conteo. */
function adminFalso(porColumna) {
  const pedidas = []
  return {
    pedidas,
    from() {
      return {
        select(col) {
          pedidas.push(col)
          const r = porColumna[col]
          return { limit: async () => (r ?? { data: [], error: null }) }
        },
      }
    },
  }
}

const ERR_COLUMNA = { code: '42703', message: 'column paquetes_recibidos.clase does not exist' }
const ERR_CACHE = { code: 'PGRST204', message: "Could not find the 'clase' column of 'paquetes_recibidos' in the schema cache" }

describe('clasificarErrorEsquema', () => {
  it('la columna inexistente de Postgres es "ausente"', () => {
    expect(clasificarErrorEsquema(ERR_COLUMNA)).toBe('ausente')
  })

  it('la caché desactualizada de PostgREST también', () => {
    // No se distinguen con certeza desde fuera, así que comparten remedio: la
    // recarga de caché sólo aplica si las migraciones ya constan aplicadas.
    expect(clasificarErrorEsquema(ERR_CACHE)).toBe('ausente')
    expect(clasificarErrorEsquema({ code: 'PGRST205', message: 'not found in schema cache' })).toBe('ausente')
  })

  it('se clasifica por CÓDIGO, no sólo por el texto', () => {
    // Un mensaje puede cambiar de redacción entre versiones; el código no.
    expect(clasificarErrorEsquema({ code: '42703', message: 'texto raro sin palabras clave' })).toBe('ausente')
  })

  it('cualquier otro error NO se disfraza de "ausente"', () => {
    // Un 500, un token muerto o un timeout no son «falta la migración»: son
    // «no lo sé», y el llamador tiene que tratarlos distinto.
    expect(clasificarErrorEsquema({ code: '08006', message: 'connection failure' })).toBe('otro')
    expect(clasificarErrorEsquema({ code: '42501', message: 'permission denied' })).toBe('otro')
  })
})

describe('verificarEsquemaRecepcion', () => {
  it('ESQUEMA COMPLETO → sin fallos, y consultó las dos columnas', async () => {
    const admin = adminFalso({})
    expect(await verificarEsquemaRecepcion(admin, 'refx')).toEqual([])
    expect(admin.pedidas).toEqual(COLUMNAS_RECEPCION)
  })

  it('una tabla VACÍA no es un fallo de esquema', async () => {
    // Comprobar conteos en vez de errores confundiría «no hay piezas todavía»
    // con «falta la migración». El sandbox recién sembrado está vacío.
    const admin = adminFalso({
      clase: { data: [], error: null },
      destinatario_tipo: { data: [], error: null },
    })
    expect(await verificarEsquemaRecepcion(admin, 'refx')).toEqual([])
  })

  it('falta `clase` → falla y lo nombra', async () => {
    const fallos = await verificarEsquemaRecepcion(adminFalso({ clase: { error: ERR_COLUMNA } }), 'refx')
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toContain('clase')
  })

  it('falta `destinatario_tipo` → falla y lo nombra', async () => {
    const fallos = await verificarEsquemaRecepcion(
      adminFalso({ destinatario_tipo: { error: { code: '42703', message: 'column ... does not exist' } } }), 'refx')
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toContain('destinatario_tipo')
  })

  it('faltan las dos → las nombra a las dos', async () => {
    const fallos = await verificarEsquemaRecepcion(
      adminFalso({ clase: { error: ERR_COLUMNA }, destinatario_tipo: { error: ERR_COLUMNA } }), 'refx')
    expect(fallos[0]).toContain('clase')
    expect(fallos[0]).toContain('destinatario_tipo')
  })

  it('CACHÉ DESACTUALIZADA → falla con el remedio de la recarga', async () => {
    const fallos = await verificarEsquemaRecepcion(adminFalso({ clase: { error: ERR_CACHE } }), 'refx')
    expect(fallos[0]).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('un error de PostgREST que NO es de columna NO se oculta', async () => {
    // El fallo original fue exactamente éste un nivel más arriba: leer `data` y
    // no mirar `error`. Aquí un error desconocido tiene que salir a la luz con
    // su mensaje, no convertirse en un silencioso «todo bien».
    const fallos = await verificarEsquemaRecepcion(
      adminFalso({ clase: { error: { code: '08006', message: 'connection failure' } } }), 'refx')
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toContain('no se pudo verificar')
    expect(fallos[0]).toContain('connection failure')
  })

  it('un error desconocido corta: no sigue preguntando a ciegas', async () => {
    const admin = adminFalso({ clase: { error: { code: '08006', message: 'boom' } } })
    await verificarEsquemaRecepcion(admin, 'refx')
    expect(admin.pedidas).toEqual(['clase'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// La cadena declarada tiene que ser la cadena que existe.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA. Dos de estas migraciones se renumeraron porque #779
// (Renta) ocupó sus números en `main`. El mensaje del seed las nombra una por
// una: si alguien vuelve a renombrar y no toca esta lista, el seed mandará
// aplicar archivos que no existen — y lo hará justo cuando el sandbox está roto
// y nadie tiene ganas de dudar del mensaje de error.
describe('CADENA_RECEPCION_ARCHIVOS espeja los archivos reales', () => {
  const enDisco = readdirSync(resolve('supabase/migrations')).filter((f) => f.endsWith('.sql'))

  it('cada archivo declarado existe en supabase/migrations', () => {
    for (const base of CADENA_RECEPCION_ARCHIVOS) {
      expect(enDisco, `declarada pero ausente: ${base}.sql`).toContain(`${base}.sql`)
    }
  })

  it('son siete y están en orden de versión', () => {
    // Seis de la unificación más la de cierre posfusión (20260903000000), que
    // valida el CHECK de estados y retira el respaldo: un sandbox que aplique
    // sólo las seis queda con una constraint sin validar y una tabla de más,
    // es decir, con un esquema que ya no es el de producción.
    expect(CADENA_RECEPCION_ARCHIVOS).toHaveLength(7)
    const versiones = CADENA_RECEPCION_ARCHIVOS.map((a) => a.slice(0, 14))
    expect(versiones).toEqual([...versiones].sort())
    expect(new Set(versiones).size).toBe(versiones.length)
  })

  it('los extremos salen de la lista, no de dos constantes sueltas', () => {
    expect(CADENA_RECEPCION.desde).toBe(CADENA_RECEPCION_ARCHIVOS[0].slice(0, 14))
    expect(CADENA_RECEPCION.hasta).toBe(CADENA_RECEPCION_ARCHIVOS.at(-1).slice(0, 14))
  })

  it('ninguna migración de recepción se quedó fuera de la lista', () => {
    // El complemento del chequeo anterior: que exista lo declarado no impide
    // olvidarse de declarar algo. Toda migración cuyo nombre hable de recepción
    // o correspondencia y sea posterior a la primera de la cadena tiene que
    // estar en la lista.
    const desde = CADENA_RECEPCION.desde
    const candidatas = enDisco
      .filter((f) => /_(recepcion|correspondencia)_/.test(f))
      .filter((f) => f.slice(0, 14) >= desde)
      .map((f) => f.replace(/\.sql$/, ''))
    expect([...candidatas].sort()).toEqual([...CADENA_RECEPCION_ARCHIVOS].sort())
  })

  it('el mensaje de esquema ausente nombra las seis', () => {
    const m = mensajeEsquemaAusente(['clase'], 'refx')
    for (const base of CADENA_RECEPCION_ARCHIVOS) expect(m).toContain(`${base}.sql`)
  })
})

describe('mensajeEsquemaAusente', () => {
  it('manda aplicar la cadena COMPLETA, con sus extremos', () => {
    const m = mensajeEsquemaAusente(['clase'], 'refx')
    expect(m).toContain(CADENA_RECEPCION.desde)
    expect(m).toContain(CADENA_RECEPCION.hasta)
    expect(m).toMatch(/COMPLETA|entera/)
  })

  it('nombra el proyecto destino, y cae a SEED_EXPECTED_REF si no lo hay', () => {
    expect(mensajeEsquemaAusente(['clase'], 'refx')).toContain('refx')
    expect(mensajeEsquemaAusente(['clase'], '')).toContain('SEED_EXPECTED_REF')
  })

  it('la recarga de caché aparece SÓLO como remedio condicionado', () => {
    // Ofrecerla como primera opción mandaría a recargar una caché que no tiene
    // nada que cachear todavía.
    const m = mensajeEsquemaAusente(['clase'], 'refx')
    const iCadena = m.indexOf(CADENA_RECEPCION.desde)
    const iNotify = m.indexOf('NOTIFY pgrst')
    expect(iCadena).toBeGreaterThanOrEqual(0)
    expect(iNotify).toBeGreaterThan(iCadena)
    expect(m).toMatch(/Sólo si esas migraciones YA constan aplicadas/)
  })
})

describe('«Sandbox listo» no puede salir con el esquema incompleto', () => {
  // Los mensajes de fallo y el de éxito viven en `main`, que no se puede correr
  // sin un Supabase. Se afirma sobre la ESTRUCTURA del script: que el chequeo
  // alimenta la misma lista `fallos` que ya bloquea el mensaje final.
  const iChequeo = FUENTE_SEED.indexOf('await verificarEsquemaRecepcion(admin')
  const iCorte = FUENTE_SEED.indexOf('if (fallos.length > 0) {', iChequeo)
  const iListo = FUENTE_SEED.indexOf('Sandbox listo y VERIFICADO')

  it('el chequeo de esquema corre ANTES del corte y del mensaje final', () => {
    expect(iChequeo).toBeGreaterThan(0)
    expect(iCorte).toBeGreaterThan(iChequeo)
    expect(iListo).toBeGreaterThan(iCorte)
  })

  it('sus fallos entran en la MISMA lista que bloquea el mensaje', () => {
    expect(FUENTE_SEED).toContain('fallos.push(...fallosEsquema)')
  })

  it('el corte devuelve un exit distinto de cero', () => {
    const bloque = FUENTE_SEED.slice(iCorte, iListo)
    expect(bloque).toMatch(/return 1/)
  })

  it('el banner de éxito se emite en UN solo sitio, después del corte', () => {
    // Si hubiera un segundo sitio que lo imprimiera, el corte no lo cubriría.
    // Se cuenta el BANNER COMPLETO, no la frase suelta: el mensaje de aborto
    // dice «no se emite "Sandbox listo"», y esa mención es prosa, no una
    // emisión — confundirlas haría fallar la prueba por la razón equivocada.
    const veces = (FUENTE_SEED.match(/Sandbox listo y VERIFICADO/g) ?? []).length
    expect(veces).toBe(1)
  })

  it('el chequeo usa el cliente admin, no uno con RLS encima', () => {
    // Con un cliente sujeto a RLS, 0 filas y «columna ausente» se parecen
    // demasiado. service_role separa esquema de permisos.
    expect(FUENTE_SEED).toContain('verificarEsquemaRecepcion(admin')
  })

  it('ningún mensaje de fallo del esquema puede contener la service_role', () => {
    const codigo = FUENTE_SEED.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    const iFn = codigo.indexOf('export async function verificarEsquemaRecepcion')
    const cuerpo = codigo.slice(iFn, iFn + 1200)
    expect(cuerpo).not.toMatch(/\bKEY\b|serviceKey|SERVICE_ROLE/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Alcance por proyecto: el fixture que iniciaba sesión y no podía trabajar.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO. `seedGateDeClase` creaba el proyecto y la unidad, y convergía
// `app_users`, `user_roles` y `role_permissions` — pero NUNCA escribía en
// `user_project_assignments`. El seed terminaba en 0 diciendo «Sandbox listo y
// VERIFICADO», PAQ iniciaba sesión sin problemas, y la app le respondía «No
// tienes ningún proyecto asignado».
//
// La causa está en `projects_select` (20260815000000): deja ver un proyecto a
// quien es `user_is_project_exempt()` O tiene `user_has_project_access()`. Un
// `operator` no es exento, así que sin asignación no ve NINGUNO. Login, empresa
// y permisos correctos; imposible trabajar.
import { seedGateDeClase, verificarGateDeClase } from '../seed-rls-sandbox.mjs'

/**
 * Base en memoria con lo que usa el seed: la cadena de `upsertPorMatch`
 * (select→eq→maybeSingle, insert→select→single), `upsert` con onConflict y
 * `delete` con eq/neq. Se guarda el estado de VERDAD para poder afirmar sobre
 * la convergencia entre dos corridas, no sobre las llamadas.
 */
function baseFalsa(inicial = {}) {
  const tablas = { ...inicial }
  let seq = 0
  const t = (n) => (tablas[n] ??= [])
  // `notIn` reproduce el filtro de PostgREST `not.in.("a","b")`, que es como el
  // seed borra los permisos sobrantes de un rol.
  const casa = (fila, filtros) => filtros.every(([op, k, v]) => {
    if (op === 'eq') return fila[k] === v
    if (op === 'neq') return fila[k] !== v
    if (op === 'notIn') {
      const vals = String(v).replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))
      return !vals.includes(fila[k])
    }
    return true
  })

  return {
    tablas,
    auth: {
      admin: {
        createUser: async ({ email }) => ({ data: { user: { id: `u-${email}` } }, error: null }),
        updateUserById: async () => ({ error: null }),
      },
    },
    from(nombre) {
      const filtros = []
      let modo = 'read'
      let payload = null
      const api = {
        select() { return api },
        eq(k, v) { filtros.push(['eq', k, v]); return api },
        neq(k, v) { filtros.push(['neq', k, v]); return api },
        not(k, op, v) {
          if (op !== 'in') throw new Error(`el doble sólo implementa not.in, no not.${op}`)
          filtros.push(['notIn', k, v]); return api
        },
        insert(fila) { modo = 'insert'; payload = fila; return api },
        upsert(fila) { modo = 'upsert'; payload = fila; return api },
        delete() { modo = 'delete'; return api },
        async maybeSingle() {
          const f = t(nombre).filter((r) => casa(r, filtros))
          return { data: f[0] ?? null, error: null }
        },
        async single() {
          if (modo === 'insert') {
            const fila = { id: `id-${++seq}`, ...payload }
            t(nombre).push(fila)
            return { data: fila, error: null }
          }
          const f = t(nombre).filter((r) => casa(r, filtros))
          return { data: f[0] ?? null, error: null }
        },
        then(res) {
          if (modo === 'delete') {
            tablas[nombre] = t(nombre).filter((r) => !casa(r, filtros))
            return Promise.resolve({ data: null, error: null }).then(res)
          }
          if (modo === 'upsert') {
            const iguales = (a, b) => Object.keys(payload).every((k) => a[k] === b[k])
            if (!t(nombre).some((r) => iguales(r, payload))) t(nombre).push({ id: `id-${++seq}`, ...payload })
            return Promise.resolve({ data: null, error: null }).then(res)
          }
          const f = t(nombre).filter((r) => casa(r, filtros))
          return Promise.resolve({ data: f, error: null }).then(res)
        },
      }
      return api
    },
  }
}

const buscarNulo = async () => null
const asigsDe = (base, email) =>
  (base.tablas['user_project_assignments'] ?? [])
    .filter((a) => a.user_id === `u-${email}`).map((a) => a.project_id)

describe('seedGateDeClase — alcance por proyecto', () => {
  it('PRIMERA corrida: PAQ y CORR quedan asignados al proyecto del fixture', async () => {
    const base = baseFalsa()
    const r = await seedGateDeClase(base, buscarNulo)

    expect(asigsDe(base, 'rls-paq@sandbox.invalid')).toEqual([r.projectId])
    expect(asigsDe(base, 'rls-corr@sandbox.invalid')).toEqual([r.projectId])
  })

  it('PRIMERA corrida: ADMIN y OWNER quedan SIN asignaciones explícitas', async () => {
    // Con una sola, `user_is_project_exempt` deja de aplicarles y pasan de ver
    // toda la empresa a ver sólo lo asignado — justo lo contrario del fixture.
    const base = baseFalsa()
    await seedGateDeClase(base, buscarNulo)

    expect(asigsDe(base, 'rls-admin@sandbox.invalid')).toEqual([])
    expect(asigsDe(base, 'rls-owner@sandbox.invalid')).toEqual([])
  })

  it('SEGUNDA corrida: converge y borra la asignación a un proyecto viejo', async () => {
    const base = baseFalsa()
    const r1 = await seedGateDeClase(base, buscarNulo)

    // Una corrida anterior (o una mano humana) dejó a PAQ en otro proyecto y al
    // ADMIN con una explícita. Sin converger, PAQ vería dos proyectos y el
    // ADMIN perdería la vista de empresa.
    base.tablas['user_project_assignments'].push(
      { id: 'x1', user_id: 'u-rls-paq@sandbox.invalid', project_id: 'proyecto-viejo' },
      { id: 'x2', user_id: 'u-rls-admin@sandbox.invalid', project_id: 'proyecto-viejo' },
    )

    const r2 = await seedGateDeClase(base, buscarNulo)
    expect(r2.projectId, 'el fixture es idempotente: mismo proyecto').toBe(r1.projectId)
    expect(asigsDe(base, 'rls-paq@sandbox.invalid')).toEqual([r1.projectId])
    expect(asigsDe(base, 'rls-admin@sandbox.invalid')).toEqual([])
  })

  it('SEGUNDA corrida: no duplica la asignación que ya era correcta', async () => {
    const base = baseFalsa()
    const r = await seedGateDeClase(base, buscarNulo)
    await seedGateDeClase(base, buscarNulo)
    expect(asigsDe(base, 'rls-corr@sandbox.invalid')).toEqual([r.projectId])
  })

  it('un fallo al converger el alcance ABORTA con un error que dice por qué', async () => {
    const base = baseFalsa()
    const original = base.from.bind(base)
    base.from = (n) => {
      if (n !== 'user_project_assignments') return original(n)
      const api = { select: () => api, eq: () => api, neq: () => api, delete: () => api, upsert: () => api,
        then: (res) => Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(res) }
      return api
    }
    await expect(seedGateDeClase(base, buscarNulo)).rejects.toThrow(/user_project_assignments|alcance por proyecto/)
  })
})

describe('verificarGateDeClase — el fixture tiene que poder trabajar', () => {
  /** Cliente de usuario doblado: decide qué proyectos ve cada quien. */
  function clienteUsuario({ ve = [], empresa, permisos = {} }) {
    return () => ({
      auth: {
        signInWithPassword: async () => ({ error: null }),
        signOut: async () => ({}),
      },
      rpc: async (fn, args) => {
        if (fn === 'get_my_company_id') return { data: empresa, error: null }
        return { data: permisos[args?.perm_key] ?? false, error: null }
      },
      from: () => {
        const api = {
          select: () => api,
          eq: (_k, v) => { api._id = v; return api },
          then: (res) => Promise.resolve({
            data: ve.includes(api._id) ? [{ id: api._id }] : [], error: null,
          }).then(res),
        }
        return api
      },
    })
  }

  // El conjunto COMPLETO que espera el verificador: base + acciones. Con sólo
  // las bases, estas pruebas fallarían por permisos y no por lo que quieren
  // medir (el alcance por proyecto).
  const PAQ_TAB = 'condominios.tab.paqueteria'
  const CORR_TAB = 'condominios.tab.correspondencia'
  const conAcciones = (propia, ajena) => ({
    [propia]: true, [`${propia}.create`]: true, [`${propia}.edit`]: true, [`${propia}.delete`]: false,
    [ajena]: false, [`${ajena}.create`]: false, [`${ajena}.edit`]: false, [`${ajena}.delete`]: false,
  })
  const PERMISOS_OK = {
    PAQ: conAcciones(PAQ_TAB, CORR_TAB),
    CORR: conAcciones(CORR_TAB, PAQ_TAB),
    ADMIN: { [PAQ_TAB]: true, [CORR_TAB]: true, [`${PAQ_TAB}.create`]: true, [`${CORR_TAB}.create`]: true },
    OWNER: { [PAQ_TAB]: true, [CORR_TAB]: true, [`${PAQ_TAB}.create`]: true, [`${CORR_TAB}.create`]: true },
  }

  async function verificar({ base, clase, ve }) {
    return verificarGateDeClase('https://x.supabase.co', 'anon', clase, base,
      clienteUsuario({ ve, empresa: clase.companyId, permisos: PERMISOS_OK[claseActual] }))
  }
  let claseActual = 'PAQ'

  /** Siembra de verdad y devuelve {base, clase}. */
  async function sembrado() {
    const base = baseFalsa()
    const clase = await seedGateDeClase(base, buscarNulo)
    return { base, clase }
  }

  it('un fixture BIEN sembrado no produce fallos de alcance', async () => {
    const { base, clase } = await sembrado()
    const fallos = []
    for (const u of clase.usuarios) {
      claseActual = u.key
      fallos.push(...await verificar({ base, clase: { ...clase, usuarios: [u] }, ve: [clase.projectId] }))
    }
    expect(fallos).toEqual([])
  })

  it('RECHAZA a un usuario que NO ve el proyecto (el síntoma de la UI)', async () => {
    const { base, clase } = await sembrado()
    claseActual = 'PAQ'
    const paq = clase.usuarios.find((u) => u.key === 'PAQ')
    const fallos = await verificar({ base, clase: { ...clase, usuarios: [paq] }, ve: [] })
    expect(fallos.some((f) => /No tienes ningún proyecto asignado/.test(f))).toBe(true)
  })

  it('RECHAZA a quien ve OTRO proyecto pero no el del fixture', async () => {
    const { base, clase } = await sembrado()
    claseActual = 'CORR'
    const corr = clase.usuarios.find((u) => u.key === 'CORR')
    const fallos = await verificar({ base, clase: { ...clase, usuarios: [corr] }, ve: ['otro-proyecto'] })
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toContain(clase.projectId)
  })

  it('RECHAZA una asignación de MÁS aunque vea el proyecto correcto', async () => {
    // Ver el del fixture no basta: una asignación extra le daría acceso a un
    // proyecto que el fixture no declara, y ninguna prueba lo notaría.
    const { base, clase } = await sembrado()
    base.tablas['user_project_assignments'].push(
      { id: 'x', user_id: 'u-rls-paq@sandbox.invalid', project_id: 'proyecto-de-mas' })
    claseActual = 'PAQ'
    const paq = clase.usuarios.find((u) => u.key === 'PAQ')
    const fallos = await verificar({ base, clase: { ...clase, usuarios: [paq] }, ve: [clase.projectId] })
    expect(fallos.some((f) => /proyecto-de-mas/.test(f))).toBe(true)
  })

  it('RECHAZA una asignación explícita en el ADMIN (le quita la exención)', async () => {
    const { base, clase } = await sembrado()
    base.tablas['user_project_assignments'].push(
      { id: 'y', user_id: 'u-rls-admin@sandbox.invalid', project_id: clase.projectId })
    claseActual = 'ADMIN'
    const admin = clase.usuarios.find((u) => u.key === 'ADMIN')
    const fallos = await verificar({ base, clase: { ...clase, usuarios: [admin] }, ve: [clase.projectId] })
    expect(fallos.some((f) => /exención/.test(f))).toBe(true)
  })

  it('RECHAZA si le FALTA la asignación, aunque el login y los permisos estén bien', async () => {
    const { base, clase } = await sembrado()
    base.tablas['user_project_assignments'] = base.tablas['user_project_assignments']
      .filter((a) => a.user_id !== 'u-rls-corr@sandbox.invalid')
    claseActual = 'CORR'
    const corr = clase.usuarios.find((u) => u.key === 'CORR')
    const fallos = await verificar({ base, clase: { ...clase, usuarios: [corr] }, ve: [] })
    expect(fallos.some((f) => /user_project_assignments/.test(f))).toBe(true)
  })
})

describe('el banner no puede salir con la UI sin proyecto', () => {
  it('el verificador del gate alimenta la misma lista que bloquea el banner', () => {
    expect(FUENTE_SEED).toContain('fallos.push(...await verificarGateDeClase(URL, ANON, clase, admin))')
  })

  it('el verificador recibe el cliente admin para leer las asignaciones', () => {
    // Sin él sólo podría mirar lo que el propio usuario ve, y una asignación de
    // más es invisible desde ahí.
    expect(FUENTE_SEED).toMatch(/verificarGateDeClase\(url, anon, clase, admin/)
  })

  it('el seed converge las asignaciones, no sólo roles y permisos', () => {
    expect(FUENTE_SEED).toMatch(/from\('user_project_assignments'\)\s*\n?\s*\.delete\(\)/)
    expect(FUENTE_SEED).toMatch(/from\('user_project_assignments'\)\s*\n?\s*\.upsert\(/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Permisos OPERACIONALES: ver la pestaña no es poder trabajar en ella.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO, encontrado en la validación visual. PAQ iniciaba sesión, veía
// «Proyecto sandbox CLASE», veía Paquetería y no Correspondencia… y no le
// aparecía «Registrar paquete».
//
// `canActInCondominiosTab` exige DOS permisos para dejar actuar: la clave base
// de la tab Y la de la acción (`condominios.tab.<tab>.<accion>`, derivadas en
// 20260703000000). El seed concedía sólo la base, y el verificador sólo miraba
// visibilidad — así que el fixture volvía a decir «Sandbox listo y VERIFICADO»
// sobre usuarios que no podían hacer su trabajo.
//
// Tercera vez la misma forma: comprobar lo escrito en vez de lo necesario.
import { CLASE_ROLES, upsertRolDeClase } from '../seed-rls-sandbox.mjs'

const PAQ_TAB = 'condominios.tab.paqueteria'
const CORR_TAB = 'condominios.tab.correspondencia'
const permisosDelRol = (base, roleId) =>
  (base.tablas['role_permissions'] ?? []).filter((r) => r.role_id === roleId)
    .map((r) => r.permission_key).sort()

describe('CLASE_ROLES — el conjunto declarado', () => {
  it('PAQ declara base + create + edit de paquetería, y nada más', () => {
    expect([...CLASE_ROLES.paq.permisos].sort()).toEqual(
      [PAQ_TAB, `${PAQ_TAB}.create`, `${PAQ_TAB}.edit`].sort())
  })

  it('CORR declara el inverso', () => {
    expect([...CLASE_ROLES.corr.permisos].sort()).toEqual(
      [CORR_TAB, `${CORR_TAB}.create`, `${CORR_TAB}.edit`].sort())
  })

  it('NINGUNO declara delete', () => {
    // El borrado de correspondencia va por ROL (sólo company_owner). Concederlo
    // a un granular volvería vacuos los escenarios de DELETE del harness.
    for (const rol of Object.values(CLASE_ROLES)) {
      expect(rol.permisos.some((k) => k.endsWith('.delete'))).toBe(false)
    }
  })

  it('NINGUNO declara permisos globales de plataforma', () => {
    // `canActInCondominiosTab` tiene un fallback a
    // platform.condominios.view + platform.condominios.<accion>. Concederlos
    // abriría TODAS las tabs de condominios de golpe y el gate por clase dejaría
    // de significar nada.
    for (const rol of Object.values(CLASE_ROLES)) {
      for (const k of rol.permisos) expect(k.startsWith('platform.')).toBe(false)
    }
  })

  it('ningún rol declara claves de la clase contraria', () => {
    expect(CLASE_ROLES.paq.permisos.some((k) => k.includes('correspondencia'))).toBe(false)
    expect(CLASE_ROLES.corr.permisos.some((k) => k.includes('paqueteria'))).toBe(false)
  })
})

describe('upsertRolDeClase — converge al conjunto exacto', () => {
  it('deja EXACTAMENTE las tres claves declaradas', async () => {
    const base = baseFalsa()
    const roleId = await upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq)
    expect(permisosDelRol(base, roleId)).toEqual(
      [PAQ_TAB, `${PAQ_TAB}.create`, `${PAQ_TAB}.edit`].sort())
  })

  it('una SEGUNDA corrida es idempotente: no duplica', async () => {
    const base = baseFalsa()
    const roleId = await upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq)
    await upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq)
    expect(permisosDelRol(base, roleId)).toHaveLength(3)
  })

  it('ELIMINA los permisos sobrantes de una corrida anterior', async () => {
    const base = baseFalsa()
    const roleId = await upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq)
    // Restos plausibles: un delete que alguien probó a mano, la clave de la
    // otra clase, y un global de plataforma que abriría todo.
    base.tablas['role_permissions'].push(
      { id: 'z1', role_id: roleId, permission_key: `${PAQ_TAB}.delete`, effect: 'allow' },
      { id: 'z2', role_id: roleId, permission_key: CORR_TAB, effect: 'allow' },
      { id: 'z3', role_id: roleId, permission_key: 'platform.condominios.view', effect: 'allow' },
    )
    await upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq)
    expect(permisosDelRol(base, roleId)).toEqual(
      [PAQ_TAB, `${PAQ_TAB}.create`, `${PAQ_TAB}.edit`].sort())
  })

  it('no toca los permisos de OTRO rol', async () => {
    const base = baseFalsa()
    const rPaq = await upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq)
    const rCorr = await upsertRolDeClase(base, 'emp-1', CLASE_ROLES.corr)
    expect(permisosDelRol(base, rPaq)).toHaveLength(3)
    expect(permisosDelRol(base, rCorr)).toEqual(
      [CORR_TAB, `${CORR_TAB}.create`, `${CORR_TAB}.edit`].sort())
  })

  it('un fallo de LIMPIEZA aborta y dice que concedería de más', async () => {
    const base = baseFalsa()
    const original = base.from.bind(base)
    base.from = (n) => {
      if (n !== 'role_permissions') return original(n)
      const api = { select: () => api, eq: () => api, neq: () => api, not: () => api,
        delete: () => api, upsert: () => api,
        then: (res) => Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(res) }
      return api
    }
    await expect(upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq))
      .rejects.toThrow(/limpieza[\s\S]*concedería de más/)
  })

  it('un fallo al INSERTAR una acción aborta nombrando la clave', async () => {
    const base = baseFalsa()
    const original = base.from.bind(base)
    base.from = (n) => {
      const api = original(n)
      if (n !== 'role_permissions') return api
      const upsertReal = api.upsert.bind(api)
      api.upsert = (fila) => {
        if (String(fila.permission_key).endsWith('.create')) {
          return { then: (res) => Promise.resolve({ data: null, error: { message: 'fk violation' } }).then(res) }
        }
        return upsertReal(fila)
      }
      return api
    }
    await expect(upsertRolDeClase(base, 'emp-1', CLASE_ROLES.paq))
      .rejects.toThrow(/\.create[\s\S]*botones de crear\/editar/)
  })
})

describe('el seed completo concede las acciones a quien toca', () => {
  it('PAQ y CORR acaban con sus tres claves, sin cruzarse', async () => {
    const base = baseFalsa()
    await seedGateDeClase(base, buscarNulo)
    const roles = base.tablas['roles'] ?? []
    const idPaq = roles.find((r) => r.name === CLASE_ROLES.paq.nombre).id
    const idCorr = roles.find((r) => r.name === CLASE_ROLES.corr.nombre).id

    expect(permisosDelRol(base, idPaq)).toEqual([PAQ_TAB, `${PAQ_TAB}.create`, `${PAQ_TAB}.edit`].sort())
    expect(permisosDelRol(base, idCorr)).toEqual([CORR_TAB, `${CORR_TAB}.create`, `${CORR_TAB}.edit`].sort())
  })

  it('el conjunto TOTAL de role_permissions es exacto: seis filas, ni una más', async () => {
    const base = baseFalsa()
    await seedGateDeClase(base, buscarNulo)
    expect(base.tablas['role_permissions']).toHaveLength(6)
  })
})

describe('verificarGateDeClase — exige los permisos operacionales', () => {
  /** Cliente de usuario que responde el mapa de permisos que se le dé. */
  const clienteCon = (permisos, empresa, proyecto) => () => ({
    auth: { signInWithPassword: async () => ({ error: null }), signOut: async () => ({}) },
    rpc: async (fn, args) => fn === 'get_my_company_id'
      ? { data: empresa, error: null }
      : { data: permisos[args?.perm_key] ?? false, error: null },
    from: () => {
      const api = { select: () => api, eq: (_k, v) => { api._id = v; return api },
        then: (res) => Promise.resolve({ data: api._id === proyecto ? [{ id: proyecto }] : [], error: null }).then(res) }
      return api
    },
  })

  const completo = (propia, ajena) => ({
    [propia]: true, [`${propia}.create`]: true, [`${propia}.edit`]: true, [`${propia}.delete`]: false,
    [ajena]: false, [`${ajena}.create`]: false, [`${ajena}.edit`]: false, [`${ajena}.delete`]: false,
  })

  async function fallosDe(permisos, key = 'PAQ') {
    const base = baseFalsa()
    const clase = await seedGateDeClase(base, buscarNulo)
    const u = clase.usuarios.find((x) => x.key === key)
    return verificarGateDeClase('https://x.supabase.co', 'anon', { ...clase, usuarios: [u] }, base,
      clienteCon(permisos, clase.companyId, clase.projectId))
  }

  it('con el conjunto completo no hay fallos', async () => {
    expect(await fallosDe(completo(PAQ_TAB, CORR_TAB))).toEqual([])
  })

  it('FALLA si falta .create — el caso exacto del botón que no aparecía', async () => {
    const p = completo(PAQ_TAB, CORR_TAB)
    p[`${PAQ_TAB}.create`] = false
    const fallos = await fallosDe(p)
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toContain('.create')
    expect(fallos[0]).toMatch(/NO muestra el botón/)
  })

  it('FALLA si falta .edit', async () => {
    const p = completo(PAQ_TAB, CORR_TAB)
    p[`${PAQ_TAB}.edit`] = false
    const fallos = await fallosDe(p)
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toContain('.edit')
  })

  it('FALLA si tiene una acción de la clase CONTRARIA', async () => {
    const p = completo(PAQ_TAB, CORR_TAB)
    p[`${CORR_TAB}.create`] = true
    const fallos = await fallosDe(p)
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toMatch(/clase ajena|rompe el gate/)
  })

  it('FALLA si le concedieron delete', async () => {
    const p = completo(PAQ_TAB, CORR_TAB)
    p[`${PAQ_TAB}.delete`] = true
    expect(await fallosDe(p)).toHaveLength(1)
  })

  it('el inverso vale para CORR', async () => {
    expect(await fallosDe(completo(CORR_TAB, PAQ_TAB), 'CORR')).toEqual([])
    const p = completo(CORR_TAB, PAQ_TAB)
    p[`${CORR_TAB}.create`] = false
    expect(await fallosDe(p, 'CORR')).toHaveLength(1)
  })

  it('con la clave BASE pero sin acciones falla: es el falso positivo original', async () => {
    // Exactamente el estado que producía el seed viejo.
    const fallos = await fallosDe({ [PAQ_TAB]: true })
    expect(fallos.length).toBeGreaterThanOrEqual(2)
    expect(fallos.some((f) => f.includes('.create'))).toBe(true)
    expect(fallos.some((f) => f.includes('.edit'))).toBe(true)
  })
})

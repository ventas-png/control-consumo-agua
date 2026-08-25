// Pruebas de la CAPA DE AUTORIZACIÓN de notify-package.
//
// Lo que se prueba aquí no es una función pura con objetos armados a mano: es
// el camino real que corre el handler. El único doble es el cliente Supabase, y
// se dobla al nivel de `.rpc()` — es decir, respondiendo lo que respondería la
// base — para poder ejercitar lo que ningún objeto en memoria puede: que la
// consulta FALLE.
//
// Ese es el caso que hundía a la versión anterior. Pedía `role_permissions`
// incrustado desde `user_roles`, PostgREST devolvía error porque no hay FK que
// resuelva esa incrustación, y el código sólo leía `data`: la lista de permisos
// quedaba vacía y eso se tomaba como una decisión de autorización en vez de
// como un fallo. Aquí un error de consulta tiene su propio veredicto.
import { describe, it, expect } from 'vitest'
import { autorizarAviso, type ClienteRpc, type RespuestaRpc } from '../autorizacion.ts'

const EMPRESA = 'emp-1'
const PROYECTO = 'proy-1'
const CORR = { company_id: EMPRESA, project_id: PROYECTO, clase: 'correspondencia' }
const PAQ = { company_id: EMPRESA, project_id: PROYECTO, clase: 'paquete' }

type Respuestas = Record<string, RespuestaRpc | (() => RespuestaRpc)>

/**
 * Cliente falso que responde como la base. `permisos` fija qué devuelve
 * `user_has_permission` para cada clave — igual que haría el helper real, deny
 * incluido, porque el deny se resuelve DENTRO de la base y llega como `false`.
 */
function cliente(opciones: {
  superAdmin?: boolean
  empresa?: string | null
  proyectoOk?: boolean
  permisos?: Record<string, boolean>
  crudo?: Respuestas
}): ClienteRpc & { llamadas: Array<{ fn: string; args?: Record<string, unknown> }> } {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const base: Respuestas = {
    is_super_admin: { data: opciones.superAdmin ?? false, error: null },
    get_my_company_id: { data: opciones.empresa === undefined ? EMPRESA : opciones.empresa, error: null },
    can_access_project: { data: opciones.proyectoOk ?? true, error: null },
    user_has_permission: { data: null, error: null },
  }
  const respuestas = { ...base, ...(opciones.crudo ?? {}) }

  return {
    llamadas,
    rpc(fn: string, args?: Record<string, unknown>): Promise<RespuestaRpc> {
      llamadas.push({ fn, args })
      if (fn === 'user_has_permission' && !opciones.crudo?.user_has_permission) {
        const clave = String(args?.perm_key ?? '')
        return Promise.resolve({ data: opciones.permisos?.[clave] ?? false, error: null })
      }
      const r = respuestas[fn]
      return Promise.resolve(typeof r === 'function' ? r() : r ?? { data: null, error: null })
    },
  }
}

describe('notify-package/autorizarAviso — permiso por clase', () => {
  it('un operador de PAQUETERÍA no puede avisar correspondencia', async () => {
    const c = cliente({ permisos: { 'condominios.tab.paqueteria': true } })
    expect(await autorizarAviso(c, CORR)).toEqual({
      ok: false, motivo: 'sin_permiso_de_clase', detalle: 'falta condominios.tab.correspondencia',
    })
  })

  it('un operador de CORRESPONDENCIA autorizado sí puede avisarla', async () => {
    const c = cliente({ permisos: { 'condominios.tab.correspondencia': true } })
    expect(await autorizarAviso(c, CORR)).toEqual({ ok: true })
    // Y preguntó por la clave de la clase, no por otra.
    expect(c.llamadas.find(l => l.fn === 'user_has_permission')?.args)
      .toEqual({ perm_key: 'condominios.tab.correspondencia' })
  })

  it('la simetría también se cumple: correspondencia no avisa paquetería', async () => {
    const c = cliente({ permisos: { 'condominios.tab.correspondencia': true } })
    expect(await autorizarAviso(c, PAQ)).toMatchObject({ ok: false, motivo: 'sin_permiso_de_clase' })
  })

  it('una clase desconocida cae en el permiso de paquetería, no en "todo permitido"', async () => {
    const c = cliente({ permisos: { 'condominios.tab.paqueteria': true } })
    expect(await autorizarAviso(c, { ...PAQ, clase: 'lo-que-sea' })).toEqual({ ok: true })
    const c2 = cliente({ permisos: {} })
    expect(await autorizarAviso(c2, { ...PAQ, clase: 'lo-que-sea' })).toMatchObject({ ok: false })
  })
})

describe('notify-package/autorizarAviso — deny explícito', () => {
  // El deny-over-allow lo resuelve `user_has_permission` DENTRO de la base
  // (20260518000008: la rama de deny se evalúa antes que la de allow). Lo que
  // esta capa tiene que garantizar es que no lo contradiga: preguntar y
  // obedecer. La versión anterior recolectaba sólo los `effect='allow'`, así
  // que un usuario con un rol que concede y otro que veta quedaba AUTORIZADO
  // aquí y denegado en la base.
  //
  // Que la base efectivamente haga ganar al deny se prueba contra Postgres real
  // en scripts/rls-evidencias-asserts.sql (bloque 9).
  it('si la base dice false, se deniega — aunque el rol tuviera un allow', async () => {
    const c = cliente({
      crudo: { user_has_permission: { data: false, error: null } },
    })
    expect(await autorizarAviso(c, CORR)).toMatchObject({ ok: false, motivo: 'sin_permiso_de_clase' })
  })

  it('no se consulta ninguna tabla de permisos: sólo el helper', async () => {
    // Si esta capa volviera a leer `user_roles`/`role_permissions` por su
    // cuenta, volvería a poder divergir. El contrato es que NO lo hace.
    const c = cliente({ permisos: { 'condominios.tab.correspondencia': true } })
    await autorizarAviso(c, CORR)
    expect(c.llamadas.map(l => l.fn).sort()).toEqual(
      ['can_access_project', 'get_my_company_id', 'is_super_admin', 'user_has_permission'],
    )
  })
})

describe('notify-package/autorizarAviso — fail-closed', () => {
  const CASOS: Array<[string, RespuestaRpc | (() => RespuestaRpc)]> = [
    ['error de PostgREST', { data: null, error: { message: 'could not find relationship' } }],
    ['data nula sin error', { data: null, error: null }],
    ['data que no es booleana', { data: [], error: null }],
    ['excepción de red', () => { throw new Error('fetch failed') }],
  ]

  for (const [nombre, respuesta] of CASOS) {
    it(`user_has_permission con ${nombre} deniega, y NO como "permisos vacíos"`, async () => {
      const c = cliente({ crudo: { user_has_permission: respuesta } })
      const v = await autorizarAviso(c, CORR)
      expect(v.ok).toBe(false)
      // El motivo importa: el handler responde 503 ante `error_autorizacion` y
      // 403 ante una denegación real. Confundirlos le diría al operador que le
      // falta un permiso que sí tiene.
      expect(v).toMatchObject({ motivo: 'error_autorizacion' })
    })

    it(`can_access_project con ${nombre} también falla cerrado`, async () => {
      const c = cliente({
        permisos: { 'condominios.tab.correspondencia': true },
        crudo: { can_access_project: respuesta },
      })
      expect(await autorizarAviso(c, CORR)).toMatchObject({ ok: false, motivo: 'error_autorizacion' })
    })

    it(`is_super_admin con ${nombre} también falla cerrado`, async () => {
      const c = cliente({
        permisos: { 'condominios.tab.correspondencia': true },
        crudo: { is_super_admin: respuesta },
      })
      expect(await autorizarAviso(c, CORR)).toMatchObject({ ok: false, motivo: 'error_autorizacion' })
    })
  }

  it('get_my_company_id que falla no se convierte en "otra empresa"', async () => {
    const c = cliente({ crudo: { get_my_company_id: { data: null, error: { message: 'boom' } } } })
    expect(await autorizarAviso(c, CORR)).toMatchObject({ ok: false, motivo: 'error_autorizacion' })
  })

  it('sin cliente con JWT no se autoriza nada', async () => {
    expect(await autorizarAviso(null, CORR)).toMatchObject({ ok: false, motivo: 'sin_cliente' })
  })

  it('un fallo temprano corta: no se sigue preguntando', async () => {
    const c = cliente({ crudo: { is_super_admin: { data: null, error: { message: 'boom' } } } })
    await autorizarAviso(c, CORR)
    expect(c.llamadas.map(l => l.fn)).toEqual(['is_super_admin'])
  })
})

describe('notify-package/autorizarAviso — empresa y proyecto', () => {
  it('la pieza de otra empresa se deniega', async () => {
    const c = cliente({ empresa: 'otra-empresa', permisos: { 'condominios.tab.correspondencia': true } })
    expect(await autorizarAviso(c, CORR)).toMatchObject({ ok: false, motivo: 'otra_empresa' })
  })

  it('una pieza sin empresa no se autoriza por omisión', async () => {
    const c = cliente({ permisos: { 'condominios.tab.correspondencia': true } })
    expect(await autorizarAviso(c, { ...CORR, company_id: null }))
      .toMatchObject({ ok: false, motivo: 'otra_empresa' })
  })

  it('el proyecto no asignado se deniega, y lo decide la base', async () => {
    const c = cliente({ proyectoOk: false, permisos: { 'condominios.tab.correspondencia': true } })
    expect(await autorizarAviso(c, CORR)).toMatchObject({ ok: false, motivo: 'proyecto_no_asignado' })
    expect(c.llamadas.find(l => l.fn === 'can_access_project')?.args).toEqual({ p_project_id: PROYECTO })
  })

  it('el proyecto nulo se le pasa tal cual al helper (que lo trata como ambiguo)', async () => {
    const c = cliente({ permisos: { 'condominios.tab.paqueteria': true } })
    await autorizarAviso(c, { ...PAQ, project_id: null })
    expect(c.llamadas.find(l => l.fn === 'can_access_project')?.args).toEqual({ p_project_id: null })
  })
})

describe('notify-package/autorizarAviso — super_admin', () => {
  it('conserva su comportamiento legítimo: atiende empresas ajenas', async () => {
    // Soporte tiene que poder actuar sobre el tenant de un cliente. Se resuelve
    // ANTES de comparar empresas, igual que en la RPC del acuse.
    const c = cliente({ superAdmin: true, empresa: 'otra-empresa', permisos: {} })
    expect(await autorizarAviso(c, CORR)).toEqual({ ok: true })
    expect(c.llamadas.map(l => l.fn)).toEqual(['is_super_admin'])
  })

  it('pero el privilegio lo declara la BASE, no un campo del perfil', async () => {
    // La versión anterior miraba `perfil.role === 'super_admin'` sobre una fila
    // que ella misma había leído con service_role. Ahora lo dice `is_super_admin()`
    // evaluado con el JWT del llamante: si la base dice que no, no lo es.
    const c = cliente({ superAdmin: false, empresa: 'otra-empresa', permisos: {} })
    expect(await autorizarAviso(c, CORR)).toMatchObject({ ok: false, motivo: 'otra_empresa' })
  })
})

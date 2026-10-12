// domain/empresa/usuarios.ts — Escrituras de gestión de usuarios del tenant
// (T7/PR3). Baja a domain/ las operaciones que vivían inline en
// EmpresaUsuariosSection y AsignacionModal: alta/baja de usuario (edges
// create-user/delete-user con el token de la sesión), activar/desactivar
// (app_users) y la asignación de proyectos (user_project_assignments). El armado
// del payload, los diálogos y los toasts se quedan en la UI.
import { supabase } from '../../lib/supabase'

/** Activa o desactiva un usuario (app_users.activo). */
export async function setUsuarioActivo(
  userId: string,
  activo: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('app_users').update({ activo }).eq('id', userId)
  return { error: error?.message ?? null }
}

// ── Asignación de proyectos (user_project_assignments) ──

/** Proyectos asignados a un usuario (ids). */
export async function fetchUserProjectAssignments(
  userId: string,
): Promise<{ data: Array<{ project_id: string }> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('user_project_assignments')
    .select('project_id')
    .eq('user_id', userId)
  return { data: (data as Array<{ project_id: string }>) ?? null, error: error?.message ?? null }
}

/**
 * Borra todas las asignaciones de proyecto de un usuario.
 * @deprecated La pantalla ya NO lo usa: usa `guardarAsignacionesProyecto`. Borrar todo antes de insertar deja una ventana con CERO
 * asignaciones (si la segunda petición falla, un administrador queda sin filas y por eso «exento»: ve toda la empresa), borra también
 * lo que quien edita no ve y pisa los cambios de otro administrador. Se conserva por compatibilidad y por sus pruebas.
 */
export async function deleteUserProjectAssignments(
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_project_assignments')
    .delete()
    .eq('user_id', userId)
  return { error: error?.message ?? null }
}

/**
 * Inserta asignaciones de proyecto (filas ya armadas por la UI).
 * @deprecated La pantalla usa `guardarAsignacionesProyecto` (INSERT … ON CONFLICT DO NOTHING, sin error si otro administrador ya la
 * asignó). Un `insert` plano falla con 23505 ante una asignación ya existente. Se conserva por compatibilidad y por sus pruebas.
 */
export async function insertUserProjectAssignments(
  rows: Array<Record<string, unknown>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('user_project_assignments').insert(rows)
  return { error: error?.message ?? null }
}

// ── Guardado de asignaciones por DIFERENCIAS DE TRES VÍAS ────────────────────────────────────────────────────
// Antes la pantalla «borraba todas las de la persona y volvía a insertar las marcadas»: dos peticiones, y si la segunda fallaba la
// primera ya había valido (la persona se quedaba con CERO asignaciones, y un administrador sin filas es «exento»: ve toda la
// empresa). Además recreaba las filas que no cambiaban (otro id, otro created_at, permission_type vuelto a «total»).
//
// Ahora la diferencia se calcula contra el conjunto INICIAL: lo que había cuando se abrió la pantalla, no contra una lectura nueva al
// guardar. Así sólo se escribe lo que la persona cambió en pantalla y dos administradores a la vez no se deshacen el trabajo:
//     insertar = deseadas  \ inicial                 (marcó algo que no había)
//     borrar   = (inicial \ deseadas) ∩ editables    (desmarcó algo que había Y que ella puede ver y tocar)
// Se INSERTA primero (ON CONFLICT DO NOTHING: si otro administrador ya lo asignó no es un error y su fila se conserva) y se BORRA después,
// y se comprueba con una lectura posterior: la RLS puede filtrar un DELETE y contestar «0 filas» sin error, y eso no es «guardado».

// ── El PRINCIPAL de la empresa ────────────────────────────────────────────────────────────────────────────────
// Decisión del dueño del negocio (2026-10-11): quien asigna proyectos, permisos (roles y llaves) y administradores, y quien crea proyectos, es «el que tiene los permisos
// de la empresa y todos los proyectos»: el PRINCIPAL = el propietario (app_users.role 'company_owner', dentro de SU empresa) o el superadministrador ('super_admin' /
// 'superadmin', cualquier empresa). Un administrador —acotado o sin filas, «exento»— NO lo es, ni quien sólo tenga un rol RBAC de administrador: se mira el rol de
// app_users y nada más. El servidor manda (public.asignacion_puede_administrar y las políticas de la migración 20261026000700); esto sólo evita ofrecer lo que será rechazado.
const ROLES_PRINCIPALES = ['company_owner', 'super_admin', 'superadmin']

/** ¿Este rol es el PRINCIPAL de la empresa (propietario o superadministrador)? Un administrador, acotado o exento, NO. */
export function esPrincipalEmpresa(role?: string | null): boolean {
  return !!role && ROLES_PRINCIPALES.includes(role)
}

/** Lo que se dice a quien no es el principal ante cualquier cosa que sólo el principal puede hacer (asignar proyectos, permisos y administradores; crear proyectos). */
export const MOTIVO_SOLO_PRINCIPAL = 'Solo el propietario de la empresa asigna proyectos, permisos y administradores.'

/** Lo que se dice cuando quien no es el principal intenta crear un proyecto. */
export const MOTIVO_SOLO_PRINCIPAL_PROYECTOS = 'Solo el propietario de la empresa crea proyectos.'

/** ¿Puede este rol crear proyectos? Sólo el principal (projects_insert, migración 20261026000700). La configuración fiscal y de cobros de un proyecto SIGUE abierta al administrador (projects_update no cambió). */
export function puedeCrearProyectos(role?: string | null): boolean {
  return esPrincipalEmpresa(role)
}

/**
 * ¿Ve este rol el asistente del primer proyecto (SetupWizard)? El propietario de una empresa sin proyectos. Un administrador ya no: el servidor le rechazaría el INSERT
 * (projects_insert es del principal) y el asistente fallaría al final. El superadministrador administra las empresas desde /superadmin: no se le abre el asistente.
 */
export function veAsistentePrimerProyecto(role?: string | null): boolean {
  return role === 'company_owner'
}

/**
 * ¿Hay que abrir el asistente del primer proyecto (SetupWizard)? Toda la compuerta de App.tsx en una función pura: los datos YA cargaron (si no, parpadearía), quien mira es el
 * propietario (`veAsistentePrimerProyecto`), ve la empresa entera (`veEmpresaEntera`: para quien está acotado a sus proyectos, «no veo ninguno» no significa «la empresa no tiene»),
 * tiene empresa y la empresa no tiene ningún proyecto. Cualquier otro caso —incluido un administrador, aunque sea «exento», o un rol con otra grafía— no lo ve.
 */
export function necesitaAsistentePrimerProyecto(input: {
  cargando: boolean
  role?: string | null
  veEmpresaEntera: boolean
  companyId?: string | null
  totalProyectos: number
}): boolean {
  return !input.cargando
    && veAsistentePrimerProyecto(input.role)
    && input.veEmpresaEntera
    && !!input.companyId
    && input.totalProyectos === 0
}

/** Roles a los que el edge delete-user deja eliminar a quien no es superadministrador (espejo de DELETABLE_ROLES de supabase/functions/delete-user/validate.ts). */
export const ROLES_ELIMINABLES = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

/** Lo que `puedeEliminarUsuario` necesita de cada lado: el rol y la empresa (app_users.role / app_users.company_id). */
export interface PersonaEliminacion {
  role: string | null | undefined
  company_id: string | null | undefined
}

/**
 * ¿Se ofrece «Eliminar» sobre esa persona? Espeja canManageUsers + el gate de delete-user (checkDeleteTargetGate), en su mismo orden: el superadministrador, a cualquiera
 * (de cualquier empresa, también sin la suya); quien no lo es, SÓLO dentro de su propia empresa —sin empresa (company_id null o vacío) no tiene «su empresa» y no elimina a
 * nadie (VEDGE-06; el servidor lo deniega desde V8-06 b)—; ahí el propietario, a los roles eliminables, y el administrador, a los eliminables MENOS otro administrador (E-07:
 * la función borra con service_role, saltándose user_roles_delete y roles_delete, que son del principal; a los administradores los puso el principal). Nadie más elimina.
 * El servidor es el que manda; esto sólo evita ofrecer lo que será rechazado.
 */
export function puedeEliminarUsuario(actor: PersonaEliminacion, objetivo: PersonaEliminacion): boolean {
  if (actor.role === 'super_admin' || actor.role === 'superadmin') return true
  if (actor.role !== 'company_owner' && actor.role !== 'admin') return false
  if (!actor.company_id || objetivo.company_id !== actor.company_id) return false
  if (!objetivo.role || !ROLES_ELIMINABLES.includes(objetivo.role)) return false
  if (objetivo.role === 'admin') return actor.role === 'company_owner'
  return true
}

/** Lo que el servidor devuelve (ASIGNACION_PROPIA_NO_PERMITIDA) cuando alguien intenta cambiar sus propias asignaciones. */
export const MOTIVO_AUTOASIGNACION =
  'No puedes cambiar tus propios proyectos. Pídele el cambio al propietario de la empresa o al superadministrador.'

/** Lo que se dice cuando una parte de los cambios SÍ se aplicó y otra no. */
export const AVISO_GUARDADO_PARCIAL = 'Se aplicó una parte de los cambios y otra no. Vuelve a guardar para completar el resto.'

/** Lo que se dice cuando una escritura terminó SIN respuesta de la base: la petición pudo llegar y aplicarse (V3-02). */
export const AVISO_RESULTADO_INCIERTO =
  'No se pudo confirmar si los cambios se aplicaron. Se vuelve a leer lo que hay guardado: revisa las casillas y guarda de nuevo.'

const MENSAJE_ERROR_RED = 'No se pudieron guardar las asignaciones. Revisa tu conexión e intenta de nuevo.'

/**
 * ¿Puede `actor` editar las asignaciones de proyecto de `objetivo`? Espeja la regla del servidor (public.asignacion_puede_administrar, migración 20261026000600): SÓLO el principal
 * de la empresa (propietario o superadministrador) las escribe, también las suyas (es exento: su alcance no cambia). Quien no lo es no edita a NADIE —un administrador,
 * acotado o exento, tampoco a un operador ni a otro administrador— y en su propia fila se conserva el motivo de la autoedición. El servidor es el que manda; esto sólo evita
 * ofrecer lo que será rechazado.
 */
export function puedeEditarAsignaciones(
  actor: { id: string; role: string },
  objetivo: { id: string },
): { permitido: boolean; motivo: string | null } {
  if (esPrincipalEmpresa(actor.role)) return { permitido: true, motivo: null }
  if (actor.id === objetivo.id) return { permitido: false, motivo: MOTIVO_AUTOASIGNACION }
  return { permitido: false, motivo: MOTIVO_SOLO_PRINCIPAL }
}

/** Traduce el error de la base (códigos estables de la migración 20261026000600, o el 42501 de la RLS) a un mensaje útil. */
export function mensajeErrorAsignacion(
  error: { code?: string | null; message?: string | null } | null | undefined,
): string | null {
  if (!error) return null
  const texto = error.message ?? ''
  if (texto.includes('ASIGNACION_PROPIA_NO_PERMITIDA')) return MOTIVO_AUTOASIGNACION
  if (texto.includes('ASIGNACION_EMPRESA_DISTINTA')) return 'La persona y el proyecto deben pertenecer a la misma empresa.'
  if (error.code === '42501' || /row-level security|permission denied/i.test(texto)) {
    return 'No tienes permiso para cambiar estas asignaciones. Solo el propietario de la empresa (o el superadministrador) asigna proyectos, y solo a personas y proyectos de su empresa.'
  }
  return 'No se pudieron guardar las asignaciones. Intenta de nuevo.'
}

/**
 * Qué insertar y qué borrar para pasar de `inicial` (lo que había al abrir la pantalla) a `deseadas` (lo que quedó marcado).
 * `editables` son los proyectos que la pantalla muestra: sólo se borra lo que está dentro, nunca una asignación a un proyecto que
 * quien edita no ve. Es una diferencia de TRES vías cuando `inicial` es el conjunto leído al abrir (no una lectura nueva al guardar).
 */
export function diferenciaAsignaciones(
  inicial: readonly string[],
  deseadas: readonly string[],
  editables?: readonly string[],
): { insertar: string[]; borrar: string[] } {
  const hay = new Set(inicial)
  const quiero = new Set(deseadas)
  const dentro = editables ? new Set(editables) : null
  return {
    insertar: [...quiero].filter(id => !hay.has(id)),
    borrar: [...hay].filter(id => !quiero.has(id) && (dentro === null || dentro.has(id))),
  }
}

/**
 * Las casillas que debe mostrar el modal tras RELEER lo que hay en la base después de un guardado parcial o incierto (H1, ronda 4). Fusión de TRES vías:
 *
 *   casillas nuevas = (inicial NUEVO \ lo que la persona QUITÓ) ∪ (lo que la persona AÑADIÓ), limitada a los proyectos `editables`
 *   quitó = `inicialAnterior` \ `casillas`        añadió = `casillas` \ `inicialAnterior`
 *
 * Es decir: un proyecto que la persona NO tocó (su casilla sigue igual que en el `inicial` con el que se abrió) toma lo que HAY ahora en la base, con lo que un cambio hecho por
 * OTRO administrador entretanto aparece reflejado y el siguiente «Guardar» sin tocar nada no lo deshace (ni borra una asignación ajena que la persona nunca vio, ni reinserta una
 * que el otro acababa de revocar); y uno que SÍ tocó conserva su elección, apliqué o no el servidor esa escritura (lo que falta por escribir es justo la diferencia contra el
 * `inicial` nuevo). Sólo cuentan los `editables` (los que la pantalla muestra): una asignación a un proyecto que no se muestra no se pinta ni se toca. No muta sus entradas.
 */
export function reconciliarCasillas(
  inicialAnterior: readonly string[],
  inicialNuevo: readonly string[],
  casillas: ReadonlySet<string> | readonly string[],
  editables: readonly string[],
): Set<string> {
  const antes = new Set(inicialAnterior)
  const ahora = new Set(inicialNuevo)
  const marcadas = new Set(casillas)
  const resultado = new Set<string>()
  for (const id of editables) {
    const quito = antes.has(id) && !marcadas.has(id)
    const anadio = !antes.has(id) && marcadas.has(id)
    if ((ahora.has(id) && !quito) || anadio) resultado.add(id)
  }
  return resultado
}

/**
 * Resultado del guardado. `parcial` = la base PUDO cambiar aunque el guardado falló (una parte de los cambios SÍ se aplicó, o una escritura terminó sin respuesta y
 * pudo aplicarse): la lista de atrás debe recargarse, quien llama debe RELEER lo que hay (ése es el nuevo «antes») y se puede volver a guardar.
 * `incierto` (sólo con `parcial`) = ninguna escritura se confirmó pero una terminó sin respuesta de la base: no se sabe si se aplicó.
 */
export interface ResultadoGuardadoAsignaciones {
  error: string | null
  parcial: boolean
  incierto?: boolean
}

/** Lo que una escritura de @supabase/postgrest-js resuelve: `status` 0 y un error SIN código («TypeError: Failed to fetch») ante un fallo de red (no lanza). */
interface RespuestaEscritura {
  error: { code?: string | null; message?: string | null } | null
  status?: number | null
}

/** Un SQLSTATE: cinco caracteres, dígitos y letras MAYÚSCULAS ASCII («42501», «23514», «55P03», «57014»…). */
const SQLSTATE = /^[0-9A-Z]{5}$/
/** Un código de error de PostgREST: «PGRST» y tres dígitos («PGRST301», «PGRST116»…). */
const CODIGO_POSTGREST = /^PGRST\d{3}$/

/**
 * ¿Una escritura que devolvió `error` pudo haberse aplicado de todos modos? Sólo una respuesta DEFINITIVA de la base deja claro que no: una sentencia que falla se deshace entera
 * (la RLS 42501, los triggers 23514/42501, 23505, un tiempo agotado 57014/55P03…), y esa respuesta trae un código con forma de SQLSTATE (cinco caracteres, dígitos y mayúsculas) o
 * de PostgREST (`PGRSTnnn`). CUALQUIER otro `code` no prueba nada (H5, ronda 4): el de una pasarela o un proxy —numérico como 504, o en palabras como «upstream_timeout»— no
 * viene de la base, y la petición pudo llegar y aplicarse antes de perderse la respuesta. Tampoco lo prueban `status` 0, un error SIN código como el «TypeError: Failed to
 * fetch» que postgrest-js DEVUELVE (no lanza) ante un fallo de red, un AbortError, ni una pasarela que contesta 502/504 con HTML: todo eso es AMBIGUO (V3-02, misma familia que
 * F2-01). Quien lo recibe no debe suponer que «no se aplicó nada».
 */
export function escrituraAmbigua(error: RespuestaEscritura['error'] | undefined, status?: number | null): boolean {
  if (!error) return false
  if (status === 0) return true
  const code: unknown = error.code
  return !(typeof code === 'string' && (SQLSTATE.test(code) || CODIGO_POSTGREST.test(code)))
}

/** Ejecuta una escritura sin dejar que lance y dice si su desenlace es ambiguo (excepción de red, `status` 0, error sin código o con un código que no es de la base: `escrituraAmbigua`). */
async function escribir(peticion: () => PromiseLike<RespuestaEscritura>): Promise<{ error: RespuestaEscritura['error']; ambiguo: boolean }> {
  try {
    const { error, status } = await peticion()
    return { error: error ?? null, ambiguo: escrituraAmbigua(error, status) }
  } catch (e) {
    return { error: { code: '', message: e instanceof Error ? e.message : 'sin respuesta' }, ambiguo: true }
  }
}

/**
 * Deja las asignaciones de `userId` como `deseadas` (dentro de `editables`) a partir de lo que había al abrir (`inicial`): inserta las
 * que faltan, borra las que sobran y lo comprueba con una lectura posterior. Las filas que no cambian no se tocan (mismo id,
 * created_at y permission_type), y lo que otro administrador cambió mientras tanto tampoco.
 * NO lanza: devuelve `error` ya traducido para mostrarlo tal cual y `parcial` si una parte llegó a aplicarse. Reintentar es seguro
 * (idempotente): vuelve a calcular contra el mismo `inicial`.
 */
export async function guardarAsignacionesProyecto(
  userId: string,
  inicial: readonly string[],
  deseadas: readonly string[],
  editables: readonly string[],
): Promise<ResultadoGuardadoAsignaciones> {
  const { insertar, borrar } = diferenciaAsignaciones(inicial, deseadas, editables)
  if (insertar.length === 0 && borrar.length === 0) return { error: null, parcial: false }

  let escribio = false      // ¿alguna escritura ya se confirmó con una respuesta de la base? (si algo falla después, el guardado es PARCIAL)
  // Un fallo AMBIGUO (sin respuesta de la base) de la PRIMERA escritura —o de un DELETE sin INSERT previo— tampoco puede presentarse como «no se aplicó nada»: pudo aplicarse y
  // quien llama debe releer (`parcial`); si no, `inicial` queda desfasado y la pantalla dice «guardado» con la base distinta (V3-02).
  const fallo = (mensaje: string, ambiguo = false): ResultadoGuardadoAsignaciones => {
    if (escribio) return { error: `${mensaje} ${AVISO_GUARDADO_PARCIAL}`, parcial: true }
    if (ambiguo) return { error: `${mensaje} ${AVISO_RESULTADO_INCIERTO}`, parcial: true, incierto: true }
    return { error: mensaje, parcial: false }
  }
  const mensajeDe = (r: { error: RespuestaEscritura['error']; ambiguo: boolean }): string =>
    r.ambiguo ? MENSAJE_ERROR_RED : (mensajeErrorAsignacion(r.error) ?? 'No se pudieron guardar las asignaciones. Intenta de nuevo.')

  // 1 · primero lo que FALTA: si esto falla con una respuesta de la base no se ha borrado nada y la persona conserva lo que tenía.
  if (insertar.length > 0) {
    const r = await escribir(() => supabase
      .from('user_project_assignments')
      .upsert(
        insertar.map(project_id => ({ user_id: userId, project_id, permission_type: 'total' })),
        { onConflict: 'user_id,project_id', ignoreDuplicates: true },
      ))
    if (r.error) return fallo(mensajeDe(r), r.ambiguo)
    escribio = true
  }
  // 2 · después lo que SOBRA, sólo esas filas.
  if (borrar.length > 0) {
    const r = await escribir(() => supabase
      .from('user_project_assignments')
      .delete()
      .eq('user_id', userId)
      .in('project_id', borrar))
    if (r.error) return fallo(mensajeDe(r), r.ambiguo)
    escribio = true
  }
  // 3 · lectura posterior: la RLS filtra un DELETE sin error (0 filas) y un INSERT … ON CONFLICT DO NOTHING no avisa. Llegados aquí ya se escribió (al menos una escritura).
  let despues: Awaited<ReturnType<typeof fetchUserProjectAssignments>>
  try {
    despues = await fetchUserProjectAssignments(userId)
  } catch {
    despues = { data: null, error: 'sin respuesta' }
  }
  if (despues.error || !despues.data) {
    return fallo('No se pudo comprobar que los cambios se aplicaran. Recarga e intenta de nuevo.')
  }
  const finales = new Set(despues.data.map(a => a.project_id))
  if (insertar.some(id => !finales.has(id)) || borrar.some(id => finales.has(id))) {
    // Algo se escribió pero no todo quedó como se pidió (p. ej. la RLS filtró un DELETE): el estado es mixto.
    return {
      error: 'No se aplicaron todos los cambios: puede que no tengas permiso sobre alguno de esos proyectos. Recarga e intenta de nuevo.',
      parcial: true,
    }
  }
  return { error: null, parcial: false }
}

// ── Alta/baja de usuario vía edge functions (requieren service role) ──

interface CreateUserInput {
  email: string
  password: string
  full_name: string
  role: string
  company_id?: string
}

/**
 * Crea un usuario del tenant vía el edge `create-user` (el edge valida que quien
 * llama tenga permiso con el token de la sesión). Devuelve el `user_id` creado.
 * NO lanza: la UI inspecciona `error`.
 */
export async function createCompanyUser(
  input: CreateUserInput,
): Promise<{ userId: string | null; error: string | null }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    return { userId: null, error: err.error ?? 'No se pudo crear el usuario.' }
  }
  const created = (await res.json().catch(() => ({}))) as { user_id?: string }
  return { userId: created.user_id ?? null, error: null }
}

/**
 * Elimina definitivamente un usuario vía el edge `delete-user`. NO lanza: la UI
 * inspecciona `error`.
 */
export async function deleteCompanyUser(
  userId: string,
): Promise<{ error: string | null }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token ?? ''}` },
    body: JSON.stringify({ user_id: userId }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    return { error: err.error ?? 'No se pudo eliminar el usuario.' }
  }
  return { error: null }
}

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

/** Quién puede cambiar las asignaciones propias: el propietario y el superadministrador (son exentos de proyecto). */
const ROLES_QUE_EDITAN_LAS_SUYAS = ['company_owner', 'super_admin', 'superadmin']

/** Lo que el servidor devuelve (ASIGNACION_PROPIA_NO_PERMITIDA) cuando alguien intenta cambiar sus propias asignaciones. */
export const MOTIVO_AUTOASIGNACION =
  'No puedes cambiar tus propios proyectos. Pídele el cambio a otro administrador, al propietario o al superadministrador.'

/** Lo que se dice cuando una parte de los cambios SÍ se aplicó y otra no. */
export const AVISO_GUARDADO_PARCIAL = 'Se aplicó una parte de los cambios y otra no. Vuelve a guardar para completar el resto.'

/**
 * ¿Puede `actor` editar las asignaciones de proyecto de `objetivo`? Espeja la regla del servidor
 * (public.asignacion_puede_administrar, migración 20261026000600): un administrador no se edita a sí mismo, porque ampliaría su alcance
 * o, borrando las suyas, pasaría a ser «exento de proyecto». El servidor es el que manda; esto sólo evita ofrecer lo que será rechazado.
 */
export function puedeEditarAsignaciones(
  actor: { id: string; role: string },
  objetivo: { id: string },
): { permitido: boolean; motivo: string | null } {
  if (actor.id === objetivo.id && !ROLES_QUE_EDITAN_LAS_SUYAS.includes(actor.role)) {
    return { permitido: false, motivo: MOTIVO_AUTOASIGNACION }
  }
  return { permitido: true, motivo: null }
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
    return 'No tienes permiso para cambiar estas asignaciones. Solo puedes asignar los proyectos que tú ves, a otras personas de tu empresa.'
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

/** Resultado del guardado: `parcial` = una parte de los cambios SÍ se aplicó (la lista de atrás debe recargarse y se puede volver a guardar). */
export interface ResultadoGuardadoAsignaciones {
  error: string | null
  parcial: boolean
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

  let escribio = false      // ¿alguna escritura ya se confirmó? (si algo falla después, el guardado es PARCIAL)
  const fallo = (mensaje: string): ResultadoGuardadoAsignaciones =>
    escribio ? { error: `${mensaje} ${AVISO_GUARDADO_PARCIAL}`, parcial: true } : { error: mensaje, parcial: false }
  try {
    // 1 · primero lo que FALTA: si esto falla no se ha borrado nada y la persona conserva lo que tenía.
    if (insertar.length > 0) {
      const { error } = await supabase
        .from('user_project_assignments')
        .upsert(
          insertar.map(project_id => ({ user_id: userId, project_id, permission_type: 'total' })),
          { onConflict: 'user_id,project_id', ignoreDuplicates: true },
        )
      if (error) return fallo(mensajeErrorAsignacion(error) ?? 'No se pudieron guardar las asignaciones. Intenta de nuevo.')
      escribio = true
    }
    // 2 · después lo que SOBRA, sólo esas filas.
    if (borrar.length > 0) {
      const { error } = await supabase
        .from('user_project_assignments')
        .delete()
        .eq('user_id', userId)
        .in('project_id', borrar)
      if (error) return fallo(mensajeErrorAsignacion(error) ?? 'No se pudieron guardar las asignaciones. Intenta de nuevo.')
      escribio = true
    }
    // 3 · lectura posterior: la RLS filtra un DELETE sin error (0 filas) y un INSERT … ON CONFLICT DO NOTHING no avisa.
    const despues = await fetchUserProjectAssignments(userId)
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
  } catch {
    // Excepción de red (no un error de la base): si ya se escribió algo es parcial; si no, no se sabe que se haya aplicado nada.
    return fallo('No se pudieron guardar las asignaciones. Revisa tu conexión e intenta de nuevo.')
  }
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

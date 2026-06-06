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

/** Borra todas las asignaciones de proyecto de un usuario (paso 1 del replace). */
export async function deleteUserProjectAssignments(
  userId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_project_assignments')
    .delete()
    .eq('user_id', userId)
  return { error: error?.message ?? null }
}

/** Inserta asignaciones de proyecto (filas ya armadas por la UI). */
export async function insertUserProjectAssignments(
  rows: Array<Record<string, unknown>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('user_project_assignments').insert(rows)
  return { error: error?.message ?? null }
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

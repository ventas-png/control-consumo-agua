// domain/superadmin/mutations.ts — Escrituras del panel superadmin. T7/PR3.
// Operaciones de plataforma sobre `companies` (límites/servicios) y alta de
// empresa + su company_owner (vía edge create-user). El armado del payload y la
// validación de UX se quedan en la UI; aquí baja solo el acceso a datos.
import { supabase } from '../../lib/supabase'

/**
 * Actualiza columnas de una empresa por id (límites max_projects/max_units,
 * flags servicio_agua/servicio_condominios…). El patch lo arma la UI.
 */
export async function updateEmpresaCampo(
  empresaId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('companies').update(patch).eq('id', empresaId)
  return { error: error?.message ?? null }
}

/** Crea una empresa (payload ya armado por la UI). Devuelve la fila creada. */
export async function createEmpresa(
  payload: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabase.from('companies').insert(payload).select().single()
  return { data: (data as Record<string, unknown>) ?? null, error: error?.message ?? null }
}

/** Datos del company_owner a crear junto con la empresa. */
export interface CreateCompanyOwnerInput {
  email: string
  password: string
  full_name: string
  company_id: string
}

/**
 * Crea el company_owner de una empresa vía el edge `create-user` (requiere
 * service role; el edge valida que quien llama sea superadmin con el token de la
 * sesión). Devuelve `{ ok, error }`. NO lanza: quien llama inspecciona `ok`.
 */
export async function createCompanyOwner(
  input: CreateCompanyOwnerInput,
): Promise<{ ok: boolean; error: string | null }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token ?? ''}`,
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      full_name: input.full_name,
      role: 'company_owner',
      company_id: input.company_id,
    }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: err.error ?? 'Error desconocido' }
  }
  return { ok: true, error: null }
}

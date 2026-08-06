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

/**
 * Crea o actualiza la comisión transaccional de una empresa para un canal (F7).
 * Upsert por la llave natural (company_id, canal); la RLS restringe la
 * escritura a super_admin. pct es fracción (0.025 = 2.5%); fijo va en la
 * moneda de cobro del tenant. Los cobros ya sellados no cambian.
 */
export async function guardarComisionConfig(
  companyId: string,
  canal: string,
  cfg: { activo: boolean; pct: number; fijo: number },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('comision_config')
    .upsert(
      {
        company_id: companyId,
        canal,
        activo: cfg.activo,
        pct: cfg.pct,
        fijo: cfg.fijo,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,canal' },
    )
  return { error: error?.message ?? null }
}

/** Crea una empresa (payload ya armado por la UI). Devuelve la fila creada. */
export async function createEmpresa(
  payload: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabase.from('companies').insert(payload).select().single()
  return { data: (data as Record<string, unknown>) ?? null, error: error?.message ?? null }
}

/**
 * Crea o actualiza el modelo de cobro del timbrado fiscal de una empresa (F8).
 * Upsert por company_id (fila única); la RLS restringe la escritura a
 * super_admin. Los DTEs ya sellados no cambian de costo.
 */
export async function guardarTimbradoConfig(
  companyId: string,
  cfg: { activo: boolean; precio_dte_cents: number; timbres_incluidos: number },
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('timbrado_config')
    .upsert(
      {
        company_id: companyId,
        activo: cfg.activo,
        precio_dte_cents: cfg.precio_dte_cents,
        timbres_incluidos: cfg.timbres_incluidos,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    )
  return { error: error?.message ?? null }
}

/**
 * Suspende una empresa: activa=false + motivo. El trigger
 * stamp_company_suspension (20260612180000) sella suspended_at; los triggers
 * de escritura y el login pasan a rechazar a sus usuarios.
 */
export async function suspendEmpresa(
  empresaId: string,
  motivo: string,
): Promise<{ error: string | null }> {
  return updateEmpresaCampo(empresaId, { activa: false, suspended_reason: motivo || null })
}

/** Reactiva una empresa suspendida (el trigger limpia suspended_at/reason). */
export async function reactivarEmpresa(empresaId: string): Promise<{ error: string | null }> {
  return updateEmpresaCampo(empresaId, { activa: true })
}

/**
 * Export JSON de los datos operativos de una empresa (RPC export_company_data,
 * acotada a super_admin). Respaldo recomendado antes de la purga definitiva.
 */
export async function exportEmpresaData(
  companyId: string,
): Promise<{ data: unknown | null; error: string | null }> {
  const { data, error } = await supabase.rpc('export_company_data', { p_company_id: companyId })
  return { data: data ?? null, error: error?.message ?? null }
}

/**
 * Purga definitiva de una empresa vía el edge `delete-company` (requiere
 * service role; el edge valida super_admin + nombre de confirmación + período
 * de gracia de suspensión). NO lanza: quien llama inspecciona `ok`.
 */
export async function deleteEmpresa(
  companyId: string,
  confirmName: string,
): Promise<{ ok: boolean; error: string | null }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${supabaseUrl}/functions/v1/delete-company`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token ?? ''}`,
    },
    body: JSON.stringify({ company_id: companyId, confirm_name: confirmName }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: err.error ?? 'Error desconocido' }
  }
  return { ok: true, error: null }
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

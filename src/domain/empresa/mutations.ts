// domain/empresa/mutations.ts — Escrituras de la administración de empresa
// (T7/PR3): edición de la company + sus datos fiscales, CRUD de proyectos y
// subida de logos (company-logos / project-logos). Baja a domain/ el acceso a
// Supabase (tabla + storage) que vivía inline en EmpresaHeaderCard y
// EmpresaProyectosSection; el armado del payload y los diálogos se quedan en la
// UI. El path del logo (único por upload) lo arma esta capa porque es detalle
// de storage, no de negocio.
import { supabase } from '../../lib/supabase'

/** Construye un path único de logo: `<ownerId>/logo-<ts>.<ext>`. */
function buildLogoPath(ownerId: string, file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  return `${ownerId}/logo-${Date.now()}.${ext}`
}

// ── Company (EmpresaHeaderCard) ──

/** Actualiza columnas de la company por id (datos generales o fiscales). */
export async function updateEmpresa(
  empresaId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('companies').update(patch).eq('id', empresaId)
  return { error: error?.message ?? null }
}

/**
 * Sube el logo de la empresa al bucket `company-logos` y persiste el path bare
 * en `companies.logo_url` (SecureImage firma al render). Devuelve `{ error }`;
 * si falla el upload no toca la BD.
 */
export async function uploadEmpresaLogo(
  empresaId: string,
  file: File,
): Promise<{ error: string | null }> {
  const path = buildLogoPath(empresaId, file)
  const { error: uploadError } = await supabase.storage
    .from('company-logos')
    .upload(path, file, { contentType: file.type })
  if (uploadError) return { error: uploadError.message }
  const { error } = await supabase.from('companies').update({ logo_url: path }).eq('id', empresaId)
  return { error: error?.message ?? null }
}

// ── Proyectos (EmpresaProyectosSection) ──

/** Crea un proyecto (payload ya armado por la UI). */
export async function createProyecto(
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('projects').insert(payload)
  return { error: error?.message ?? null }
}

/** Actualiza columnas de un proyecto por id (datos o estado). */
export async function updateProyecto(
  proyectoId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('projects').update(patch).eq('id', proyectoId)
  return { error: error?.message ?? null }
}

/**
 * Sube el logo de un proyecto al bucket `project-logos` y persiste el path en
 * `projects.logo_url`. Devuelve `{ error }`; si falla el upload no toca la BD.
 */
export async function uploadProyectoLogo(
  proyectoId: string,
  file: File,
): Promise<{ error: string | null }> {
  const path = buildLogoPath(proyectoId, file)
  const { error: uploadError } = await supabase.storage
    .from('project-logos')
    .upload(path, file, { contentType: file.type })
  if (uploadError) return { error: uploadError.message }
  const { error } = await supabase.from('projects').update({ logo_url: path }).eq('id', proyectoId)
  return { error: error?.message ?? null }
}

/**
 * Solicita la ampliación self-service de los límites del tenant (proyectos /
 * unidades) vía la RPC `solicitar_ampliacion_limites`, que valida rol,
 * suscripción y tope del plan en la BD (SECURITY DEFINER). La RPC devuelve
 * mensajes de error en español; los propagamos crudos para que la UI los
 * muestre tal cual.
 */
export async function solicitarAmpliacionLimites(
  maxProjects: number,
  maxUnits: number,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('solicitar_ampliacion_limites', {
    p_max_projects: maxProjects,
    p_max_units: maxUnits,
  })
  return { error: error?.message ?? null }
}

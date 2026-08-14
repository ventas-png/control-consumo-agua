// domain/portal/inquilinos.ts — Self-service del propietario sobre el acceso de
// su inquilino (portal propietario/inquilino · 20260822000000). Toda la
// autorización vive en los RPCs SECURITY DEFINER (rol cliente + unidad propia +
// solicitud de renta aprobada para arrendamiento); aquí solo se baja el acceso a
// datos (boundary T7). `supabase` laxo: los RPCs aún no están en el esquema
// generado (entran con el próximo gen:db-types).
import { supabase } from '../../lib/supabase'

/** Arrendatario de una unidad, con los datos que el RPC proyecta del cliente. */
export interface InquilinoDeUnidad {
  id: string
  cliente_id: string
  activo: boolean
  created_at: string
  cliente_nombre: string
  cliente_email: string | null
  cliente_telefono: string | null
  /** true si el inquilino ya activó su login (auto-registro DPI+nacimiento+email). */
  tiene_cuenta: boolean
}

/** Datos que el propietario captura para registrar a su inquilino. */
export interface RegistrarInquilinoInput {
  unidadId: string
  nombre: string
  email: string
  cuiDui: string
  fechaNacimiento: string
  telefono?: string
}

/** Arrendatarios de una unidad PROPIA (0 filas si la unidad no es del llamante). */
export async function fetchInquilinosDeUnidad(
  unidadId: string,
): Promise<{ data: InquilinoDeUnidad[]; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_inquilinos_de_unidad', {
    p_unidad_id: unidadId,
  })
  return { data: (data as InquilinoDeUnidad[] | null) ?? [], error: error?.message ?? null }
}

/**
 * Registra al inquilino de una unidad propia: find-or-create del cliente por
 * DPI, vínculo con la empresa y membresía 'arrendatario' (el RLS dual le abre
 * el portal de esa unidad de inmediato).
 */
export async function registrarInquilino(
  input: RegistrarInquilinoInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_registrar_inquilino', {
    p_unidad_id: input.unidadId,
    p_nombre: input.nombre,
    p_email: input.email,
    p_cui_dui: input.cuiDui,
    p_fecha_nacimiento: input.fechaNacimiento,
    p_telefono: input.telefono?.trim() || null,
  })
  return { error: error?.message ?? null }
}

/** Quita la membresía del inquilino (revoca su acceso; no toca su cuenta). */
export async function quitarInquilino(
  unidadId: string,
  clienteId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_quitar_inquilino', {
    p_unidad_id: unidadId,
    p_cliente_id: clienteId,
  })
  return { error: error?.message ?? null }
}

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

/**
 * Quita la membresía del inquilino (revoca su acceso; no toca su cuenta).
 * Desde 20260825000000 revoca EN CASCADA los accesos familiares de su núcleo y
 * devuelve el conteo.
 */
export async function quitarInquilino(
  unidadId: string,
  clienteId: string,
): Promise<{ familiaresRevocados: number; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_quitar_inquilino', {
    p_unidad_id: unidadId,
    p_cliente_id: clienteId,
  })
  const familiares = (data as { familiares_revocados?: number } | null)?.familiares_revocados ?? 0
  return { familiaresRevocados: familiares, error: error?.message ?? null }
}

// ── Accesos familiares (20260825000000) ──────────────────────────────────────

/** Acceso no-propietario de una unidad (inquilino o familiar, con su núcleo). */
export interface AccesoDeUnidad {
  id: string
  cliente_id: string
  tipo: 'arrendatario' | 'familiar' | 'otro'
  /** Cliente cuyo núcleo integra este familiar (propietario o arrendatario); NULL en filas legacy. */
  nucleo_cliente_id: string | null
  activo: boolean
  created_at: string
  cliente_nombre: string
  cliente_email: string | null
  cliente_telefono: string | null
  tiene_cuenta: boolean
}

/** Todos los accesos no-propietario de una unidad PROPIA (0 filas si no es del llamante). */
export async function fetchAccesosDeUnidad(
  unidadId: string,
): Promise<{ data: AccesoDeUnidad[]; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_accesos_de_unidad', {
    p_unidad_id: unidadId,
  })
  return { data: (data as AccesoDeUnidad[] | null) ?? [], error: error?.message ?? null }
}

/**
 * Registra un acceso familiar en una unidad propia (máx. 3 por núcleo). El
 * servidor decide el núcleo: con arrendatario activo es la familia del
 * inquilino; sin renta, la familia del propietario.
 */
export async function registrarFamiliar(
  input: RegistrarInquilinoInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_registrar_familiar', {
    p_unidad_id: input.unidadId,
    p_nombre: input.nombre,
    p_email: input.email,
    p_cui_dui: input.cuiDui,
    p_fecha_nacimiento: input.fechaNacimiento,
    p_telefono: input.telefono?.trim() || null,
  })
  return { error: error?.message ?? null }
}

/**
 * Retira la solicitud de renta pendiente o da de baja la autorización aprobada
 * de una unidad propia (estado → 'baja'). Con inquilino activo revoca en
 * cascada su acceso y el de su núcleo familiar (RPC 20260827000000).
 */
export async function darDeBajaRenta(
  unidadId: string,
): Promise<{ inquilinoRevocado: boolean; familiaresRevocados: number; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_baja_renta', {
    p_unidad_id: unidadId,
  })
  const r = data as { inquilino_revocado?: boolean; familiares_revocados?: number } | null
  return {
    inquilinoRevocado: r?.inquilino_revocado ?? false,
    familiaresRevocados: r?.familiares_revocados ?? 0,
    error: error?.message ?? null,
  }
}

/** Revoca un acceso familiar de una unidad propia (no toca el cliente ni su login). */
export async function quitarFamiliar(
  unidadId: string,
  clienteId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_quitar_familiar', {
    p_unidad_id: unidadId,
    p_cliente_id: clienteId,
  })
  return { error: error?.message ?? null }
}

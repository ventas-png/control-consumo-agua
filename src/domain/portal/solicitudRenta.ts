// domain/portal/solicitudRenta.ts — la solicitud de autorización de renta desde
// el portal del propietario.
//
// El portal ya NO escribe `solicitud_renta_unidad` directamente: la policy de
// cliente se retiró en 20260829000100 (permitía insertar estado='aprobada' y
// autoaprobarse). Todo pasa por estos RPC SECURITY DEFINER, que validan
// propiedad de la unidad, completitud y estado server-side.
//
// El flujo es de dos pasos a propósito: los adjuntos van a
// `renta-docs/{unidad_id}/{solicitud_id}/…` y su policy verifica contra la
// solicitud, así que la fila tiene que existir ANTES de subir.
import { supabase } from '../../lib/supabase'
import type { DocumentoSolicitudRenta, ResponsablesServicios, TipoRenta } from '../../types'

/**
 * Crea (o recupera) el borrador de solicitud de la unidad y devuelve su id, que
 * es la carpeta de los adjuntos. Idempotente: llamarlo de nuevo devuelve el
 * mismo borrador con lo que ya se había subido.
 */
export async function reservarSolicitudRenta(
  unidadId: string,
): Promise<{ solicitudId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_reservar_solicitud_renta', {
    p_unidad_id: unidadId,
  })
  return { solicitudId: (data as string | null) ?? null, error: error?.message ?? null }
}

export interface EnviarSolicitudRentaInput {
  solicitudId: string
  tipoRenta: TipoRenta
  motivo?: string | null
  arrendatarioNombre?: string | null
  arrendatarioIdentificacion?: string | null
  arrendatarioTelefono?: string | null
  arrendatarioEmail?: string | null
  montoRenta?: number | null
  deposito?: number | null
  diaPago?: number | null
  fechaInicio?: string | null
  fechaFin?: string | null
  notas?: string | null
  responsables?: ResponsablesServicios | null
  documentos: DocumentoSolicitudRenta[]
}

/** Valida y envía el borrador: pasa a `pendiente` y avisa a la administración. */
export async function enviarSolicitudRenta(
  input: EnviarSolicitudRentaInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_enviar_solicitud_renta', {
    p_solicitud_id: input.solicitudId,
    p_tipo_renta: input.tipoRenta,
    p_motivo: input.motivo ?? null,
    p_arrendatario_nombre: input.arrendatarioNombre ?? null,
    p_arrendatario_identificacion: input.arrendatarioIdentificacion ?? null,
    p_arrendatario_telefono: input.arrendatarioTelefono ?? null,
    p_arrendatario_email: input.arrendatarioEmail ?? null,
    p_monto_renta: input.montoRenta ?? null,
    p_deposito: input.deposito ?? null,
    p_dia_pago: input.diaPago ?? null,
    p_fecha_inicio: input.fechaInicio ?? null,
    p_fecha_fin: input.fechaFin ?? null,
    p_notas: input.notas ?? null,
    p_responsables: input.responsables ?? null,
    p_documentos: input.documentos,
  })
  return { error: error?.message ?? null }
}

/** Descarta el borrador (el portal borra antes sus adjuntos del bucket). */
export async function descartarSolicitudRenta(
  solicitudId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('portal_descartar_solicitud_renta', {
    p_solicitud_id: solicitudId,
  })
  return { error: error?.message ?? null }
}

// domain/condominios/solicitudRenta.ts — resolución de las solicitudes de
// autorización de renta desde el panel admin.
//
// El RECHAZO es un update normal sobre la tabla (lo hace el tab con
// `updateCondominioRow`). La APROBACIÓN va por RPC porque además de resolver la
// solicitud puede crear el contrato de arrendamiento con los datos que el
// propietario envió, y eso cruza dos tablas con permisos RBAC distintos
// (`condominios.tab.solicitudes_renta` vs `condominios.tab.arrendamientos`).
// Ver 20260828000200_aprobar_solicitud_renta_rpc.sql.
import { supabase } from '../../lib/supabase'
import type { TipoRenta } from '../../types'

export interface AprobarSolicitudRentaInput {
  solicitudId: string
  tipoAprobado: TipoRenta
  comentario?: string | null
  /** Crear el contrato de arrendamiento con los datos de la solicitud. */
  crearContrato?: boolean
  /** Obligatorio si se aprueba un arrendamiento SIN crear el contrato. */
  motivoSinContrato?: string | null
}

export interface AprobarSolicitudRentaResult {
  contratoCreado: boolean
  contratoId: string | null
  /** Contrato de la unidad que se cerró para dar paso al nuevo, si lo había. */
  contratoAnteriorTerminado: string | null
  error: string | null
}

/**
 * Aprueba una solicitud pendiente. Con arrendamiento crea el contrato con los
 * datos y los seis responsables de la solicitud, cierra el contrato activo
 * anterior de la unidad y enlaza `contrato_id`. Si faltan datos, el RPC FALLA:
 * no existe la aprobación silenciosa sin contrato.
 *
 * `aprobadoPor` no se manda: la identidad de auditoría la toma el servidor de
 * `auth.uid()` (20260829000300).
 */
export async function aprobarSolicitudRenta({
  solicitudId,
  tipoAprobado,
  comentario = null,
  crearContrato = true,
  motivoSinContrato = null,
}: AprobarSolicitudRentaInput): Promise<AprobarSolicitudRentaResult> {
  const { data, error } = await supabase.rpc('aprobar_solicitud_renta', {
    p_solicitud_id: solicitudId,
    p_tipo_aprobado: tipoAprobado,
    p_comentario: comentario,
    p_crear_contrato: crearContrato,
    p_motivo_sin_contrato: motivoSinContrato,
  })
  const r = data as {
    contrato_id?: string | null
    contrato_creado?: boolean
    contrato_anterior_terminado?: string | null
  } | null
  return {
    contratoCreado: r?.contrato_creado ?? false,
    contratoId: r?.contrato_id ?? null,
    contratoAnteriorTerminado: r?.contrato_anterior_terminado ?? null,
    error: error?.message ?? null,
  }
}

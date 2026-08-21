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
  aprobadoPor?: string | null
  /** Crear el contrato de arrendamiento con los datos de la solicitud. */
  crearContrato?: boolean
}

export interface AprobarSolicitudRentaResult {
  contratoCreado: boolean
  contratoId: string | null
  error: string | null
}

/**
 * Aprueba una solicitud pendiente. Si `crearContrato` y la autorización cubre
 * arrendamiento y la solicitud trae nombre + monto + fecha de inicio, crea el
 * contrato y lo enlaza en `solicitud_renta_unidad.contrato_id`.
 */
export async function aprobarSolicitudRenta({
  solicitudId,
  tipoAprobado,
  comentario = null,
  aprobadoPor = null,
  crearContrato = true,
}: AprobarSolicitudRentaInput): Promise<AprobarSolicitudRentaResult> {
  const { data, error } = await supabase.rpc('aprobar_solicitud_renta', {
    p_solicitud_id: solicitudId,
    p_tipo_aprobado: tipoAprobado,
    p_comentario: comentario,
    p_aprobado_por: aprobadoPor,
    p_crear_contrato: crearContrato,
  })
  const r = data as { contrato_id?: string | null; contrato_creado?: boolean } | null
  return {
    contratoCreado: r?.contrato_creado ?? false,
    contratoId: r?.contrato_id ?? null,
    error: error?.message ?? null,
  }
}

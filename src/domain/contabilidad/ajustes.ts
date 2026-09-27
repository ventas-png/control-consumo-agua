// ════════════════════════════════════════════════════════════════════════════
// Solicitudes de ajuste e incidencias de conciliación (20261011000000)
//
// Anular un cargo adicional o un cobro de cargo, anular un anticipo y revertir
// o aplicar (desde el portal) un saldo a favor se SOLICITAN con motivo y los
// ejecuta la aprobación de OTRA persona con «Autorizar / Denegar» en
// Contabilidad. El servidor decide todo: permisos, cuatro ojos, revalidación
// del documento, período y saldo, y la ejecución (una sola vez, atómica).
//
// Autoaprobación (E1): sólo el `company_owner`, confirmándolo explícitamente;
// queda marcada. La pantalla la ofrece sólo en ese caso, pero la regla la
// aplica el servidor (AJUSTE_AUTOAPROBACION_*).
//
// Idempotencia: la clave de una solicitud la genera la pantalla al abrir el
// formulario y se conserva en cada reintento.
// ════════════════════════════════════════════════════════════════════════════
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { contabilidadKeys } from './keys'

export type TipoAjuste =
  | 'anular_cargo'
  | 'anular_cobro_cargo'
  | 'anular_anticipo'
  | 'revertir_aplicacion_saldo_favor'
  | 'aplicar_saldo_favor'

export type EstadoAjuste = 'pendiente' | 'rechazada' | 'cancelada' | 'ejecutada' | 'fallida'

export type TablaAjuste =
  | 'cargos_adicionales_unidad'
  | 'pagos'
  | 'conta_saldo_favor_aplicaciones'
  | 'cuotas_condominio'

export interface SolicitudAjuste {
  id: string
  company_id: string
  project_id: string
  tipo: TipoAjuste
  documento_tabla: TablaAjuste
  documento_id: string
  saldo_origen_id: string | null
  importe: number | null
  moneda: string | null
  motivo: string
  canal: 'backoffice' | 'portal'
  estado: EstadoAjuste
  solicitado_por: string
  solicitado_cliente_id: string | null
  solicitado_at: string
  foto_documento: Record<string, unknown>
  revisado_por: string | null
  revisado_at: string | null
  motivo_revision: string | null
  autoaprobada: boolean
  ejecutado_at: string | null
  resultado: Record<string, unknown> | null
  error_ejecucion: string | null
  intentos_ejecucion: number
}

export interface IncidenciaConciliacion {
  id: string
  company_id: string
  project_id: string | null
  tipo: 'reembolso_bloqueado' | 'reembolso_aplicado' | 'rechazo_tras_aprobacion'
      | 'aprobado_tras_reembolso' | 'reembolso_sin_cobro'
  estado: 'abierta' | 'resuelta'
  payment_request_id: string | null
  pago_id: string | null
  monto: number | null
  detalle: string
  creada_at: string
  resuelta_por: string | null
  resuelta_at: string | null
  nota_resolucion: string | null
}

export const ETIQUETA_TIPO_AJUSTE: Record<TipoAjuste, string> = {
  anular_cargo: 'Anular cargo adicional',
  anular_cobro_cargo: 'Anular cobro de cargo',
  anular_anticipo: 'Anular anticipo',
  revertir_aplicacion_saldo_favor: 'Revertir aplicación de saldo a favor',
  aplicar_saldo_favor: 'Aplicar saldo a favor',
}

export const ETIQUETA_ESTADO_AJUSTE: Record<EstadoAjuste, string> = {
  pendiente: 'Pendiente',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
  ejecutada: 'Ejecutada',
  fallida: 'Falló al ejecutar',
}

export const ETIQUETA_INCIDENCIA: Record<IncidenciaConciliacion['tipo'], string> = {
  reembolso_bloqueado: 'Reembolso con rechazo bloqueado',
  reembolso_aplicado: 'Reembolso aplicado',
  rechazo_tras_aprobacion: 'Rechazo después de aprobado',
  aprobado_tras_reembolso: 'Aprobado después de reembolsado',
  reembolso_sin_cobro: 'Reembolso sin cobro acreditado',
}

/**
 * Qué puede hacer la sesión con una solicitud (sólo para mostrar botones: el
 * servidor vuelve a decidir). `puedeAprobar` = permiso de «Autorizar /
 * Denegar» en Contabilidad (o rol owner/admin).
 */
export function accionesSolicitud(
  s: Pick<SolicitudAjuste, 'estado' | 'solicitado_por' | 'autoaprobada'>,
  sesion: { userId: string | null; rol: string | null; puedeAprobar: boolean },
): { aprobar: boolean; autoaprobar: boolean; rechazar: boolean; reintentar: boolean; cancelar: boolean } {
  const propia = !!sesion.userId && s.solicitado_por === sesion.userId
  const owner = sesion.rol === 'company_owner'
  const pendiente = s.estado === 'pendiente'
  const fallida = s.estado === 'fallida'
  return {
    // Cuatro ojos: la propia sólo la aprueba el dueño, y confirmándolo.
    aprobar: pendiente && sesion.puedeAprobar && !propia,
    autoaprobar: pendiente && sesion.puedeAprobar && propia && owner,
    rechazar: (pendiente || fallida) && sesion.puedeAprobar,
    reintentar: fallida && sesion.puedeAprobar && (!propia || s.autoaprobada),
    cancelar: pendiente && propia,
  }
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export function useSolicitudesAjusteQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.ajustes(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<SolicitudAjuste[]>((signal) => {
        let q = supabase
          .from('conta_ajustes_solicitudes')
          .select('*')
          .eq('company_id', companyId!)
          .order('solicitado_at', { ascending: false })
          .limit(300)
        if (projectId) q = q.eq('project_id', projectId)
        return q.abortSignal(signal)
      })) ?? [],
  })
}

export function useIncidenciasConciliacionQuery(companyId?: string, soloAbiertas = true) {
  return useQuery({
    queryKey: contabilidadKeys.incidencias(companyId, soloAbiertas),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<IncidenciaConciliacion[]>((signal) => {
        let q = supabase
          .from('conta_incidencias_conciliacion')
          .select('*')
          .eq('company_id', companyId!)
          .order('creada_at', { ascending: false })
          .limit(300)
        if (soloAbiertas) q = q.eq('estado', 'abierta')
        return q.abortSignal(signal)
      })) ?? [],
  })
}

// ── Escrituras ──────────────────────────────────────────────────────────────

function useInvalidarAjustes(companyId?: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: contabilidadKeys.ajustesDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.saldosFavorDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.estadoCuentaDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.cobrosCargoDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.cargosPendientesDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'asientos'] })
  }
}

export interface SolicitarAjusteInput {
  /** Clave de idempotencia: la misma en cada reintento del mismo formulario. */
  clave: string
  tipo: Exclude<TipoAjuste, 'aplicar_saldo_favor'>
  documentoTabla: TablaAjuste
  documentoId: string
  motivo: string
}

export interface ResultadoSolicitud {
  solicitud_id: string
  estado: EstadoAjuste
  repetida: boolean
}

/** Registra una solicitud (no cambia ningún documento). */
export async function solicitarAjuste(input: SolicitarAjusteInput): Promise<ResultadoSolicitud> {
  const filas = await runQuery<ResultadoSolicitud[]>((signal) =>
    supabase
      .rpc('conta_ajuste_solicitar', {
        p_id: input.clave,
        p_tipo: input.tipo,
        p_documento_tabla: input.documentoTabla,
        p_documento_id: input.documentoId,
        p_motivo: input.motivo,
      })
      .abortSignal(signal),
  )
  if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió la solicitud.')
  return filas[0]
}

export function useSolicitarAjusteMutation(companyId?: string) {
  const invalidar = useInvalidarAjustes(companyId)
  return useMutation({
    mutationFn: solicitarAjuste,
    onSettled: invalidar,
  })
}

export interface ResultadoAprobacion {
  solicitud_id: string
  estado: EstadoAjuste
  repetida: boolean
  autoaprobada: boolean
  resultado: Record<string, unknown> | null
  error_ejecucion: string | null
}

export function useAprobarAjusteMutation(companyId?: string) {
  const invalidar = useInvalidarAjustes(companyId)
  return useMutation({
    mutationFn: async (input: { id: string; nota?: string | null; confirmarAutoaprobacion?: boolean }): Promise<ResultadoAprobacion> => {
      const filas = await runQuery<ResultadoAprobacion[]>((signal) =>
        supabase
          .rpc('conta_ajuste_aprobar', {
            p_id: input.id,
            p_nota: input.nota ?? null,
            p_confirmar_autoaprobacion: input.confirmarAutoaprobacion === true,
          })
          .abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado de la aprobación.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

export function useReintentarAjusteMutation(companyId?: string) {
  const invalidar = useInvalidarAjustes(companyId)
  return useMutation({
    mutationFn: async (id: string): Promise<Pick<ResultadoAprobacion, 'solicitud_id' | 'estado' | 'resultado' | 'error_ejecucion'>> => {
      const filas = await runQuery<Pick<ResultadoAprobacion, 'solicitud_id' | 'estado' | 'resultado' | 'error_ejecucion'>[]>((signal) =>
        supabase.rpc('conta_ajuste_reintentar', { p_id: id }).abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado del reintento.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

export function useRechazarAjusteMutation(companyId?: string) {
  const invalidar = useInvalidarAjustes(companyId)
  return useMutation({
    mutationFn: async (input: { id: string; motivo: string }): Promise<ResultadoSolicitud> => {
      const filas = await runQuery<ResultadoSolicitud[]>((signal) =>
        supabase.rpc('conta_ajuste_rechazar', { p_id: input.id, p_motivo: input.motivo }).abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado del rechazo.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

export function useCancelarAjusteMutation(companyId?: string) {
  const invalidar = useInvalidarAjustes(companyId)
  return useMutation({
    mutationFn: async (input: { id: string; motivo?: string | null }): Promise<ResultadoSolicitud> => {
      const filas = await runQuery<ResultadoSolicitud[]>((signal) =>
        supabase.rpc('conta_ajuste_cancelar', { p_id: input.id, p_motivo: input.motivo ?? null }).abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado de la cancelación.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

export function useResolverIncidenciaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; nota: string }) => {
      const filas = await runQuery<{ incidencia_id: string; estado: string; repetida: boolean }[]>((signal) =>
        supabase.rpc('conta_incidencia_resolver', { p_id: input.id, p_nota: input.nota }).abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado.')
      return filas[0]
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: contabilidadKeys.incidenciasDeEmpresa(companyId) }) },
  })
}

/** Mensaje de éxito uniforme tras SOLICITAR (nada cambia todavía). */
export function textoSolicitudEnviada(r: ResultadoSolicitud): string {
  return r.repetida
    ? 'Esa solicitud ya estaba registrada. Nada cambia hasta que otra persona la apruebe en Contabilidad › Solicitudes de ajuste.'
    : 'Solicitud registrada. Nada cambia hasta que otra persona con permiso de autorizar la apruebe en Contabilidad › Solicitudes de ajuste.'
}

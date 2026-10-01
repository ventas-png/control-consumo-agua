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
//
// 20261012000000: anular una CUOTA también se solicita (con sus dependencias
// informadas: nada se anula en cascada); cada solicitud admite RESPALDO
// documental (bucket privado `ajustes-respaldos`) mientras está pendiente, y
// quien aprueba declara qué respaldos revisó.
//
// 20261017000000 (E6): REBAJAR el importe de una cuota (principal o mora) o de
// un cargo adicional también se solicita (conta_ajuste_solicitar_rebaja). Sólo
// rebajas, con tope en el saldo pendiente del componente; al aprobarse queda
// una NOTA DE CRÉDITO contra la cuenta especial «ajustes y bonificaciones». El
// importe del documento y su devengo no cambian: baja su saldo.
// ════════════════════════════════════════════════════════════════════════════
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { contabilidadKeys } from './keys'
import { BUCKET_RESPALDOS_AJUSTE } from '../shared/buckets'

export type TipoAjuste =
  | 'anular_cargo'
  | 'anular_cobro_cargo'
  | 'anular_anticipo'
  | 'revertir_aplicacion_saldo_favor'
  | 'aplicar_saldo_favor'
  | 'anular_cuota'
  | 'ajuste_importe'

/** Qué se rebaja (ajuste_importe). */
export type ComponenteRebaja = 'principal' | 'mora' | 'cargo'

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
  /** Respaldos que declaró haber revisado quien aprobó o rechazó. */
  respaldos_revisados?: Array<Record<string, unknown>> | null
  /** ajuste_importe: componente rebajado. */
  componente?: ComponenteRebaja | null
}

export interface RespaldoAjuste {
  id: string
  solicitud_id: string
  company_id: string
  project_id: string
  storage_path: string
  nombre_archivo: string
  mime: string | null
  tamano: number | null
  etag: string | null
  sha256: string | null
  descripcion: string | null
  subido_por: string
  subido_at: string
}

/** Lo que impide anular un documento (conta_ajuste_dependencias). */
export interface DependenciaAjuste {
  dependencia: 'cobro' | 'aplicacion_saldo_favor' | 'cobro_en_linea' | 'solicitud_aplicacion'
             | 'devengo_borrador' | 'devengo_pendiente' | 'nota_credito' | 'solicitud_rebaja'
  id: string
  monto: number | null
  estado: string | null
  detalle: string
  como_resolver: string
}

export interface IncidenciaConciliacion {
  id: string
  company_id: string
  project_id: string | null
  tipo: 'reembolso_bloqueado' | 'reembolso_aplicado' | 'rechazo_tras_aprobacion'
      | 'aprobado_tras_reembolso' | 'reembolso_sin_cobro' | 'reembolso_parcial'
      | 'cobro_sobre_documento_anulado'
  estado: 'abierta' | 'resuelta'
  payment_request_id: string | null
  pago_id: string | null
  monto: number | null
  reembolso_id?: string | null
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
  anular_cuota: 'Anular cuota',
  ajuste_importe: 'Rebajar importe (nota de crédito)',
}

export const ETIQUETA_COMPONENTE_REBAJA: Record<ComponenteRebaja, string> = {
  principal: 'principal',
  mora: 'mora',
  cargo: 'cargo',
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
  reembolso_parcial: 'Reembolso parcial por conciliar',
  cobro_sobre_documento_anulado: 'Cobro confirmado sobre cuota anulada (sin acreditar)',
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

/** Respaldos de las solicitudes de la empresa (sólo lectura; RLS por proyecto). */
export function useRespaldosAjusteQuery(companyId?: string) {
  return useQuery({
    queryKey: contabilidadKeys.respaldosAjuste(companyId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<RespaldoAjuste[]>((signal) =>
        supabase
          .from('conta_ajustes_respaldos')
          .select('*')
          .eq('company_id', companyId!)
          .order('subido_at', { ascending: true })
          .limit(1000)
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Qué impide anular una cuota o un cargo (para mostrarlo ANTES de pedirlo). */
export async function fetchDependenciasAjuste(
  tipo: 'anular_cuota' | 'anular_cargo',
  documentoId: string,
): Promise<DependenciaAjuste[]> {
  return (await runQuery<DependenciaAjuste[]>((signal) =>
    supabase
      .rpc('conta_ajuste_dependencias', { p_tipo: tipo, p_documento_id: documentoId })
      .abortSignal(signal),
  )) ?? []
}

/** Texto de las dependencias para un aviso. */
export function textoDependencias(deps: DependenciaAjuste[]): string {
  return deps
    .map((d) => `• ${d.detalle}${d.monto != null ? ` (${Number(d.monto).toFixed(2)})` : ''}: ${d.como_resolver}`)
    .join('\n')
}

/** Enlace firmado y corto para ver un respaldo (bucket privado). */
export async function urlRespaldo(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_RESPALDOS_AJUSTE).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo abrir el respaldo.')
  return data.signedUrl
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
  tipo: Exclude<TipoAjuste, 'aplicar_saldo_favor' | 'ajuste_importe'>
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

/**
 * Importe de una rebaja escrito por el usuario → número, o el motivo por el
 * que no vale. Sólo rebajas (positivo) con dos decimales como máximo; el tope
 * (saldo pendiente) lo aplica el servidor al solicitar y otra vez al aprobar.
 */
export function leerImporteRebaja(texto: string): { importe: number } | { error: string } {
  const limpio = texto.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) {
    return { error: 'Escribe un importe positivo con dos decimales como máximo (sólo se admiten rebajas).' }
  }
  const importe = Number(limpio)
  if (!(importe > 0)) return { error: 'El importe de la rebaja debe ser mayor que 0.' }
  return { importe }
}

export interface SolicitarRebajaInput {
  clave: string
  documentoTabla: 'cuotas_condominio' | 'cargos_adicionales_unidad'
  documentoId: string
  componente: ComponenteRebaja
  importe: number
  motivo: string
}

/** Solicita una rebaja de importe (no cambia nada hasta que otra persona la apruebe). */
export async function solicitarRebaja(input: SolicitarRebajaInput): Promise<ResultadoSolicitud> {
  const filas = await runQuery<ResultadoSolicitud[]>((signal) =>
    supabase
      .rpc('conta_ajuste_solicitar_rebaja', {
        p_id: input.clave,
        p_documento_tabla: input.documentoTabla,
        p_documento_id: input.documentoId,
        p_componente: input.componente,
        p_importe: input.importe,
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
    mutationFn: async (input: {
      id: string
      nota?: string | null
      confirmarAutoaprobacion?: boolean
      /** Ids de los respaldos que se mostraron y revisó quien aprueba. */
      respaldosRevisados?: string[]
    }): Promise<ResultadoAprobacion> => {
      const filas = await runQuery<ResultadoAprobacion[]>((signal) =>
        supabase
          .rpc('conta_ajuste_aprobar', {
            p_id: input.id,
            p_nota: input.nota ?? null,
            p_confirmar_autoaprobacion: input.confirmarAutoaprobacion === true,
            p_respaldos_revisados: input.respaldosRevisados ?? null,
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

// ── Respaldo documental ─────────────────────────────────────────────────────

const MAX_RESPALDO_MB = 15
const MIME_RESPALDO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/** Nombre de archivo seguro para la ruta (sin carpetas ni caracteres raros). */
export function nombreSeguroRespaldo(nombre: string): string {
  const limpio = nombre.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-80)
  return limpio || 'respaldo'
}

/** Ruta del objeto: <empresa>/<solicitud>/<clave>-<archivo>. */
export function rutaRespaldo(companyId: string, solicitudId: string, clave: string, nombre: string): string {
  return `${companyId}/${solicitudId}/${clave}-${nombreSeguroRespaldo(nombre)}`
}

async function sha256Hex(file: Blob): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer()
    const dig = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export interface AdjuntarRespaldoInput {
  /** Clave de idempotencia del respaldo (la misma en cada reintento). */
  clave: string
  companyId: string
  solicitudId: string
  archivo: File
  descripcion?: string | null
}

/**
 * Sube el archivo al bucket privado (sin sobrescribir) y lo registra como
 * respaldo de la solicitud. Si la subida ya ocurrió en un intento anterior
 * (el objeto existe), sólo lo registra. Los metadatos que quedan son los de
 * storage, no los del navegador.
 */
export async function adjuntarRespaldo(input: AdjuntarRespaldoInput): Promise<{ respaldo_id: string; repetida: boolean }> {
  if (input.archivo.size > MAX_RESPALDO_MB * 1024 * 1024) {
    throw new Error(`El respaldo pesa más de ${MAX_RESPALDO_MB} MB.`)
  }
  if (!MIME_RESPALDO.includes(input.archivo.type)) {
    throw new Error('El respaldo debe ser PDF o imagen (JPG, PNG, WEBP).')
  }
  const ruta = rutaRespaldo(input.companyId, input.solicitudId, input.clave, input.archivo.name)
  const { error: upErr } = await supabase.storage
    .from(BUCKET_RESPALDOS_AJUSTE)
    .upload(ruta, input.archivo, { contentType: input.archivo.type, upsert: false })
  // Reintento tras una subida que sí llegó: el objeto ya está (mismo nombre,
  // misma clave). Cualquier otro error se informa.
  if (upErr && !/exists|duplicate/i.test(upErr.message)) throw new Error(upErr.message)
  const sha = await sha256Hex(input.archivo)
  const filas = await runQuery<{ respaldo_id: string; repetida: boolean }[]>((signal) =>
    supabase
      .rpc('conta_ajuste_adjuntar_respaldo', {
        p_id: input.clave,
        p_solicitud_id: input.solicitudId,
        p_storage_path: ruta,
        p_descripcion: input.descripcion ?? null,
        p_sha256: sha,
      })
      .abortSignal(signal),
  )
  if (!filas || filas.length !== 1) throw new Error('El servidor no registró el respaldo.')
  return filas[0]
}

export function useAdjuntarRespaldoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: adjuntarRespaldo,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.respaldosAjuste(companyId) })
      void qc.invalidateQueries({ queryKey: contabilidadKeys.ajustesDeEmpresa(companyId) })
    },
  })
}

/** Mensaje de éxito uniforme tras SOLICITAR (nada cambia todavía). */
export function textoSolicitudEnviada(r: ResultadoSolicitud): string {
  return r.repetida
    ? 'Esa solicitud ya estaba registrada. Nada cambia hasta que otra persona la apruebe en Contabilidad › Solicitudes de ajuste.'
    : 'Solicitud registrada. Nada cambia hasta que otra persona con permiso de autorizar la apruebe en Contabilidad › Solicitudes de ajuste.'
}

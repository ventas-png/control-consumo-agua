// ════════════════════════════════════════════════════════════════════════════
// Saldos a favor, anticipos y su aplicación (20261007000000)
//
// El excedente de un cobro queda como SALDO A FAVOR de su titular (cliente y
// unidad, en la contabilidad y la moneda del cobro). Un ANTICIPO es un cobro
// sin documento para un titular. Aplicar un saldo a un documento posterior es
// una decisión EXPLÍCITA de un usuario autorizado: se elige el origen, el
// documento y el importe; no hay prioridad automática.
//
// Todo lo decide el servidor: disponible, saldo del documento, titular,
// moneda, permisos y el reparto mora/principal. La pantalla sólo muestra su
// respuesta y nunca suma ni resta importes para decidir algo.
//
// Idempotencia: la clave de un alta (anticipo o aplicación) la genera la
// pantalla al abrir el formulario y se conserva en cada reintento. Con los
// mismos datos el servidor devuelve lo ya registrado; con otros, rechaza
// (…_CLAVE_REUSADA). Si la respuesta no llega, el resultado es INCIERTO y se
// dice así: reintentar con la misma clave no duplica nada.
// ════════════════════════════════════════════════════════════════════════════
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { QueryError, runQuery } from '../queryFetch'
import { contabilidadKeys } from './keys'

export type TipoOrigenSaldoFavor = 'excedente' | 'anticipo'
export type DocumentoSaldoFavor = 'cuotas_condominio' | 'cargos_adicionales_unidad'

/** Un saldo a favor: el cobro que lo generó y cuánto queda. */
export interface OrigenSaldoFavor {
  origen_id: string
  pago_id: string
  tipo: TipoOrigenSaldoFavor
  fecha: string
  asiento_id: string
  asiento_numero: number | null
  /** vigente | reversado | borrador (sin tipo de cambio: todavía no es saldo) */
  estado: string
  metodo: string | null
  referencia: string | null
  cobro_monto: number | null
  cobro_estado: string | null
  cliente_id: string
  cliente_nombre: string | null
  unidad_id: string
  unidad_nombre: string | null
  moneda: string
  monto: number
  aplicado: number
  disponible: number
  documento_tabla: DocumentoSaldoFavor | null
  documento_id: string | null
  documento: string | null
}

/** Una aplicación de un saldo a favor a un documento, con su reverso si lo tuvo. */
export interface AplicacionSaldoFavor {
  aplicacion_id: string
  origen_id: string
  pago_id: string
  documento_tabla: DocumentoSaldoFavor
  documento_id: string
  documento: string | null
  cliente_id: string
  unidad_id: string
  moneda: string
  monto: number
  monto_mora: number
  monto_principal: number
  fecha: string
  asiento_id: string
  asiento_numero: number | null
  notas: string | null
  creada_at: string
  creada_por: string
  vigente: boolean
  revertida_at: string | null
  revertida_por: string | null
  motivo_reverso: string | null
  reverso_id: string | null
  reverso_numero: number | null
  reverso_fecha: string | null
}

/** Un anticipo registrado cuyo saldo todavía no existe (sin asiento). */
export interface AnticipoPendiente {
  pago_id: string
  fecha: string
  monto: number
  metodo: string
  referencia: string | null
  estado: string
  cliente_id: string
  cliente_nombre: string | null
  unidad_id: string
  unidad_nombre: string | null
  codigo: string | null
  motivo: string | null
}

export interface SaldosFavor {
  project_id: string
  origenes: OrigenSaldoFavor[]
  aplicaciones: AplicacionSaldoFavor[]
  anticipos_pendientes: AnticipoPendiente[]
  disponible_por_moneda: Array<{ moneda: string; disponible: number }>
  /** Estado de la cuenta de anticipos del ledger: sin código = configurada. */
  cuenta_anticipos: { cuenta_id: string | null; codigo: string | null; motivo: string | null } | null
  /** El usuario puede aplicar y revertir (crear y cambiar estado en Contabilidad). */
  puede_aplicar: boolean
}

/** Documento al que se puede aplicar un origen (mismo titular, ledger y moneda). */
export interface DocumentoCandidato {
  documento_tabla: DocumentoSaldoFavor
  documento_id: string
  concepto: string
  fecha: string
  moneda: string
  saldo_mora: number
  saldo_principal: number
  saldo: number
}

export interface ResultadoAplicacion {
  aplicacion_id: string
  repetido: boolean
  asiento_id: string
  asiento_numero: number | null
  monto: number
  monto_mora: number
  monto_principal: number
  disponible_restante: number
  /** Saldo del documento tras aplicar (NULL si la respuesta es una repetición). */
  saldo_documento: number | null
  estado_documento: string | null
}

export interface ResultadoReversion {
  aplicacion_id: string
  /** revertida | ya_revertida */
  resultado: string
  reverso_id: string | null
  reverso_numero: number | null
  disponible_restante: number
  estado_documento: string | null
}

export interface ResultadoAnticipo {
  pago_id: string
  repetido: boolean
  /** contabilizada | pendiente | bloqueada */
  resultado: string
  codigo: string | null
  motivo: string | null
  asiento_id: string | null
  asiento_numero: number | null
  saldo_a_favor: number
}

export interface ResultadoAnulacionAnticipo {
  pago_id: string
  /** anulado | ya_anulado */
  resultado: string
  asiento_id: string | null
  reverso_id: string | null
  reverso_numero: number | null
}

/** Métodos de un anticipo de back-office (los de pasarela entran por su flujo). */
export const METODOS_ANTICIPO = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta_credito', label: 'Tarjeta de crédito' },
  { value: 'tarjeta_debito', label: 'Tarjeta de débito' },
  { value: 'otro', label: 'Otro' },
] as const

export type MetodoAnticipo = (typeof METODOS_ANTICIPO)[number]['value']

export const TIPO_ORIGEN_LABELS: Record<TipoOrigenSaldoFavor, string> = {
  excedente: 'Excedente de cobro',
  anticipo: 'Anticipo',
}

/**
 * Explicación para el usuario de un rechazo del servidor. Los códigos son los
 * de 20261007000000; lo que no se reconoce se muestra tal cual.
 */
export function explicarErrorSaldoFavor(mensaje: string): string {
  const quitar = (m: string) => m.replace(/^[A-Z_]+:\s*/, '')
  if (/SALDO_FAVOR_INSUFICIENTE/.test(mensaje)) return `Saldo insuficiente. ${quitar(mensaje)}`
  if (/SALDO_FAVOR_EXCEDE_DOCUMENTO/.test(mensaje)) return `El importe supera lo que debe el documento. ${quitar(mensaje)}`
  if (/SALDO_FAVOR_TITULAR_DISTINTO/.test(mensaje)) return `El documento es de otro titular. ${quitar(mensaje)}`
  if (/SALDO_FAVOR_MONEDA_DISTINTA/.test(mensaje)) return `Monedas distintas. ${quitar(mensaje)}`
  if (/SALDO_FAVOR_NO_DISPONIBLE/.test(mensaje)) return `El saldo ya no está disponible. ${quitar(mensaje)}`
  if (/COBRO_SALDO_FAVOR_APLICADO/.test(mensaje)) return quitar(mensaje)
  return quitar(mensaje)
}

// ── Lecturas ────────────────────────────────────────────────────────────────

/** Saldos a favor de la contabilidad, opcionalmente de un cliente y/o unidad. */
export function useSaldosFavorQuery(params: {
  companyId?: string
  projectId: string | null
  clienteId?: string | null
  unidadId?: string | null
  enabled?: boolean
}) {
  const { companyId, projectId, clienteId = null, unidadId = null, enabled = true } = params
  return useQuery({
    queryKey: contabilidadKeys.saldosFavor(companyId, projectId, clienteId, unidadId),
    enabled: enabled && !!companyId && !!projectId,
    queryFn: async () =>
      (await runQuery<SaldosFavor>((signal) =>
        supabase
          .rpc('conta_saldos_favor', {
            p_project_id: projectId!,
            p_cliente_id: clienteId,
            p_unidad_id: unidadId,
          })
          .abortSignal(signal),
      )) as SaldosFavor,
  })
}

/** Documentos a los que se puede aplicar un origen. */
export function useDocumentosSaldoFavorQuery(companyId?: string, origenId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.saldoFavorDocumentos(companyId, origenId),
    enabled: !!companyId && !!origenId,
    queryFn: async () =>
      (await runQuery<DocumentoCandidato[]>((signal) =>
        supabase.rpc('conta_saldo_favor_documentos', { p_origen_id: origenId! }).abortSignal(signal),
      )) ?? [],
  })
}

// ── Escrituras ──────────────────────────────────────────────────────────────

function useInvalidarSaldosFavor(companyId?: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: contabilidadKeys.saldosFavorDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.estadoCuentaDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.cobrosCargoDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.cargosPendientesDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'asientos'] })
    void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'balanza'] })
  }
}

export interface AplicarSaldoFavorInput {
  origenId: string
  documentoTabla: DocumentoSaldoFavor
  documentoId: string
  monto: number
  notas?: string | null
  /** Clave de idempotencia: la misma en cada reintento del mismo formulario. */
  clave: string
}

export function useAplicarSaldoFavorMutation(companyId?: string) {
  const invalidar = useInvalidarSaldosFavor(companyId)
  return useMutation({
    mutationFn: async (input: AplicarSaldoFavorInput): Promise<ResultadoAplicacion> => {
      const filas = await runQuery<ResultadoAplicacion[]>((signal) =>
        supabase
          .rpc('conta_aplicar_saldo_favor', {
            p_origen_id: input.origenId,
            p_documento_tabla: input.documentoTabla,
            p_documento_id: input.documentoId,
            p_monto: input.monto,
            p_notas: input.notas ?? null,
            p_aplicacion_id: input.clave,
          })
          .abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado de la aplicación.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

export function useRevertirAplicacionMutation(companyId?: string) {
  const invalidar = useInvalidarSaldosFavor(companyId)
  return useMutation({
    mutationFn: async (input: { aplicacionId: string; motivo: string }): Promise<ResultadoReversion> => {
      const filas = await runQuery<ResultadoReversion[]>((signal) =>
        supabase
          .rpc('conta_revertir_aplicacion_saldo_favor', { p_aplicacion_id: input.aplicacionId, p_motivo: input.motivo })
          .abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado de la reversión.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

export interface RegistrarAnticipoInput {
  projectId: string
  unidadId: string
  clienteId: string
  monto: number
  metodo: MetodoAnticipo
  fecha: string
  referencia?: string | null
  notas?: string | null
  clave: string
}

export function useRegistrarAnticipoMutation(companyId?: string) {
  const invalidar = useInvalidarSaldosFavor(companyId)
  return useMutation({
    mutationFn: async (input: RegistrarAnticipoInput): Promise<ResultadoAnticipo> => {
      const filas = await runQuery<ResultadoAnticipo[]>((signal) =>
        supabase
          .rpc('conta_registrar_anticipo', {
            p_project_id: input.projectId,
            p_unidad_id: input.unidadId,
            p_cliente_id: input.clienteId,
            p_monto: input.monto,
            p_metodo: input.metodo,
            p_fecha: input.fecha,
            p_referencia: input.referencia ?? null,
            p_notas: input.notas ?? null,
            p_pago_id: input.clave,
          })
          .abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado del anticipo.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

export function useAnularAnticipoMutation(companyId?: string) {
  const invalidar = useInvalidarSaldosFavor(companyId)
  return useMutation({
    mutationFn: async (input: { pagoId: string; motivo: string }): Promise<ResultadoAnulacionAnticipo> => {
      const filas = await runQuery<ResultadoAnulacionAnticipo[]>((signal) =>
        supabase.rpc('conta_anular_anticipo', { p_pago_id: input.pagoId, p_motivo: input.motivo }).abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado de la anulación.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

// ── Fallos de un alta: rechazo, clave reusada o resultado incierto ──────────

export type FalloAltaSaldoFavor =
  /** La respuesta no llegó: pudo registrarse o no. */
  | { tipo: 'incierto'; mensaje: string }
  /** La clave ya identifica otra operación con otros datos: ésta no se hizo. */
  | { tipo: 'clave_reusada'; mensaje: string }
  /** El servidor respondió con un error: no se registró nada. */
  | { tipo: 'rechazado'; mensaje: string }

/** SQLSTATE (5 caracteres) o código de PostgREST: el servidor respondió. */
const CODIGO_DE_SERVIDOR = /^([0-9A-Z]{5}|PGRST\d+)$/

/**
 * Sólo un error CON código del servidor prueba que la llamada se ejecutó y
 * se revirtió. Sin código —red caída, tiempo agotado, respuesta vacía— el
 * resultado es incierto.
 */
export function clasificarFalloSaldoFavor(e: unknown): FalloAltaSaldoFavor {
  const mensaje = e instanceof Error ? e.message : String(e)
  const codigo = e instanceof QueryError ? e.cause?.code : undefined
  if (!codigo || !CODIGO_DE_SERVIDOR.test(codigo)) return { tipo: 'incierto', mensaje }
  if (/_CLAVE_REUSADA/.test(mensaje)) return { tipo: 'clave_reusada', mensaje }
  return { tipo: 'rechazado', mensaje }
}

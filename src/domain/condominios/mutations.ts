// T4 · Facturación de dominio — Condominios (cond:C4) — Hooks de ESCRITURA.
//
// Orquesta las transiciones de la máquina de estados de la Cuota (emitir / pagar
// / anular) sobre `cuotas_condominio`. La FUENTE DE VERDAD de la máquina de
// estados y del cálculo de mora/total es `src/lib/businessCondominios.ts` (que a
// su vez reusa `src/lib/business.ts`) — puras: aquí solo validamos con esas
// funciones, construimos el parche a persistir y, tras el write, invalidamos las
// query keys de condominios (cuotas + recargos). NO se duplica la lógica.
//
// La Cuota no es una tabla nueva: son columnas de estado/mora sobre
// `cuotas_condominio` (migración 20260604180000). Por eso los writes apuntan a
// `cuotas_condominio` y las invalidaciones tocan las keys de
// useCuotasConEstadoQuery / useCuotasPorProyectoConEstadoQuery / useRecargosMoraQuery.
//
// Espejo de src/domain/facturacion/mutations.ts (agua:C4), adaptado a la cuota de
// condominio: SIN IVA (la cuota de mantenimiento no es factura comercial gravada,
// ver cabecera de la migración) y el "pago" es all-or-nothing vía estado (no hay
// abono parcial como en agua).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { condominiosKeys } from './keys'
import {
  aplicarTransicionCuota,
  puedeTransicionarCuota,
  calcularTotalCuota,
  type AccionCuota,
  type ParcheTransicionCuota,
} from '../../lib/businessCondominios'

// ────────────────────────────────────────────────────────────────────────────
// Helpers puros (testeables sin Supabase) — construyen el parche a persistir.
// ────────────────────────────────────────────────────────────────────────────

/** Datos mínimos de la cuota que necesitan las mutaciones de transición. */
export interface CuotaTransicionInput {
  id: string
  /** Estado actual canónico (`cuota_estado`) o legacy (`estado`) — se normaliza. */
  cuota_estado?: string | null
  /** Monto base de la cuota (`cuotas_condominio.monto`). */
  monto?: number | null
  /** Recargo de mora ya calculado por el cron/regla (0 si no aplica). */
  mora_monto?: number | null
}

/** Parche que la mutación de EMITIR persiste sobre `cuotas_condominio`. */
export interface EmitirCuotaPatch {
  cuota_estado: string
  emitida_at: string
  fecha_vencimiento: string
  total_a_pagar: number
}

/**
 * Suma `dias` días a una fecha base ISO y devuelve la fecha (YYYY-MM-DD).
 * Defensa: una base no parseable cae a "ahora". Días no finitos → 0.
 * (Misma fórmula que calcularFechaVencimiento de agua — la duplicamos aquí en vez
 * de importar entre sub-dominios para no acoplar condominios a facturación.)
 */
export function calcularFechaVencimientoCuota(baseISO: string, dias: number): string {
  const base = new Date(baseISO)
  const ms = Number.isNaN(base.getTime()) ? Date.now() : base.getTime()
  const d = Number.isFinite(dias) ? Math.trunc(dias) : 0
  const venc = new Date(ms + d * 86_400_000)
  return venc.toISOString().slice(0, 10)
}

/**
 * Construye el parche de EMITIR: valida la transición vía businessCondominios.ts,
 * calcula el snapshot de total (monto + mora, SIN IVA) con `calcularTotalCuota` y
 * fija `fecha_vencimiento = emisión + diasVencimiento` (de la regla de mora del
 * proyecto, `reglas_mora_config.dias_vencimiento`).
 *
 * @param diasVencimiento   Días tras la emisión para el vencimiento (de la regla). Default 30.
 * @param ahora             ISO de emisión (parametrizado para tests deterministas).
 *
 * Lanza si la transición es inválida (mismo contrato que aplicarTransicionCuota).
 */
export function buildEmitirCuotaPatch(
  cuota: CuotaTransicionInput,
  diasVencimiento = 30,
  ahora: string = new Date().toISOString(),
): EmitirCuotaPatch {
  // 1. Validar + obtener timestamp de la transición (lanza si es inválida).
  const transicion: ParcheTransicionCuota = aplicarTransicionCuota(cuota.cuota_estado, 'emitir', ahora)
  // 2. Snapshot de total (mora ya calculada, 0 al emitir salvo que venga dada).
  const monto = Number.isFinite(cuota.monto as number) ? (cuota.monto as number) : 0
  const mora = Number.isFinite(cuota.mora_monto as number) ? (cuota.mora_monto as number) : 0
  const desglose = calcularTotalCuota(monto, mora)
  return {
    cuota_estado: transicion.cuota_estado,
    emitida_at: transicion.emitida_at!,
    fecha_vencimiento: calcularFechaVencimientoCuota(ahora, diasVencimiento),
    total_a_pagar: desglose.total_a_pagar,
  }
}

/** Error de transición lanzado ANTES de tocar la red (gating de UI defensivo). */
export class TransicionCuotaInvalidaError extends Error {
  readonly accion: AccionCuota
  readonly estadoActual: string | null | undefined
  constructor(estadoActual: string | null | undefined, accion: AccionCuota, mensaje?: string) {
    super(mensaje ?? `Transición de cuota inválida: no se puede "${accion}".`)
    this.name = 'TransicionCuotaInvalidaError'
    this.accion = accion
    this.estadoActual = estadoActual
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Invalidación compartida — toca todas las vistas de cuotas/recargos de la
// company. Invalida la raíz del dominio: cubre cuotas (company), cuotas por
// proyecto y recargos de mora sin enumerar cada projectId abierto.
// ────────────────────────────────────────────────────────────────────────────
function useInvalidarCuotas() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: condominiosKeys.all })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 1. EMITIR — pendiente → emitida. Fija fecha_vencimiento + snapshot de total.
// ────────────────────────────────────────────────────────────────────────────
export interface EmitirCuotaVars {
  cuota: CuotaTransicionInput
  /** Días de vencimiento (de la regla de mora aplicable). Default 30. */
  diasVencimiento?: number
}

export function useEmitirCuotaMutation() {
  const invalidar = useInvalidarCuotas()
  return useMutation({
    mutationFn: async ({ cuota, diasVencimiento = 30 }: EmitirCuotaVars) => {
      // Gate defensivo: la UI ya oculta la acción, pero validamos antes del write.
      const check = puedeTransicionarCuota(cuota.cuota_estado, 'emitir')
      if (!check.ok) throw new TransicionCuotaInvalidaError(cuota.cuota_estado, 'emitir', check.error)
      const patch = buildEmitirCuotaPatch(cuota, diasVencimiento)
      await runQuery((signal) =>
        supabase.from('cuotas_condominio').update(patch).eq('id', cuota.id).abortSignal(signal),
      )
      return patch
    },
    onSuccess: invalidar,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 2. PAGAR — emitida|vencida → pagada. El pago de la cuota es all-or-nothing
//    (no hay abono parcial): la transición lleva la cuota a `pagada` y estampa
//    pagada_at + los datos del pago (fecha/método/referencia, opcionales).
// ────────────────────────────────────────────────────────────────────────────
export interface PagarCuotaVars {
  cuota: CuotaTransicionInput
  /** Datos del pago a registrar (opcionales, espejan PagoModal de agua). */
  fechaPago?: string | null
  metodoPago?: string | null
  referenciaPago?: string | null
}

export function usePagarCuotaMutation() {
  const invalidar = useInvalidarCuotas()
  return useMutation({
    mutationFn: async ({ cuota, fechaPago, metodoPago, referenciaPago }: PagarCuotaVars) => {
      const check = puedeTransicionarCuota(cuota.cuota_estado, 'pagar')
      if (!check.ok) throw new TransicionCuotaInvalidaError(cuota.cuota_estado, 'pagar', check.error)
      // Parche = estado + pagada_at (businessCondominios.ts es la fuente del timestamp)
      // + datos del pago. Mantenemos también la columna legacy `estado='pagado'`
      // sincronizada para que la UI actual (que aún lee `estado`) refleje el pago.
      const transicion = aplicarTransicionCuota(cuota.cuota_estado, 'pagar')
      const patch: Record<string, unknown> = {
        cuota_estado: transicion.cuota_estado,
        pagada_at: transicion.pagada_at,
        estado: 'pagado',
      }
      if (fechaPago) patch.fecha_pago = fechaPago
      if (metodoPago) patch.metodo_pago = metodoPago
      if (referenciaPago) patch.referencia_pago = referenciaPago
      await runQuery((signal) =>
        supabase.from('cuotas_condominio').update(patch).eq('id', cuota.id).abortSignal(signal),
      )
      return patch
    },
    onSuccess: invalidar,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 3. ANULAR — pendiente|emitida|vencida → anulada (terminal).
// ────────────────────────────────────────────────────────────────────────────
export interface AnularCuotaVars {
  cuota: CuotaTransicionInput
}

export function useAnularCuotaMutation() {
  const invalidar = useInvalidarCuotas()
  return useMutation({
    mutationFn: async ({ cuota }: AnularCuotaVars) => {
      const check = puedeTransicionarCuota(cuota.cuota_estado, 'anular')
      if (!check.ok) throw new TransicionCuotaInvalidaError(cuota.cuota_estado, 'anular', check.error)
      // Parche = estado + anulada_at (businessCondominios.ts es la fuente del timestamp).
      const patch = aplicarTransicionCuota(cuota.cuota_estado, 'anular')
      await runQuery((signal) =>
        supabase.from('cuotas_condominio').update(patch).eq('id', cuota.id).abortSignal(signal),
      )
      return patch
    },
    onSuccess: invalidar,
  })
}

// ── Importación de contactos de emergencia — T7/PR3 ────────────────────────

/** Inserta contactos de emergencia en lote (import; payload ya armado por la UI). */
export async function createContactosEmergencia(
  rows: Record<string, unknown>[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('contactos_emergencia').insert(rows)
  return { error: error?.message ?? null }
}

// ── Importación de inventario ──────────────────────────────────────────────

/** Inserta items de inventario en lote (import; payload ya armado por la UI). */
export async function createInventarioItems(
  rows: Record<string, unknown>[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('inventario_condominio').insert(rows)
  return { error: error?.message ?? null }
}

// ── Importación de tareas ──────────────────────────────────────────────────

/** Inserta tareas de condominio en lote (import; payload ya armado por la UI). */
export async function createTareasCondominio(
  rows: Record<string, unknown>[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tareas_condominio').insert(rows)
  return { error: error?.message ?? null }
}

// ── Importación de suministros ─────────────────────────────────────────────

/** Inserta suministros de condominio en lote (import; payload ya armado por la UI). */
export async function createSuministrosCondominio(
  rows: Record<string, unknown>[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('suministros_condominio').insert(rows)
  return { error: error?.message ?? null }
}

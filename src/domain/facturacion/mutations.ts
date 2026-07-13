// T4 · Facturación de dominio (agua:C4) — Hooks de ESCRITURA.
//
// Orquesta las transiciones de la máquina de estados de la Factura (emitir /
// anular / registrar pago) y la configuración de facturación del tenant (tasa de
// IVA por defecto + CRUD de reglas de mora). La FUENTE DE VERDAD de la máquina de
// estados y de los cálculos (IVA/mora/total) es `src/lib/business.ts` (puro): aquí
// solo validamos con esas funciones, construimos el parche a persistir y, tras el
// write, invalidamos las query keys de facturación. NO se duplica la lógica.
//
// La Factura no es una tabla nueva: son columnas de estado/IVA/mora sobre
// `registros` (migración 20260604160000). Por eso los writes apuntan a `registros`
// y las invalidaciones tocan las keys de `useFacturasQuery`/`useFacturasPorProyectoQuery`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '../../lib/supabase'
import type { TablesUpdate } from '../../types/database.types'
import { runQuery } from '../queryFetch'
import { FUNNEL, trackFunnel } from '../../lib/analytics'
import { facturacionKeys } from './keys'
import type { ReglaMoraConfig } from './queries'
import {
  aplicarTransicionFactura,
  puedeTransicionarFactura,
  calcularTotalFactura,
  type AccionFactura,
} from '../../lib/business'

// ────────────────────────────────────────────────────────────────────────────
// Helpers puros (testeables sin Supabase) — construyen el parche a persistir.
// ────────────────────────────────────────────────────────────────────────────

/** Datos mínimos de la factura que necesitan las mutaciones de transición. */
export interface FacturaTransicionInput {
  id: string
  /** Estado actual (canónico o legacy — se normaliza en business.ts). */
  factura_estado?: string | null
  /** Subtotal / base imponible (espeja `registros.monto_calculado`). */
  monto_calculado?: number | null
  /** Recargo de mora ya calculado por el cron/regla (0 si no aplica). */
  mora_monto?: number | null
}

/** Parche que la mutación de emitir persiste sobre `registros`. */
export interface EmitirFacturaPatch {
  factura_estado: string
  emitida_at: string
  fecha_vencimiento: string
  iva_tasa: number
  iva_monto: number
  monto_con_iva: number
  total_a_pagar: number
}

/**
 * Particiona un set de facturas en EMITIBLES (transición válida a 'emitida') y las
 * que se OMITEN (ya emitidas/pagadas/anuladas/vencidas). Puro: espeja la máquina de
 * estados de business.ts. Habilita la emisión masiva "por ciclo" sin duplicar la
 * regla de transición. Cada item aporta su `factura_estado` ya resuelto (el de la
 * Factura, o el legacy del registro si aún no se emitió).
 */
export function particionarEmitibles<T extends { factura_estado?: string | null }>(
  facturas: T[],
): { emitibles: T[]; omitidas: T[] } {
  const emitibles: T[] = []
  const omitidas: T[] = []
  for (const f of facturas) {
    if (puedeTransicionarFactura(f.factura_estado ?? null, 'emitir').ok) emitibles.push(f)
    else omitidas.push(f)
  }
  return { emitibles, omitidas }
}

/**
 * Suma `dias` días a una fecha base ISO y devuelve la fecha (YYYY-MM-DD).
 * Defensa: una base no parseable cae a "ahora". Días no finitos → 0.
 */
export function calcularFechaVencimiento(baseISO: string, dias: number): string {
  const base = new Date(baseISO)
  const ms = Number.isNaN(base.getTime()) ? Date.now() : base.getTime()
  const d = Number.isFinite(dias) ? Math.trunc(dias) : 0
  const venc = new Date(ms + d * 86_400_000)
  return venc.toISOString().slice(0, 10)
}

/**
 * Construye el parche de EMITIR: valida la transición vía business.ts, calcula el
 * snapshot de IVA/total con `calcularTotalFactura` (mismo cálculo que persiste la
 * migración) y fija `fecha_vencimiento = emisión + diasVencimiento`.
 *
 * @param ivaTasa           Tasa del tenant (companies.iva_tasa_default). null → default GT.
 * @param diasVencimiento   Días tras la emisión para el vencimiento (de la regla de mora).
 * @param ahora             ISO de emisión (parametrizado para tests deterministas).
 *
 * Lanza si la transición es inválida (mismo contrato que aplicarTransicionFactura).
 */
export function buildEmitirFacturaPatch(
  factura: FacturaTransicionInput,
  ivaTasa?: number | null,
  diasVencimiento = 30,
  ahora: string = new Date().toISOString(),
): EmitirFacturaPatch {
  // 1. Validar + obtener timestamp de la transición (lanza si es inválida).
  const transicion = aplicarTransicionFactura(factura.factura_estado, 'emitir', ahora)
  // 2. Snapshot de IVA/total (mora ya calculada, 0 al emitir salvo que venga dada).
  const subtotal = Number.isFinite(factura.monto_calculado as number)
    ? (factura.monto_calculado as number)
    : 0
  const mora = Number.isFinite(factura.mora_monto as number) ? (factura.mora_monto as number) : 0
  const desglose = calcularTotalFactura(subtotal, ivaTasa, mora)
  return {
    factura_estado: transicion.factura_estado,
    emitida_at: transicion.emitida_at!,
    fecha_vencimiento: calcularFechaVencimiento(ahora, diasVencimiento),
    iva_tasa: desglose.iva_tasa,
    iva_monto: desglose.iva_monto,
    monto_con_iva: desglose.monto_con_iva,
    total_a_pagar: desglose.total_a_pagar,
  }
}

/** Error de transición lanzado ANTES de tocar la red (gating de UI defensivo). */
export class TransicionInvalidaError extends Error {
  readonly accion: AccionFactura
  readonly estadoActual: string | null | undefined
  constructor(estadoActual: string | null | undefined, accion: AccionFactura, mensaje?: string) {
    super(mensaje ?? `Transición inválida: no se puede "${accion}".`)
    this.name = 'TransicionInvalidaError'
    this.accion = accion
    this.estadoActual = estadoActual
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Invalidación compartida — toca todas las vistas de facturación de la company.
// ────────────────────────────────────────────────────────────────────────────
function useInvalidarFacturacion(companyId?: string) {
  const qc = useQueryClient()
  return () => {
    // Invalida toda la raíz del dominio: cubre facturas (company), facturas por
    // proyecto y reglas de mora sin tener que enumerar cada projectId abierto.
    void qc.invalidateQueries({ queryKey: facturacionKeys.all })
    if (companyId) void qc.invalidateQueries({ queryKey: facturacionKeys.facturas(companyId) })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 1. EMITIR — pendiente → emitida. Fija fecha_vencimiento + snapshot de IVA.
// ────────────────────────────────────────────────────────────────────────────
export interface EmitirFacturaVars {
  factura: FacturaTransicionInput
  /** Tasa de IVA del tenant (companies.iva_tasa_default). */
  ivaTasa?: number | null
  /** Días de vencimiento (de la regla de mora aplicable). Default 30. */
  diasVencimiento?: number
}

export function useEmitirFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarFacturacion(companyId)
  return useMutation({
    mutationFn: async ({ factura, ivaTasa, diasVencimiento = 30 }: EmitirFacturaVars) => {
      // Gate defensivo: la UI ya oculta la acción, pero validamos antes del write.
      const check = puedeTransicionarFactura(factura.factura_estado, 'emitir')
      if (!check.ok) throw new TransicionInvalidaError(factura.factura_estado, 'emitir', check.error)
      const patch = buildEmitirFacturaPatch(factura, ivaTasa, diasVencimiento)
      await runQuery((signal) =>
        db.from('registros').update(patch).eq('id', factura.id).abortSignal(signal),
      )
      return patch
    },
    onSuccess: (_data, vars) => {
      // Funnel de monetización (PostHog). Solo ids/flags, sin PII.
      trackFunnel(FUNNEL.facturaEmitida, { factura_id: vars.factura.id, dominio: 'agua' })
      invalidar()
    },
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 2. ANULAR — pendiente|emitida|vencida → anulada (terminal).
// ────────────────────────────────────────────────────────────────────────────
export interface AnularFacturaVars {
  factura: FacturaTransicionInput
  /** Motivo opcional de la anulación (se guarda en notas si la columna existe). */
  motivo?: string
}

export function useAnularFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarFacturacion(companyId)
  return useMutation({
    mutationFn: async ({ factura }: AnularFacturaVars) => {
      const check = puedeTransicionarFactura(factura.factura_estado, 'anular')
      if (!check.ok) throw new TransicionInvalidaError(factura.factura_estado, 'anular', check.error)
      // Parche = estado + anulada_at (business.ts es la fuente del timestamp).
      const patch = aplicarTransicionFactura(factura.factura_estado, 'anular')
      await runQuery((signal) =>
        db.from('registros').update(patch).eq('id', factura.id).abortSignal(signal),
      )
      return patch
    },
    onSuccess: invalidar,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 3. REGISTRAR PAGO — emitida|vencida → pagada. Registra el monto y, si liquida
//    el total, transiciona a `pagada`. Un abono parcial NO cambia el estado.
// ────────────────────────────────────────────────────────────────────────────
export interface RegistrarPagoFacturaVars {
  factura: FacturaTransicionInput
  /** Monto del pago/abono a registrar. */
  monto: number
  /** Abonado previo (registros.monto_pagado). Default 0. */
  abonadoPrevio?: number
  /** Total a cobrar (registros.total_a_pagar ?? monto_calculado). */
  totalACobrar: number
}

/** Resultado de registrar un pago: si liquidó la factura y el nuevo abonado. */
export interface RegistrarPagoResult {
  liquidada: boolean
  nuevoAbonado: number
  /** Estado resultante ('pagada' si liquidó; sin cambio en otro caso). */
  factura_estado: string | null
}

export function useRegistrarPagoFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarFacturacion(companyId)
  return useMutation({
    mutationFn: async ({
      factura,
      monto,
      abonadoPrevio = 0,
      totalACobrar,
    }: RegistrarPagoFacturaVars): Promise<RegistrarPagoResult> => {
      // Solo se puede pagar una factura que esté emitida o vencida.
      const check = puedeTransicionarFactura(factura.factura_estado, 'pagar')
      if (!check.ok) throw new TransicionInvalidaError(factura.factura_estado, 'pagar', check.error)

      const pago = Number.isFinite(monto) && monto > 0 ? monto : 0
      const previo = Number.isFinite(abonadoPrevio) && abonadoPrevio > 0 ? abonadoPrevio : 0
      const nuevoAbonado = previo + pago
      const liquidada = nuevoAbonado >= totalACobrar

      // El estado solo transiciona si el pago liquida el total; un abono parcial
      // deja la factura en su estado actual (emitida/vencida) con más abonado.
      // El parche se tipa contra el esquema generado (P2 tipos).
      const patch: TablesUpdate<'registros'> = { monto_pagado: nuevoAbonado }
      if (liquidada) {
        const transicion = aplicarTransicionFactura(factura.factura_estado, 'pagar')
        patch.factura_estado = transicion.factura_estado
        patch.pagada_at = transicion.pagada_at
      }
      await runQuery((signal) =>
        db.from('registros').update(patch).eq('id', factura.id).abortSignal(signal),
      )
      return {
        liquidada,
        nuevoAbonado,
        factura_estado: liquidada ? (patch.factura_estado as string) : (factura.factura_estado ?? null),
      }
    },
    onSuccess: (data, vars) => {
      trackFunnel(FUNNEL.pagoRegistrado, {
        factura_id: vars.factura.id,
        dominio: 'agua',
        liquidada: data.liquidada,
      })
      invalidar()
    },
  })
}

// ────────────────────────────────────────────────────────────────────────────
// CONFIG · IVA por defecto del tenant (companies.iva_tasa_default).
//   La tasa se guarda como fracción [0,1] (GT = 0.12). La UI captura un % y
//   divide entre 100 antes de llamar.
// ────────────────────────────────────────────────────────────────────────────

/** Tasa de IVA por defecto del tenant. */
export function useIvaTasaDefaultQuery(companyId?: string) {
  return useQuery({
    queryKey: facturacionKeys.ivaTasaDefault(companyId),
    queryFn: async () => {
      const rows = await runQuery<{ iva_tasa_default: number | null }[]>((signal) =>
        db
          .from('companies')
          .select('iva_tasa_default')
          .eq('id', companyId!)
          .limit(1)
          .abortSignal(signal),
      )
      return rows?.[0]?.iva_tasa_default ?? null
    },
    enabled: !!companyId,
  })
}

export function useActualizarIvaTasaDefaultMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tasa: number) => {
      // Defensa: recorta a [0,1]; el editor captura un % y ya divide entre 100.
      let t = Number.isFinite(tasa) ? tasa : 0
      if (t < 0) t = 0
      if (t > 1) t = 1
      await runQuery((signal) =>
        db
          .from('companies')
          .update({ iva_tasa_default: t })
          .eq('id', companyId!)
          .abortSignal(signal),
      )
      return t
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: facturacionKeys.ivaTasaDefault(companyId) })
      // Cambiar el IVA por defecto afecta cómo se emiten futuras facturas.
      void qc.invalidateQueries({ queryKey: facturacionKeys.all })
    },
  })
}

// ────────────────────────────────────────────────────────────────────────────
// CONFIG · CRUD de reglas de mora (reglas_mora_config), scope company + proyecto.
//   Espeja la forma de ReglaMoraTab de condominios pero vía la capa de datos T4,
//   para que la sección de cobros/tarifas de agua pueda gestionar sus reglas.
// ────────────────────────────────────────────────────────────────────────────

export interface ReglaMoraInput {
  company_id: string
  project_id: string
  nombre: string
  dias_vencimiento: number
  tipo: 'porcentaje' | 'monto_fijo'
  valor: number
  aplicar_sobre: 'saldo_vencido' | 'monto_cuota'
  periodo_gracia: number
  notas?: string | null
}

/**
 * TODAS las reglas de mora del tenant (incl. inactivas), para el editor de
 * configuración. `useReglasMoraQuery` (queries.ts) solo devuelve las activas
 * porque alimenta el cálculo; el editor necesita gestionar también las pausadas.
 */
export function useReglasMoraConfigQuery(companyId?: string) {
  return useQuery({
    queryKey: facturacionKeys.reglasMoraConfig(companyId),
    queryFn: async () => {
      const rows =
        (await runQuery((signal) => {
          let q = db
            .from('reglas_mora_config')
            .select('*')
            .order('nombre', { ascending: true })
          if (companyId) q = q.eq('company_id', companyId)
          return q.abortSignal(signal)
        })) ?? []
      // `tipo`/`aplicar_sobre` generadas como string; el dominio las acota (CHECKs en BD).
      return rows.map(
        (r): ReglaMoraConfig => ({
          ...r,
          tipo: r.tipo as ReglaMoraConfig['tipo'],
          aplicar_sobre: r.aplicar_sobre as ReglaMoraConfig['aplicar_sobre'],
        }),
      )
    },
    enabled: !!companyId,
  })
}

function useInvalidarReglasMora(companyId?: string) {
  const qc = useQueryClient()
  return () => {
    // El editor (config, incluye inactivas) y el consumo del cálculo (solo
    // activas) son keys distintas: invalidar ambas tras un cambio.
    void qc.invalidateQueries({ queryKey: facturacionKeys.reglasMora(companyId) })
    void qc.invalidateQueries({ queryKey: facturacionKeys.reglasMoraConfig(companyId) })
  }
}

export function useCrearReglaMoraMutation(companyId?: string) {
  const invalidar = useInvalidarReglasMora(companyId)
  return useMutation({
    // El retorno se pinta ReglaMoraInput | null (contrato previo del hook).
    mutationFn: async (input: ReglaMoraInput): Promise<ReglaMoraInput | null> => {
      const rows = await runQuery((signal) =>
        db.from('reglas_mora_config').insert(input).select().abortSignal(signal),
      )
      const row = rows?.[0]
      if (!row) return null
      // `tipo`/`aplicar_sobre` generadas como string; el dominio las acota (CHECKs en BD).
      return {
        ...row,
        tipo: row.tipo as ReglaMoraInput['tipo'],
        aplicar_sobre: row.aplicar_sobre as ReglaMoraInput['aplicar_sobre'],
      }
    },
    onSuccess: invalidar,
  })
}

export function useActualizarReglaMoraMutation(companyId?: string) {
  const invalidar = useInvalidarReglasMora(companyId)
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ReglaMoraInput> }) => {
      await runQuery((signal) =>
        db.from('reglas_mora_config').update(patch).eq('id', id).abortSignal(signal),
      )
      return { id, patch }
    },
    onSuccess: invalidar,
  })
}

/** Activa/pausa una regla (toggle de `activa`). */
export function useToggleReglaMoraMutation(companyId?: string) {
  const invalidar = useInvalidarReglasMora(companyId)
  return useMutation({
    mutationFn: async ({ id, activa }: { id: string; activa: boolean }) => {
      await runQuery((signal) =>
        db.from('reglas_mora_config').update({ activa }).eq('id', id).abortSignal(signal),
      )
      return { id, activa }
    },
    onSuccess: invalidar,
  })
}

export function useEliminarReglaMoraMutation(companyId?: string) {
  const invalidar = useInvalidarReglasMora(companyId)
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        db.from('reglas_mora_config').delete().eq('id', id).abortSignal(signal),
      )
      return id
    },
    onSuccess: invalidar,
  })
}

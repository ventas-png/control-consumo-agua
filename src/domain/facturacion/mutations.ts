// T4 · Facturación de dominio (agua:C4) — Hooks de ESCRITURA.
//
// Orquesta las transiciones de la máquina de estados de la Factura (emitir /
// anular / registrar pago) y la configuración de facturación del tenant (tasa de
// IVA por defecto + CRUD de reglas de mora).
//
// LA FUENTE DE VERDAD DE LA TRANSICIÓN Y DEL IMPORTE ES EL SERVIDOR. Hasta
// 20260910235732 estas mutaciones construían el parche aquí —estado, snapshot de
// IVA, total, vencimiento, abonado— y lo mandaban como un `UPDATE` a `registros`.
// Eso hacía del navegador el autor del cobro: bastaba un PATCH con
// `total_a_pagar: 0` o `monto_pagado: 999999` para fabricar un recibo, porque la
// policy `registros_update` autoriza por FILA y no mira ni una columna. Ahora cada
// transición es una RPC (`agua_factura_emitir` / `_anular` / `_registrar_pago`)
// que valida el permiso, calcula el importe y deja rastro en `security_logs`; el
// `UPDATE` directo de esas columnas lo rechaza un trigger.
//
// Lo que queda aquí es lo que sigue siendo del cliente: el GATE de la UI (que la
// acción no se ofrezca cuando la transición no aplica, vía `business.ts`) y la
// invalidación de las query keys. La validación de la UI no es la autorización:
// es cortesía, y el servidor la repite.
//
// La Factura no es una tabla nueva: son columnas de estado/IVA/mora sobre
// `registros` (migración 20260604160000). Por eso las invalidaciones tocan las
// keys de `useFacturasQuery`/`useFacturasPorProyectoQuery`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { FUNNEL, trackFunnel } from '../../lib/analytics'
import { facturacionKeys } from './keys'
import type { ReglaMoraConfig } from './queries'
import {
  puedeTransicionarFactura,
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
  /**
   * Días de vencimiento. OPCIONAL y, cuando no se manda, lo resuelve el servidor
   * desde la regla de mora activa del proyecto (?? 30). La tasa de IVA ya no
   * viaja: la lee el servidor de `companies.iva_tasa_default`, porque un cliente
   * que elige su propia tasa elige su propio impuesto.
   */
  diasVencimiento?: number
}

export function useEmitirFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarFacturacion(companyId)
  return useMutation({
    mutationFn: async ({ factura, diasVencimiento }: EmitirFacturaVars) => {
      // Gate de UI: la acción ya está oculta cuando no aplica; esto evita el
      // viaje. La autorización y la máquina de estados las repite el servidor.
      const check = puedeTransicionarFactura(factura.factura_estado, 'emitir')
      if (!check.ok) throw new TransicionInvalidaError(factura.factura_estado, 'emitir', check.error)
      const { data, error } = await supabase.rpc('agua_factura_emitir', {
        p_registro_id: factura.id,
        p_dias_vencimiento: diasVencimiento ?? null,
      })
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: (_data, vars) => {
      // Funnel de monetización (PostHog). Solo ids/flags, sin PII.
      trackFunnel(FUNNEL.facturaEmitida, { factura_id: vars.factura.id, dominio: 'agua' })
      invalidar()
    },
  })
}

// ────────────────────────────────────────────────────────────────────────────
// 1b. CERRAR CICLO — emisión masiva por proyecto/período (RPC set-based).
//     Espejo de condominios_cerrar_ciclo: emite EN UN SOLO statement todos los
//     registros emitibles del mes (misma paridad que buildEmitirFacturaPatch:
//     factura_estado=emitida + vencimiento por regla de mora + snapshot de
//     IVA/total) y avisa al cliente vía el outbox (in_app + email). La emisión
//     por selección (CobrosSection.emitirLoteSeleccion) sigue existiendo para el
//     lote manual; esto cubre "cerrar el mes" de golpe con aviso al residente.
// ────────────────────────────────────────────────────────────────────────────

/** Resultado del cierre de ciclo de agua (RPC `agua_cerrar_ciclo`). */
export interface ResultadoCierreCicloAgua {
  emitidas: number
  avisos: number
  emails: number
  dias_vencimiento: number
  iva_tasa: number
}

/**
 * Cierra el ciclo de facturación de agua de un proyecto/período. La autorización
 * vive server-side (super admin o empresa del proyecto + permiso
 * agua.cobros.change_status); el RPC calcula el snapshot de IVA/total y encola el
 * aviso al cliente (in_app siempre; email si el tenant tiene Gmail).
 */
export async function cerrarCicloAgua(
  projectId: string,
  periodo: string,
  notificar = true,
): Promise<{ data: ResultadoCierreCicloAgua | null; error: { message: string } | null }> {
  const { data, error } = await db.rpc('agua_cerrar_ciclo', {
    p_project_id: projectId,
    p_periodo: periodo,
    p_notificar: notificar,
  })
  // El RPC declara `Returns: Json`; el shape concreto lo fija el SQL del cierre.
  return { data: (data as ResultadoCierreCicloAgua | null) ?? null, error }
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
    mutationFn: async ({ factura, motivo }: AnularFacturaVars) => {
      const check = puedeTransicionarFactura(factura.factura_estado, 'anular')
      if (!check.ok) throw new TransicionInvalidaError(factura.factura_estado, 'anular', check.error)
      const { data, error } = await supabase.rpc('agua_factura_anular', {
        p_registro_id: factura.id,
        p_motivo: motivo ?? null,
      })
      if (error) throw new Error(error.message)
      return data
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
  /** Monto del pago/abono a registrar. Es el ÚNICO número que viaja. */
  monto: number
  /** Fecha del pago (YYYY-MM-DD). Sin ella, la pone el servidor en la zona del tenant. */
  fechaPago?: string | null
}

/** Resultado de registrar un pago: si liquidó la factura y el nuevo abonado. */
export interface RegistrarPagoResult {
  liquidada: boolean
  nuevoAbonado: number
  /** Estado resultante ('pagada' si liquidó; sin cambio en otro caso). */
  factura_estado: string | null
}

/**
 * Registra un pago o abono. El abonado resultante, si liquida, la fecha de pago y
 * la transición de la Factura los decide `agua_factura_registrar_pago`: aquí ya no
 * se calcula el saldo, porque calcularlo en el cliente era justo lo que permitía
 * mandar `monto_pagado` inventado y `factura_estado: 'pagada'` sin que existiera
 * un pago. El servidor además rechaza montos <= 0 y los que exceden el saldo.
 */
export function useRegistrarPagoFacturaMutation(companyId?: string) {
  const invalidar = useInvalidarFacturacion(companyId)
  return useMutation({
    mutationFn: async ({
      factura,
      monto,
      fechaPago,
    }: RegistrarPagoFacturaVars): Promise<RegistrarPagoResult> => {
      // Gate de UI: sólo se cobra una factura emitida o vencida.
      const check = puedeTransicionarFactura(factura.factura_estado, 'pagar')
      if (!check.ok) throw new TransicionInvalidaError(factura.factura_estado, 'pagar', check.error)

      const { data, error } = await supabase.rpc('agua_factura_registrar_pago', {
        p_registro_id: factura.id,
        p_monto: monto,
        p_fecha_pago: fechaPago ?? null,
      })
      if (error) throw new Error(error.message)
      const fila = (Array.isArray(data) ? data[0] : data) as
        | { monto_pagado?: number | null; factura_estado?: string | null }
        | null
      return {
        liquidada: fila?.factura_estado === 'pagada',
        nuevoAbonado: Number(fila?.monto_pagado ?? 0),
        factura_estado: fila?.factura_estado ?? null,
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

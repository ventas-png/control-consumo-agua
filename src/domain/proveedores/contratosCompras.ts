// Contratos de proveedor conectados a las compras — lectura, escritura y el flujo de excepción.
//
// La pantalla OFRECE; el servidor DECIDE. Todo lo que importa (que el contrato sea del mismo proveedor,
// proyecto, empresa y moneda de la orden; que esté vigente al aprobar y emitir; que no rebase su monto
// máximo; quién puede autorizar una excepción; que renovar no toque el contrato anterior; que ampliar
// documente quién, cuánto y por qué) lo hacen cumplir los triggers y las RPC de 20261024*. Aquí no se
// replica ninguna regla: se leen sus resultados y se muestran sus mensajes (CODIGO: texto) tal cual.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { comprasKeys } from '../compras/keys'
import { cxpKeys } from '../cxp/keys'
import { proveedoresKeys } from './keys'
import { rpc } from './queries'
import {
  contratoVigente,
  type ContratoProveedorCatalogo,
  type EtapaExcepcionContrato,
  type SeguimientoContrato,
} from '../../types/proveedores'

// ── Lectura ─────────────────────────────────────────────────────────────────

/** Seguimiento de UN contrato (órdenes, recepciones, facturas, pagos). `null` = sin acceso o inexistente. */
export function useSeguimientoContratoQuery(contratoId?: string | null) {
  return useQuery({
    queryKey: proveedoresKeys.seguimientoContrato(contratoId ?? undefined),
    enabled: !!contratoId,
    queryFn: async () =>
      (await rpc<SeguimientoContrato | null>('compras_contrato_seguimiento', { p_contrato_id: contratoId })) ?? null,
  })
}

/**
 * Contratos con los que se puede AMPARAR una orden nueva de ese proveedor en ese proyecto: activos y
 * vigentes hoy. (El servidor vuelve a comprobar proveedor, proyecto, empresa, moneda y vigencia.)
 */
export function useContratosParaOrdenQuery(
  companyId?: string,
  projectId?: string | null,
  proveedorId?: string | null,
  hoy?: string,
) {
  return useQuery({
    queryKey: proveedoresKeys.contratosParaOrden(companyId, projectId, proveedorId),
    enabled: !!companyId && !!projectId && !!proveedorId,
    queryFn: async () => {
      const filas =
        (await runQuery<ContratoProveedorCatalogo[]>((signal) =>
          supabase
            .from('contratos_proveedores')
            .select('*')
            .eq('company_id', companyId!)
            .eq('project_id', projectId!)
            .eq('proveedor_id', proveedorId!)
            .eq('estado', 'activo')
            .order('fecha_inicio', { ascending: false })
            .abortSignal(signal),
        )) ?? []
      return hoy ? filas.filter((c) => contratoVigente(c, hoy)) : filas
    },
  })
}

/** Órdenes de un proveedor en un proyecto (y, si se indica, de un contrato): lo que se puede evaluar. */
export function useOrdenesProveedorProyectoQuery(
  companyId?: string,
  projectId?: string | null,
  proveedorId?: string | null,
  contratoId?: string | null,
) {
  return useQuery({
    queryKey: [...proveedoresKeys.all, 'ordenes-proveedor-proyecto', companyId ?? null, projectId ?? null, proveedorId ?? null, contratoId ?? null] as const,
    enabled: !!companyId && !!projectId && !!proveedorId,
    queryFn: async () =>
      (await runQuery<Array<{ id: string; numero: string | null; concepto: string; estado: string }>>((signal) => {
        let q = supabase
          .from('ordenes_compra')
          .select('id, numero, concepto, estado')
          .eq('company_id', companyId!)
          .eq('project_id', projectId!)
          .eq('proveedor_id', proveedorId!)
          .neq('estado', 'cancelada')
          .order('created_at', { ascending: false })
          .limit(100)
        if (contratoId) q = q.eq('contrato_id', contratoId)
        return q.abortSignal(signal)
      })) ?? [],
  })
}

// ── Escritura ───────────────────────────────────────────────────────────────

function useInvalidarContratosCompras() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: proveedoresKeys.all })
    void qc.invalidateQueries({ queryKey: comprasKeys.all })
    void qc.invalidateQueries({ queryKey: cxpKeys.all })
  }
}

/** Autoriza (con motivo, auditado) aprobar o emitir una orden cuyo contrato no está vigente o rebasa su monto. */
export function useExcepcionContratoMutation() {
  const invalidar = useInvalidarContratosCompras()
  return useMutation({
    mutationFn: (v: { ordenId: string; etapa: EtapaExcepcionContrato; motivo: string }) =>
      rpc<string>('compras_oc_excepcion_contrato', { p_orden_id: v.ordenId, p_etapa: v.etapa, p_motivo: v.motivo }),
    onSuccess: () => invalidar(),
  })
}

export interface RenovarContratoInput {
  contratoId: string
  fechaInicio: string
  fechaFin: string | null
  motivo: string
  referencia?: string | null
  importePeriodico?: number | null
  montoMaximo?: number | null
}

/** Crea el contrato de renovación en BORRADOR. El anterior no cambia. Reintentar devuelve el mismo. */
export function useRenovarContratoMutation() {
  const invalidar = useInvalidarContratosCompras()
  return useMutation({
    mutationFn: (v: RenovarContratoInput) =>
      rpc<string>('contrato_renovar', {
        p_contrato_id: v.contratoId,
        p_fecha_inicio: v.fechaInicio,
        p_fecha_fin: v.fechaFin,
        p_motivo: v.motivo,
        p_referencia: v.referencia ?? null,
        p_importe_periodico: v.importePeriodico ?? null,
        p_monto_maximo: v.montoMaximo ?? null,
      }),
    onSuccess: () => invalidar(),
  })
}

/** Cambia la fecha final (NULL = indefinido) dejando el motivo en el historial. */
export function useProrrogarContratoMutation() {
  const invalidar = useInvalidarContratosCompras()
  return useMutation({
    mutationFn: (v: { contratoId: string; fechaFin: string | null; motivo: string }) =>
      rpc<string | null>('contrato_prorrogar', { p_contrato_id: v.contratoId, p_fecha_fin: v.fechaFin, p_motivo: v.motivo }),
    onSuccess: () => invalidar(),
  })
}

/**
 * Amplía el monto máximo de un contrato activo. La CLAVE la genera quien abre el diálogo y se reutiliza en cada
 * reintento: así un doble clic o una reconexión no duplican la ampliación.
 */
export function useAmpliarMontoContratoMutation() {
  const invalidar = useInvalidarContratosCompras()
  return useMutation({
    mutationFn: (v: { contratoId: string; incremento: number; motivo: string; clave: string; documento?: string | null }) =>
      rpc<string>('contrato_ampliar_monto', {
        p_contrato_id: v.contratoId,
        p_incremento: v.incremento,
        p_motivo: v.motivo,
        p_clave: v.clave,
        p_documento: v.documento ?? null,
      }),
    onSuccess: () => invalidar(),
  })
}

// ── Flujo de excepción al aprobar o emitir ──────────────────────────────────

/** El rechazo del servidor por contrato fuera de vigencia o monto rebasado. */
export function esContratoNoVigente(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return msg.includes('COMPRAS_CONTRATO_NO_VIGENTE')
}

export interface FlujoExcepcion {
  ordenId: string
  etapa: EtapaExcepcionContrato
  /** Quien tiene el permiso de cambio de estado de Contabilidad. Sin él, el rechazo se muestra tal cual. */
  puedeAutorizar: boolean
  /** La transición (aprobar / emitir). */
  ejecutar: () => Promise<unknown>
  /** Pide el motivo; `null` = no autoriza. Recibe el mensaje del servidor para mostrarlo. */
  pedirMotivo: (mensajeServidor: string) => Promise<string | null>
  autorizar: (v: { ordenId: string; etapa: EtapaExcepcionContrato; motivo: string }) => Promise<unknown>
}

/**
 * Intenta la transición; si el servidor la rechaza porque el contrato no está vigente o rebasa su monto y la
 * persona puede autorizar excepciones, ofrece autorizarla (con motivo) y reintenta UNA vez. Cualquier otro
 * error —y el rechazo cuando no hay permiso o no se autoriza— se relanza sin cambios.
 * Devuelve `'excepcion'` si hizo falta autorizar y `'directa'` si no.
 */
export async function ejecutarConExcepcionContrato(f: FlujoExcepcion): Promise<'directa' | 'excepcion'> {
  try {
    await f.ejecutar()
    return 'directa'
  } catch (e) {
    if (!f.puedeAutorizar || !esContratoNoVigente(e)) throw e
    const motivo = (await f.pedirMotivo((e as Error).message))?.trim()
    if (!motivo) throw e
    await f.autorizar({ ordenId: f.ordenId, etapa: f.etapa, motivo })
    await f.ejecutar()
    return 'excepcion'
  }
}

/** Día siguiente (ISO). Sugerencia para el inicio de una renovación: el día después de que vence el contrato. */
export function diaSiguiente(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/** Estados desde los que un contrato puede renovarse (lo valida el servidor): nunca un borrador ni un cancelado. */
export const ESTADOS_RENOVABLES = ['activo', 'suspendido', 'vencido', 'terminado'] as const

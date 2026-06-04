// T4 / cond:C4 — Hooks de LECTURA del sub-dominio Cuotas de Condominio.
//
// Leen el AGREGADO Cuota: las columnas de estado/mora que añade la migración
// 20260604180000 (cuota_estado, mora_monto, regla_mora_id, total_a_pagar,
// *_at) además de los campos base de `cuotas_condominio`. Siguen la convención
// de src/domain/README.md (queryFn con runQuery, scope por companyId).
//
// IMPORTANTE (orden de adopción, ver README): este PR aterriza la capa de datos;
// los hooks NO se cablean a componentes todavía (la UI de estados/mora es el
// round 2). No migrar la MISMA entidad en dos sitios a la vez mientras la UI
// actual siga haciendo su propio fetch.
//
// Scoping por tenant: RLS de cuotas_condominio/recargos_mora es la defensa
// primaria (company_id = get_my_company_id() + RLS row-level por unidad). Aquí
// replicamos el filtro `.eq('company_id', companyId)` como defensa en
// profundidad, igual que el resto de la capa de datos.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { condominiosKeys } from './keys'
import type { CuotaCondominio, RecargoMora } from '../../types'
import type { EstadoCuotaCanonico } from '../../lib/businessCondominios'

// ────────────────────────────────────────────────────────────────────────────
// Proyección del agregado Cuota: CuotaCondominio (tipo global existente) + las
// columnas nuevas de estado/mora de la migración 180000. Se define aquí (capa de
// dominio) para no tener que tocar src/types mientras la UI no las consume; el
// día que la UI las use, se promueven al tipo global.
// ────────────────────────────────────────────────────────────────────────────
export interface CuotaConEstado extends CuotaCondominio {
  /** Estado canónico de la máquina (cond:C4). NULL en filas legacy sin emitir. */
  cuota_estado?: EstadoCuotaCanonico | null
  /** Recargo por mora persistido (cron cond:C6). */
  mora_monto?: number | null
  /** Regla de mora aplicada (FK reglas_mora_config). */
  regla_mora_id?: string | null
  /** Cuándo se aplicó la mora (idempotencia del cron). */
  mora_aplicada_at?: string | null
  /** Total a pagar = monto + mora (sin IVA). */
  total_a_pagar?: number | null
  // Timestamps de transición de la máquina de estados.
  emitida_at?: string | null
  pagada_at?: string | null
  vencida_at?: string | null
  anulada_at?: string | null
}

// Columnas del agregado Cuota. Explícitas (no `*`) para fijar el contrato de la
// proyección y evitar traer columnas pesadas/irrelevantes.
const CUOTA_AGREGADO_COLS =
  'id,company_id,project_id,unidad_id,concepto,monto,periodo,fecha_vencimiento,' +
  'estado,cuota_estado,pago_id,notas,created_at,fecha_pago,metodo_pago,referencia_pago,' +
  'rubros_detalle,regla_mora_id,mora_monto,mora_aplicada_at,total_a_pagar,' +
  'emitida_at,pagada_at,vencida_at,anulada_at'

/**
 * Cuotas del tenant (scope company) con estado/mora. Excluye soft-deleted
 * (deleted_at IS NULL) y ordena por periodo desc (igual que CuotasTab).
 *
 * El `.select(string)` se tipa como GenericStringError[] sin tipos generados de
 * Supabase, así que runQuery se llama sin genérico y se castea — mismo patrón
 * que useRegistrosCalidadQuery / useMedidoresAguaPorProyectoQuery en agua.
 */
export function useCuotasConEstadoQuery(companyId?: string) {
  return useQuery<CuotaConEstado[]>({
    queryKey: condominiosKeys.cuotas(companyId),
    queryFn: async () =>
      ((await runQuery((signal) => {
        let q = supabase
          .from('cuotas_condominio')
          .select(CUOTA_AGREGADO_COLS)
          .is('deleted_at', null)
          .order('periodo', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? []) as unknown as CuotaConEstado[],
    enabled: !!companyId,
  })
}

/**
 * Cuotas de un proyecto concreto (scope company + proyecto) con estado/mora.
 * Para tableros de cobranza por condominio. Excluye soft-deleted.
 */
export function useCuotasPorProyectoConEstadoQuery(companyId?: string, projectId?: string) {
  return useQuery<CuotaConEstado[]>({
    queryKey: condominiosKeys.cuotasPorProyecto(companyId, projectId),
    queryFn: async () =>
      ((await runQuery((signal) =>
        supabase
          .from('cuotas_condominio')
          .select(CUOTA_AGREGADO_COLS)
          .eq('company_id', companyId!)
          .eq('project_id', projectId!)
          .is('deleted_at', null)
          .order('periodo', { ascending: false })
          .abortSignal(signal),
      )) ?? []) as unknown as CuotaConEstado[],
    enabled: !!companyId && !!projectId,
  })
}

/**
 * Recargos de mora del tenant (ledger recargos_mora, scope company), orden por
 * fecha de aplicación desc. Incluye tanto los de condominios (unidad_id/cuota_id)
 * como, si los hubiera, los de agua (registro_id) — el consumidor filtra según
 * el módulo. RLS scopea por company.
 */
export function useRecargosMoraQuery(companyId?: string) {
  return useQuery<RecargoMora[]>({
    queryKey: condominiosKeys.recargosMora(companyId),
    queryFn: async () =>
      (await runQuery<RecargoMora[]>((signal) => {
        let q = supabase
          .from('recargos_mora')
          .select('*')
          .order('fecha_aplicacion', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

// Contabilidad — Hooks de LECTURA (TanStack Query + runQuery, patrón del repo).
// La agregación pesada (balanza, libro mayor) corre 100% en servidor vía RPC;
// el cliente nunca descarga líneas masivas.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery, runQueryAll } from '../queryFetch'
import { contabilidadKeys } from './keys'
import { normalizarMoneda } from './schemas'
import type {
  AsientoConLineas,
  AsientoContable,
  BalanzaFila,
  CuentaContable,
  MapeoCuenta,
  MovimientoMayor,
  TipoCambio,
} from '../../types/contabilidad'

/** Moneda base contable de la empresa (ISO, espejo de conta_moneda_base). */
export function useMonedaBaseQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: [...contabilidadKeys.all, 'moneda-base', companyId ?? null, projectId ?? null] as const,
    enabled: !!companyId,
    queryFn: async () => {
      // Fuente única con BD: el RPC resuelve empresa (default_currency) o
      // proyecto (su moneda predominante) según el ledger.
      const moneda = await runQuery<string>((signal) =>
        supabase
          .rpc('conta_moneda_base', { p_company_id: companyId!, p_project_id: projectId ?? null })
          .abortSignal(signal),
      )
      return normalizarMoneda(moneda) ?? 'GTQ'
    },
  })
}

/** Catálogo del LEDGER (empresa con projectId null, o proyecto). */
export function useCuentasQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.cuentas(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('conta_cuentas')
        .select('*')
        .eq('company_id', companyId!)
        .order('codigo')
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
      return (await runQuery<CuentaContable[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

/** Filtros de la lista de pólizas. projectId null/ausente = ledger EMPRESA. */
interface AsientosFiltro {
  projectId?: string | null
  periodo?: string
  estado?: string
}

/** Pólizas del ledger, más recientes primero (filtros opcionales). */
export function useAsientosQuery(companyId?: string, filtro: AsientosFiltro = {}) {
  return useQuery({
    queryKey: contabilidadKeys.asientos(companyId, filtro.projectId, filtro.periodo, filtro.estado),
    enabled: !!companyId,
    // PR-25 (auditoría 2026-07-28): el `.limit(500)` anterior truncaba EN SILENCIO
    // el libro. Un tenant con más de 500 asientos veía un ledger incompleto sin
    // ningún aviso — y sobre ese listado se calculan totales. `runQueryAll` trae
    // todo por chunks y avisa si topa el techo de seguridad.
    //
    // El `.order('id')` secundario NO es decorativo: `range()` necesita un orden
    // TOTAL o los chunks se solapan/saltan filas cuando hay empates en `fecha`
    // y `created_at`, que es justo lo que pasa con asientos cargados en lote.
    queryFn: async () =>
      await runQueryAll<AsientoContable>((from, to, signal) => {
        let q = supabase
          .from('conta_asientos')
          .select('*')
          .eq('company_id', companyId!)
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
        // Ledger estricto: null/undefined = contabilidad de la EMPRESA.
        q = filtro.projectId ? q.eq('project_id', filtro.projectId) : q.is('project_id', null)
        if (filtro.periodo) q = q.eq('periodo', filtro.periodo)
        if (filtro.estado) q = q.eq('estado', filtro.estado)
        return q.range(from, to).abortSignal(signal)
      }),
  })
}

/** Detalle de una póliza: cabecera + líneas con su cuenta (código/nombre). */
export function useAsientoDetalleQuery(asientoId?: string) {
  return useQuery({
    queryKey: contabilidadKeys.asiento(asientoId),
    enabled: !!asientoId,
    queryFn: async () => {
      const rows = await runQuery<AsientoConLineas[]>((signal) =>
        supabase
          .from('conta_asientos')
          .select('*, conta_asiento_lineas(*, conta_cuentas(codigo, nombre))')
          .eq('id', asientoId!)
          .limit(1)
          .abortSignal(signal),
      )
      const asiento = rows?.[0] ?? null
      if (asiento) {
        asiento.conta_asiento_lineas.sort((a, b) => a.orden - b.orden)
      }
      return asiento
    },
  })
}

/** Balanza de comprobación del periodo (RPC server-side, RLS aplica). */
export function useBalanzaQuery(companyId?: string, projectId?: string | null, periodo?: string) {
  return useQuery({
    queryKey: contabilidadKeys.balanza(companyId, projectId, periodo),
    enabled: !!companyId && !!periodo,
    queryFn: async () =>
      (await runQuery<BalanzaFila[]>((signal) =>
        supabase
          .rpc('conta_balanza_comprobacion', {
            p_company_id: companyId!,
            p_project_id: projectId ?? null,
            p_periodo: periodo!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Libro mayor de una cuenta en un rango (RPC con saldo acumulado). */
export function useLibroMayorQuery(cuentaId?: string, desde?: string, hasta?: string) {
  return useQuery({
    queryKey: contabilidadKeys.mayor(cuentaId, desde, hasta),
    enabled: !!cuentaId && !!desde && !!hasta,
    queryFn: async () =>
      (await runQuery<MovimientoMayor[]>((signal) =>
        supabase
          .rpc('conta_libro_mayor', {
            p_cuenta_id: cuentaId!,
            p_desde: desde!,
            p_hasta: hasta!,
          })
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Mapeos evento→cuenta de la empresa (defaults + overrides de proyectos). */
export function useMapeoQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.mapeo(companyId, projectId),
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('conta_mapeo_cuentas')
        .select('*')
        .eq('company_id', companyId!)
      q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null)
      return (await runQuery<MapeoCuenta[]>((signal) => q.abortSignal(signal))) ?? []
    },
  })
}

/** Tipos de cambio de la empresa, más recientes primero. */
export function useTiposCambioQuery(companyId?: string) {
  return useQuery({
    queryKey: contabilidadKeys.tiposCambio(companyId),
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<TipoCambio[]>((signal) =>
        supabase
          .from('conta_tipos_cambio')
          .select('*')
          .eq('company_id', companyId!)
          .order('fecha', { ascending: false })
          .limit(200)
          .abortSignal(signal),
      )) ?? [],
  })
}

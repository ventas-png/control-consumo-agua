// T7 — Hooks de query del dominio Agua. EJEMPLO CANÓNICO de la convención.
//
// IMPORTANTE: este PR aterriza el scaffold; los hooks AÚN NO se cablean a
// componentes (ver src/domain/README.md → "Orden de adopción"). Cuando se
// migre, un componente reemplaza su `fetch + useState/useEffect` por:
//
//   const { data: clientes = [], isLoading } = useClientesQuery(companyId)
//
// y deja de recibir esos datos por props desde App/useData. Mientras conviven,
// no se debe migrar la MISMA entidad en dos sitios a la vez (evita doble fetch).
import { useQuery } from '@tanstack/react-query'
import type { Cliente, Registro, Ruta, Contador, Tarifa } from '../../types'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { aguaKeys } from './keys'

// Columnas de listado de registros. NUNCA incluir `foto`: es base64 (hasta
// ~15 MB por fila, TOAST) e infla el payload hasta tumbar el statement_timeout
// de PostgREST. Espeja REGISTROS_LIST_COLS de useData.
const REGISTROS_LIST_COLS =
  'id,cliente_id,cliente_nombre,contador_id,project_id,fecha,lectura_anterior,lectura_actual,consumo,tarifa_aplicada,tarifa_exceso_aplicada,canon_aplicado,monto_calculado,tipo_cobro,estado,monto_pagado,fecha_pago,mes,fecha_lectura_anterior,dias_servicio,notas,gps,created_at'

// `clientes` no tiene columna company_id — el scoping por tenant lo hace RLS vía
// la junction company_clientes. Por eso aquí NO filtramos por company_id (igual
// que useData); el companyId solo entra en la query key para aislar el caché.
export function useClientesQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.clientes(companyId),
    queryFn: async () =>
      (await runQuery<Cliente[]>((signal) =>
        supabase.from('clientes').select('*').abortSignal(signal),
      )) ?? [],
  })
}

// `registros`: RLS scopea por company vía projects + company_clientes. Limit 5000
// para no exceder el statement_timeout en empresas con mucho histórico (el
// dashboard filtra por rango de fechas, no necesita más).
export function useRegistrosQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.registros(companyId),
    queryFn: async () =>
      (await runQuery<Registro[]>((signal) =>
        supabase
          .from('registros')
          .select(REGISTROS_LIST_COLS)
          .order('fecha', { ascending: false })
          .limit(5000)
          .abortSignal(signal),
      )) ?? [],
  })
}

// `rutas` se scopea server-side por RLS. El filtrado fino por proyecto asignado
// (filterRutasByProjectAccess en lib/rutasAccess) se aplica en el consumidor: el
// hook devuelve el set que RLS permite.
export function useRutasQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.rutas(companyId),
    queryFn: async () =>
      (await runQuery<Ruta[]>((signal) =>
        supabase
          .from('rutas')
          .select('*')
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) ?? [],
    enabled: !!companyId,
  })
}

// `tarifas` de agua, scope por empresa (RLS + filtro defensivo por company_id,
// igual que useData). Lista completa del tenant.
export function useTarifasQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.tarifas(companyId),
    queryFn: async () =>
      (await runQuery<Tarifa[]>((signal) => {
        let q = supabase.from('tarifas').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

// ── Lecturas con scope (parametrizadas) ─────────────────────────────────────
// Ejemplo de hooks por-proyecto: los consume MedidoresUnidadTab (módulo
// Condominios) sobre tablas de agua → la capa de datos se comparte entre
// dominios. `enabled` replica el early-return del useEffect original (no dispara
// hasta tener los identificadores de scope).

/** Contadores activos de un proyecto (scope company + proyecto). */
export function useContadoresPorProyectoQuery(companyId: string, proyectoId: string) {
  return useQuery({
    queryKey: aguaKeys.contadoresPorProyecto(companyId, proyectoId),
    queryFn: async () =>
      (await runQuery<Contador[]>((signal) =>
        supabase
          .from('contadores')
          .select('*')
          .eq('project_id', proyectoId)
          .eq('company_id', companyId)
          .eq('activo', true)
          .order('numero_serie')
          .abortSignal(signal),
      )) ?? [],
    enabled: !!companyId && !!proyectoId,
  })
}

/** Fila mínima de consumo — proyección de `registros` para agregación por contador. */
export interface ConsumoRow {
  contador_id: string | null
  consumo: number
  fecha: string
}

/**
 * Consumo (proyección) de un proyecto dentro de un mes `YYYY-MM`. RLS scopea por
 * company; aquí filtramos por proyecto + rango de fechas (igual que el fetch
 * original). El consumidor agrega por contador.
 */
export function useConsumoPorProyectoQuery(proyectoId: string, mes: string) {
  return useQuery({
    queryKey: aguaKeys.consumoPorProyecto(proyectoId, mes),
    queryFn: async () =>
      (await runQuery<ConsumoRow[]>((signal) =>
        supabase
          .from('registros')
          .select('contador_id, consumo, fecha')
          .eq('project_id', proyectoId)
          .gte('fecha', `${mes}-01`)
          .lte('fecha', `${mes}-31`)
          .abortSignal(signal),
      )) ?? [],
    enabled: !!proyectoId,
  })
}

/** Punto de la serie de consumo mensual de agua (m³) de un proyecto. */
export interface ConsumoMensual {
  mes: string
  m3: number
}

/**
 * Consumo mensual (m³) de un proyecto en los últimos ~6 meses, agregado por mes.
 * Lectura DEPENDIENTE en dos pasos (espeja el fetch original de SostenibilidadTab):
 * primero los contadores del proyecto, luego sus registros. Usa las columnas
 * `consumo_m3`/`fecha_lectura` tal cual venían en el componente.
 */
export function useConsumoMensualPorProyectoQuery(companyId: string, proyectoId: string) {
  return useQuery({
    queryKey: aguaKeys.consumoMensualPorProyecto(proyectoId),
    queryFn: async (): Promise<ConsumoMensual[]> => {
      const desde = new Date()
      desde.setMonth(desde.getMonth() - 5)
      desde.setDate(1)
      const desdeStr = desde.toISOString().slice(0, 10)

      const contadores =
        (await runQuery<{ id: string }[]>((signal) =>
          supabase.from('contadores').select('id').eq('project_id', proyectoId).abortSignal(signal),
        )) ?? []
      if (contadores.length === 0) return []

      const rows =
        (await runQuery<{ consumo_m3: number | null; fecha_lectura: string }[]>((signal) =>
          supabase
            .from('registros')
            .select('consumo_m3, fecha_lectura')
            .in('contador_id', contadores.map((c) => c.id))
            .gte('fecha_lectura', desdeStr)
            .order('fecha_lectura')
            .abortSignal(signal),
        )) ?? []

      const byMes: Record<string, number> = {}
      for (const r of rows) {
        const mes = r.fecha_lectura.slice(0, 7)
        byMes[mes] = (byMes[mes] ?? 0) + (r.consumo_m3 ?? 0)
      }
      return Object.entries(byMes)
        .map(([mes, m3]) => ({ mes, m3 }))
        .sort((a, b) => a.mes.localeCompare(b.mes))
    },
    enabled: !!companyId && !!proyectoId,
  })
}

/** Contador con su unidad embebida — proyección para el resumen de medidores. */
export interface MedidorContador {
  id: string
  numero_medidor: string
  unidad_id: string | null
  unidades: { nombre: string } | null
}

/** Registro mínimo para derivar la última lectura por contador. */
export interface MedidorRegistro {
  contador_id: string
  lectura_actual: number | null
  consumo: number | null
  fecha: string
}

export interface MedidoresAguaData {
  contadores: MedidorContador[]
  registros: MedidorRegistro[]
}

/**
 * Datos crudos para el resumen de medidores de agua de un proyecto. Lectura
 * DEPENDIENTE: contadores (con unidad embebida) → sus registros (orden fecha
 * desc, para tomar la última lectura). El consumidor arma el `ResumenMedidor` en
 * un useMemo — incluyendo el fallback de nombre por el prop `unidades` — para que
 * ese prop no entre en la query key ni dispare refetch.
 */
export function useMedidoresAguaPorProyectoQuery(companyId: string, proyectoId: string) {
  return useQuery({
    queryKey: aguaKeys.medidoresAguaPorProyecto(companyId, proyectoId),
    queryFn: async (): Promise<MedidoresAguaData> => {
      // supabase-js infiere el embed `unidades(nombre)` como array (no conoce la
      // cardinalidad sin tipos generados), pero PostgREST devuelve un objeto en
      // una relación to-one. Dejamos inferir y normalizamos el tipo aquí.
      const contadores =
        ((await runQuery((signal) =>
          supabase
            .from('contadores')
            .select('id, numero_medidor, unidad_id, unidades(nombre)')
            .eq('project_id', proyectoId)
            .eq('company_id', companyId)
            .order('numero_medidor')
            .abortSignal(signal),
        )) ?? []) as unknown as MedidorContador[]
      if (contadores.length === 0) return { contadores: [], registros: [] }

      const registros =
        (await runQuery<MedidorRegistro[]>((signal) =>
          supabase
            .from('registros')
            .select('contador_id, lectura_actual, consumo, fecha')
            .in('contador_id', contadores.map((c) => c.id))
            .order('fecha', { ascending: false })
            .abortSignal(signal),
        )) ?? []

      return { contadores, registros }
    },
    enabled: !!companyId && !!proyectoId,
  })
}

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
import type { Cliente, Registro, Ruta, Contador, Tarifa, Unidad, ProveedorEnergia, TarifaEnergia, FuenteEnergia, FacturaEnergia, FuenteAgua, RegistroCalidad, Empresa, Proyecto } from '../../types'
// `db` = cliente TIPADO (P2 tipos). `supabase` (sin tipar) queda SOLO para los
// call sites cuyas columnas no existen en el esquema generado (ver comentarios).
import { db, supabase } from '../../lib/supabase'
import { isProjectExempt } from '../../lib/proyectosAccess'
import { runQuery } from '../queryFetch'
import { aguaKeys } from './keys'

// Columnas de listado de registros. NUNCA incluir `foto`: es base64 (hasta
// ~15 MB por fila, TOAST) e infla el payload hasta tumbar el statement_timeout
// de PostgREST. Espeja REGISTROS_LIST_COLS de useData.
const REGISTROS_LIST_COLS =
  'id,cliente_id,cliente_nombre,contador_id,project_id,fecha,lectura_anterior,lectura_actual,consumo,tarifa_aplicada,tarifa_exceso_aplicada,canon_aplicado,monto_calculado,tipo_cobro,estado,monto_pagado,fecha_pago,mes,fecha_lectura_anterior,dias_servicio,notas,gps,created_at'

/**
 * ¿Existe ya una lectura con esta CLAVE NATURAL (contador + lectura + fecha)? Es la
 * base de la IDEMPOTENCIA de la captura offline: antes de sincronizar una lectura
 * encolada se verifica que no esté ya en la BD, para no duplicar en reintentos
 * (retorno del portal + resincronización). `head:true` no baja filas, solo cuenta.
 */
export async function registroExiste(contadorId: string, lecturaActual: number, fecha: string): Promise<boolean> {
  const { count } = await db
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .eq('contador_id', contadorId)
    .eq('lectura_actual', lecturaActual)
    .eq('fecha', fecha)
  return (count ?? 0) > 0
}

// `projects` (proyectos del tenant). RLS los scopea por empresa; orden por nombre
// igual que useData. Es la ÚLTIMA colección que vivía en useData → cierra
// `agua:A4`. El hook devuelve el set CRUDO que RLS permite; el filtrado fino por
// asignación de proyecto (filterProyectosByAssignment) y la derivación de
// moneda/maxUnidades (deriveProyectoConfig) se aplican en el consumidor (App),
// igual que rutas usa filterRutasByProjectAccess.
export function useProyectosQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.proyectos(companyId),
    queryFn: async () => {
      const rows =
        (await runQuery((signal) =>
          db.from('projects').select('*').order('nombre', { ascending: true }).abortSignal(signal),
        )) ?? []
      // La columna generada `estado` es string; el dominio la acota a EstadoProyecto (CHECK en BD).
      return rows.map((r): Proyecto => ({ ...r, estado: r.estado as Proyecto['estado'] }))
    },
    enabled: !!companyId,
  })
}

// `user_project_assignments` del usuario → ids de proyecto a los que tiene acceso.
// Solo se consulta para roles NO exentos: los exentos ven todos los proyectos, así
// que el fetch sería inútil (espeja el guard de filterDataByAssignment, que ni
// llamaba a Supabase para ellos). Mientras carga, filterProyectosByAssignment hace
// fail-closed (ningún proyecto) para usuarios restringidos.
export function useProyectoAssignmentsQuery(userId?: string, role?: string, assignedRoleIds?: string[]) {
  return useQuery({
    queryKey: aguaKeys.proyectoAssignments(userId),
    queryFn: async () =>
      (await runQuery<{ project_id: string }[]>((signal) =>
        db.from('user_project_assignments').select('project_id').eq('user_id', userId!).abortSignal(signal),
      ))?.map((a) => a.project_id) ?? [],
    enabled: !!userId && !isProjectExempt(role, assignedRoleIds),
  })
}

// `fuentes_agua` del tenant (scope company). Lista completa; el portal de calidad
// la reemplaza vía setFuentesAgua (setQueryData) tras editar.
export function useFuentesAguaQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.fuentesAgua(companyId),
    queryFn: async () =>
      (await runQuery<FuenteAgua[]>((signal) => {
        let q = db.from('fuentes_agua').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        // Row generado: tipo_agua string (unión en el dominio) y activo/created_at NULLABLES
        // vs FuenteAgua no-null (bug latente, reportado) — override en la frontera.
        return q.abortSignal(signal).overrideTypes<FuenteAgua[], { merge: false }>()
      })) ?? [],
    enabled: !!companyId,
  })
}

// `registros_calidad` del tenant (scope company), con la fuente embebida. El portal
// de calidad reemplaza la lista vía setRegistrosCalidad (setQueryData) tras editar.
// El embed ahora lo tipa el cliente `db`; el cast de frontera se mantiene porque el
// Row genera Json/nullables donde RegistroCalidad espera Record/uniones estrechas.
export function useRegistrosCalidadQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.registrosCalidad(companyId),
    queryFn: async () =>
      ((await runQuery((signal) => {
        let q = db
          .from('registros_calidad')
          .select('*, fuentes_agua(identificador, nombre, tipo_agua)')
          .order('fecha', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? []) as unknown as RegistroCalidad[],
    enabled: !!companyId,
  })
}

// `empresa` — objeto único del tenant (RLS lo scopea). Devuelve {} si no hay fila,
// igual que el INITIAL_DATA previo de useData.
export function useEmpresaQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.empresa(companyId),
    queryFn: async () => {
      const rows = await runQuery<Empresa[]>((signal) =>
        db.from('empresa').select('*').limit(1).abortSignal(signal),
      )
      return (rows?.[0] ?? {}) as Empresa
    },
    enabled: !!companyId,
  })
}

// `clientes` — RLS por company vía junction company_clientes (sin company_id directo).
export function useClientesQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.clientes(companyId),
    queryFn: async () =>
      (await runQuery<Cliente[]>((signal) =>
        // Row generado: medidor/lectura_inicial/email/direccion/telefono/updated_at NULLABLES
        // vs Cliente opcional-undefined (bug latente, reportado) — override en la frontera.
        db.from('clientes').select('*').abortSignal(signal).overrideTypes<Cliente[], { merge: false }>(),
      )) ?? [],
    enabled: !!companyId,
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
        db
          .from('registros')
          .select(REGISTROS_LIST_COLS)
          .order('fecha', { ascending: false })
          .limit(5000)
          .abortSignal(signal)
          // Esquema: casi todas las columnas NULLABLES (y estado string, gps Json) vs
          // interfaz Registro no-null/unión (bug latente, reportado) — override frontera.
          .overrideTypes<Registro[], { merge: false }>(),
      )) ?? [],
    enabled: !!companyId,
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
        db
          .from('rutas')
          .select('*')
          .order('created_at', { ascending: false })
          .abortSignal(signal)
          // Esquema: cliente_ids/contador_ids/unidad_ids/dias_semana… son Json y
          // tipo_ruta/frecuencia string vs uniones/arrays de Ruta — override frontera.
          .overrideTypes<Ruta[], { merge: false }>(),
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
        let q = db.from('tarifas').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        // Esquema: tramos es Json y descripcion/created_at/updated_at nullables vs
        // Tarifa (TarifaTramo[] / opcional-undefined) — override en la frontera.
        return q.abortSignal(signal).overrideTypes<Tarifa[], { merge: false }>()
      })) ?? [],
    enabled: !!companyId,
  })
}

// `contadores` (medidores) de agua, lista completa del tenant (scope company:
// RLS + filtro defensivo). Distinta de useContadoresPorProyectoQuery (scoped).
export function useContadoresQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.contadores(companyId),
    queryFn: async () =>
      (await runQuery<Contador[]>((signal) => {
        let q = db.from('contadores').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        // Esquema: tipo_agua string y descripcion/marca/modelo/fechas nullables vs
        // Contador (unión TipoAgua / opcional-undefined) — override en la frontera.
        return q.abortSignal(signal).overrideTypes<Contador[], { merge: false }>()
      })) ?? [],
    enabled: !!companyId,
  })
}

// `unidades` de agua, lista del tenant ordenada por nombre (scope company: RLS +
// filtro defensivo). El orden por nombre espeja useData (y la inserción optimista
// en App reordena al agregar).
export function useUnidadesQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.unidades(companyId),
    queryFn: async () =>
      (await runQuery<Unidad[]>((signal) => {
        let q = db.from('unidades').select('*').order('nombre', { ascending: true })
        if (companyId) q = q.eq('company_id', companyId)
        // Esquema: tipo/tipo_regimen/estado_ocupacional/contrato_suministro string y
        // varios nullables vs uniones/opcionales de Unidad — override en la frontera.
        return q.abortSignal(signal).overrideTypes<Unidad[], { merge: false }>()
      })) ?? [],
    enabled: !!companyId,
  })
}

// `proveedores_energia` del tenant (scope company). Parte del módulo de energía
// (hoy bajo agua; Track T1 / serv:S1 lo promoverá a su propio dominio).
export function useProveedoresEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.proveedoresEnergia(companyId),
    queryFn: async () =>
      (await runQuery<ProveedorEnergia[]>((signal) => {
        let q = db.from('proveedores_energia').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        // Esquema: tipo string y nit/contacto/created_at/updated_at NULLABLES vs
        // ProveedorEnergia no-null (bug latente, reportado) — override en la frontera.
        return q.abortSignal(signal).overrideTypes<ProveedorEnergia[], { merge: false }>()
      })) ?? [],
    enabled: !!companyId,
  })
}

// `tarifas_energia` del tenant (scope company). Módulo de energía (ver T1/serv:S1).
export function useTarifasEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.tarifasEnergia(companyId),
    queryFn: async () =>
      (await runQuery<TarifaEnergia[]>((signal) => {
        let q = db.from('tarifas_energia').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        // Esquema: alumbrado_tipo string y descripcion/created_at/updated_at NULLABLES
        // vs TarifaEnergia no-null (bug latente, reportado) — override en la frontera.
        return q.abortSignal(signal).overrideTypes<TarifaEnergia[], { merge: false }>()
      })) ?? [],
    enabled: !!companyId,
  })
}

// `fuentes_energia` del tenant (scope company). Módulo de energía (ver T1/serv:S1).
export function useFuentesEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.fuentesEnergia(companyId),
    queryFn: async () =>
      (await runQuery<FuenteEnergia[]>((signal) => {
        let q = db.from('fuentes_energia').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        // Esquema: modo_suministro string y fuente_agua_id/proveedor_id/tarifa_id/
        // created_at/updated_at… NULLABLES vs FuenteEnergia (unión / opcional-undefined
        // / no-null; bug latente, reportado) — override en la frontera.
        return q.abortSignal(signal).overrideTypes<FuenteEnergia[], { merge: false }>()
      })) ?? [],
    enabled: !!companyId,
  })
}

// `facturas_energia` del tenant (scope company, orden por periodo_fin). Energía.
export function useFacturasEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.facturasEnergia(companyId),
    queryFn: async () =>
      (await runQuery<FacturaEnergia[]>((signal) => {
        let q = db.from('facturas_energia').select('*').order('periodo_fin', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        // Esquema: estado string y proveedor_id/fecha_pago/created_at/updated_at…
        // NULLABLES vs FacturaEnergia (unión / opcional-undefined / no-null; bug
        // latente, reportado) — override en la frontera.
        return q.abortSignal(signal).overrideTypes<FacturaEnergia[], { merge: false }>()
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
        db
          .from('contadores')
          .select('*')
          .eq('project_id', proyectoId)
          .eq('company_id', companyId)
          .eq('activo', true)
          .order('numero_serie')
          .abortSignal(signal)
          // Mismo mismatch que useContadoresQuery (tipo_agua/nullables) — override frontera.
          .overrideTypes<Contador[], { merge: false }>(),
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
    queryFn: async () => {
      const rows =
        (await runQuery((signal) =>
          db
            .from('registros')
            .select('contador_id, consumo, fecha')
            .eq('project_id', proyectoId)
            .gte('fecha', `${mes}-01`)
            .lte('fecha', `${mes}-31`)
            .abortSignal(signal),
        )) ?? []
      // `consumo` es NULLABLE en el esquema; 0 es neutro para la suma del consumidor.
      return rows.map((r): ConsumoRow => ({ ...r, consumo: r.consumo ?? 0 }))
    },
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
          db.from('contadores').select('id').eq('project_id', proyectoId).abortSignal(signal),
        )) ?? []
      if (contadores.length === 0) return []

      // SIN MIGRAR a `db`: `consumo_m3` y `fecha_lectura` NO existen en el esquema
      // generado de `registros` (bug latente reportado — PostgREST devolvería 400).
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
      // SIN MIGRAR a `db`: `numero_medidor` NO existe en el esquema generado de
      // `contadores` (ahí es `numero_serie`; bug latente reportado — PostgREST
      // devolvería 400). Se mantiene el cliente sin tipar + cast, como antes.
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
          db
            .from('registros')
            .select('contador_id, lectura_actual, consumo, fecha')
            .in('contador_id', contadores.map((c) => c.id))
            .order('fecha', { ascending: false })
            .abortSignal(signal)
            // `contador_id` es nullable en el esquema, pero el .in() sobre ids no
            // nulos garantiza filas con contador_id presente — override frontera.
            .overrideTypes<MedidorRegistro[], { merge: false }>(),
        )) ?? []

      return { contadores, registros }
    },
    enabled: !!companyId && !!proyectoId,
  })
}

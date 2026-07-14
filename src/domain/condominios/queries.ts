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
import { db } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { condominiosKeys } from './keys'
import type {
  CuotaCondominio,
  RecargoMora,
  ConceptoCuota,
  EstadoCuota,
  RubroDetalle,
  TipoRecargo,
  EstadoRecargo,
  TipoResidente,
} from '../../types'
import type { EstadoCuotaCanonico } from '../../lib/businessCondominios'
import type { Tables } from '../../types/database.types'

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
// proyección y evitar traer columnas pesadas/irrelevantes. Template literal (no
// concatenación con `+`) para conservar el tipo LITERAL: así el parser de tipos
// de postgrest-js chequea columnas contra el esquema generado.
const CUOTA_AGREGADO_COLS = `id,company_id,project_id,unidad_id,concepto,monto,periodo,fecha_vencimiento,
  estado,cuota_estado,rol_responsable,pago_id,notas,created_at,fecha_pago,metodo_pago,referencia_pago,
  rubros_detalle,regla_mora_id,mora_monto,mora_aplicada_at,total_a_pagar,
  emitida_at,pagada_at,vencida_at,anulada_at`

/** Fila del esquema generado que proyecta CUOTA_AGREGADO_COLS. */
type CuotaAgregadoRow = Pick<
  Tables<'cuotas_condominio'>,
  | 'id' | 'company_id' | 'project_id' | 'unidad_id' | 'concepto' | 'monto' | 'periodo'
  | 'fecha_vencimiento' | 'estado' | 'cuota_estado' | 'rol_responsable' | 'pago_id' | 'notas'
  | 'created_at' | 'fecha_pago' | 'metodo_pago' | 'referencia_pago' | 'rubros_detalle'
  | 'regla_mora_id' | 'mora_monto' | 'mora_aplicada_at' | 'total_a_pagar'
  | 'emitida_at' | 'pagada_at' | 'vencida_at' | 'anulada_at'
>

/**
 * Mapea la fila generada a la proyección del dominio. Las columnas de estado son
 * `string` en el esquema (el CHECK vive en la tabla); el dominio las acota aquí,
 * en la frontera, sin ensanchar los tipos públicos.
 */
function mapCuotaConEstado(r: CuotaAgregadoRow): CuotaConEstado {
  return {
    ...r,
    concepto: r.concepto as ConceptoCuota,   // string en esquema; CHECK de la tabla
    estado: r.estado as EstadoCuota,         // string en esquema; CHECK de la tabla
    cuota_estado: r.cuota_estado as EstadoCuotaCanonico | null, // ídem (máquina C4)
    rol_responsable: r.rol_responsable as TipoResidente | null, // ídem
    rubros_detalle: r.rubros_detalle as RubroDetalle[] | null,  // Json → shape del dominio
  }
}

/**
 * Cuotas del tenant (scope company) con estado/mora. Excluye soft-deleted
 * (deleted_at IS NULL) y ordena por periodo desc (igual que CuotasTab).
 */
export function useCuotasConEstadoQuery(companyId?: string) {
  return useQuery<CuotaConEstado[]>({
    queryKey: condominiosKeys.cuotas(companyId),
    queryFn: async () => {
      const rows = (await runQuery((signal) => {
        let q = db
          .from('cuotas_condominio')
          .select(CUOTA_AGREGADO_COLS)
          .is('deleted_at', null)
          .order('periodo', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? []
      return rows.map(mapCuotaConEstado)
    },
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
    queryFn: async () => {
      const rows = (await runQuery((signal) =>
        db
          .from('cuotas_condominio')
          .select(CUOTA_AGREGADO_COLS)
          .eq('company_id', companyId!)
          .eq('project_id', projectId!)
          .is('deleted_at', null)
          .order('periodo', { ascending: false })
          .abortSignal(signal),
      )) ?? []
      return rows.map(mapCuotaConEstado)
    },
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
    queryFn: async () => {
      const rows = (await runQuery((signal) => {
        let q = db
          .from('recargos_mora')
          .select('*')
          .order('fecha_aplicacion', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? []
      return rows.map((r): RecargoMora => ({
        ...r,
        tipo: r.tipo as TipoRecargo,       // string en esquema; CHECK de la tabla
        estado: r.estado as EstadoRecargo, // ídem
        // BUG latente: la columna es NULLABLE en el esquema (los recargos de agua
        // van por registro_id, sin unidad); la interfaz del dominio asume string.
        // Cast sin cambiar semántica — reportado en la migración P2.
        unidad_id: r.unidad_id as string,
      }))
    },
    enabled: !!companyId,
  })
}

// ── Dashboard de condominios (stats) — T7/PR3 ──────────────────────────────
// Lecturas imperativas (no-hook) para CondominiosDashboard. La agregación por
// proyecto (todos) se queda en la UI; aquí solo baja el acceso a datos.

function startOfTodayISO(): string {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t.toISOString()
}

/** Conteos del dashboard de condominios para UN proyecto. */
export interface CondominioProjectStats {
  cuotasPendientes: number
  cuotasMora: number
  visitantesHoy: number
  ticketsAbiertos: number
  comunSinAsignar: number
}

/** 5 conteos ligeros (cuotas pendientes/mora, visitantes hoy, tickets abiertos, comun. sin asignar). */
export async function fetchCondominioStatsForProject(
  companyId: string,
  projectId: string,
): Promise<CondominioProjectStats> {
  const todayISO = startOfTodayISO()
  const cuotaBase = () =>
    db.from('cuotas_condominio').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('project_id', projectId)
  const [cuotasPendRes, cuotasMoraRes, visitantesRes, ticketsRes, comunRes] = await Promise.all([
    cuotaBase().eq('estado', 'pendiente').is('deleted_at', null),
    cuotaBase().eq('estado', 'mora').is('deleted_at', null),
    db.from('visitantes').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('project_id', projectId).gte('hora_entrada', todayISO),
    db.from('tickets_mantenimiento').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('project_id', projectId).neq('estado', 'cerrado').is('deleted_at', null),
    db.from('conversations').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('service_type', 'condominios').eq('project_id', projectId)
      .in('status', ['abierta', 'en_progreso', 'esperando_cliente']).is('assigned_to', null),
  ])
  return {
    cuotasPendientes: cuotasPendRes.count ?? 0,
    cuotasMora: cuotasMoraRes.count ?? 0,
    visitantesHoy: visitantesRes.count ?? 0,
    ticketsAbiertos: ticketsRes.count ?? 0,
    comunSinAsignar: comunRes.count ?? 0,
  }
}

/** Filas ligeras para computar stats por proyecto en JS (todos los proyectos). */
export interface CondominioStatsRows {
  cuotas: { project_id: string | null; estado: string }[]
  visitantes: { project_id: string | null }[]
  tickets: { project_id: string | null; estado: string }[]
  conversations: { project_id: string | null }[]
}

/** Trae las filas (cuotas/visitantes/tickets/conversations) del tenant para el dashboard. */
export async function fetchCondominioStatsRows(companyId: string): Promise<CondominioStatsRows> {
  const todayISO = startOfTodayISO()
  const [cuotasRes, visitantesRes, ticketsRes, comunRes] = await Promise.all([
    db.from('cuotas_condominio').select('project_id, estado').eq('company_id', companyId).is('deleted_at', null),
    db.from('visitantes').select('project_id').eq('company_id', companyId).gte('hora_entrada', todayISO),
    db.from('tickets_mantenimiento').select('project_id, estado').eq('company_id', companyId).neq('estado', 'cerrado').is('deleted_at', null),
    db.from('conversations').select('project_id').eq('company_id', companyId)
      .eq('service_type', 'condominios').in('status', ['abierta', 'en_progreso', 'esperando_cliente']).is('assigned_to', null),
  ])
  // Con el cliente tipado las filas ya salen con el shape esperado (sin casts).
  return {
    cuotas: cuotasRes.data ?? [],
    visitantes: visitantesRes.data ?? [],
    tickets: ticketsRes.data ?? [],
    conversations: comunRes.data ?? [],
  }
}

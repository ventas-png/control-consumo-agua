// T4 · Facturación de dominio (agua:C4) — Hooks de LECTURA.
//
// Foundation: lado lectura de la Factura (agregado sobre `registros`) y de las
// reglas de mora. Siguiendo el orden de adopción de src/domain/README.md, estos
// hooks AÚN NO se cablean a componentes en este PR (zero blast radius); la UI de
// cobros/tarifas que los consuma es un follow-up del track.
//
// La Factura no es una tabla nueva: son columnas de estado/IVA/mora sobre
// `registros` (migración 20260604160000). Estos hooks proyectan esos campos.
import { useQuery } from '@tanstack/react-query'
import { db } from '../../lib/supabase'
import { runQuery, runQueryAll } from '../queryFetch'
import { facturacionKeys } from './keys'

// Columnas de facturación a proyectar desde `registros`. NUNCA traer `foto`
// (base64 pesado; espeja REGISTROS_LIST_COLS de agua/queries.ts). Debe ser UN
// string literal (no concatenación) para que supabase-js infiera el select sin
// caer al fallback GenericStringError — igual que REGISTROS_LIST_COLS.
const FACTURA_COLS =
  'id,cliente_id,cliente_nombre,project_id,fecha,mes,monto_calculado,monto_pagado,tipo_cobro,estado,factura_estado,fecha_vencimiento,emitida_at,pagada_at,vencida_at,anulada_at,iva_tasa,iva_monto,monto_con_iva,regla_mora_id,mora_monto,mora_aplicada_at,total_a_pagar'

/**
 * Proyección de `registros` con los campos del agregado Factura (agua:C4).
 * El subtotal es `monto_calculado`; `total_a_pagar` = subtotal + IVA + mora.
 * Los estados legacy ('pagado'/'mora') conviven en `factura_estado` por
 * compatibilidad — normalizar con normalizarEstadoFactura de business.ts.
 */
export interface FacturaRow {
  id: string
  cliente_id: string | null
  cliente_nombre: string | null
  project_id: string | null
  fecha: string
  mes: string | null
  monto_calculado: number | null
  monto_pagado: number | null
  tipo_cobro: string | null
  /** Estado legacy de `registros.estado` (texto libre). */
  estado: string | null
  /** Estado canónico de la máquina (puede ser null en registros sin emitir). */
  factura_estado: string | null
  fecha_vencimiento: string | null
  emitida_at: string | null
  pagada_at: string | null
  vencida_at: string | null
  anulada_at: string | null
  iva_tasa: number | null
  iva_monto: number | null
  monto_con_iva: number | null
  regla_mora_id: string | null
  mora_monto: number | null
  mora_aplicada_at: string | null
  total_a_pagar: number | null
}

/** Fila de reglas_mora_config (config de mora por proyecto). */
export interface ReglaMoraConfig {
  id: string
  company_id: string
  project_id: string
  nombre: string
  dias_vencimiento: number
  tipo: 'porcentaje' | 'monto_fijo'
  valor: number
  aplicar_sobre: 'saldo_vencido' | 'monto_cuota'
  periodo_gracia: number
  activa: boolean
  notas: string | null
  created_at: string
}

/**
 * Facturas (registros con campos de facturación) del tenant. RLS scopea por
 * company vía projects + company_clientes (igual que useRegistrosQuery).
 * Fase 6: fetch COMPLETO por chunks — el limit 5000 truncaba en silencio el
 * índice facturaById y el conteo de cierre de ciclo en históricos grandes;
 * cada chunk corre con su propio timeout así que el statement_timeout que
 * motivó el cap ya no es riesgo. order('id') secundario = orden total estable.
 */
export function useFacturasQuery(companyId?: string) {
  return useQuery({
    queryKey: facturacionKeys.facturas(companyId),
    queryFn: async () =>
      await runQueryAll<FacturaRow>((from, to, signal) =>
        db
          .from('registros')
          .select(FACTURA_COLS)
          .is('deleted_at', null) // E2: lecturas soft-deleted fuera de facturación
          .order('fecha', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
          .abortSignal(signal),
      ),
    enabled: !!companyId,
  })
}

/**
 * Facturas de un proyecto concreto (scope company + proyecto). RLS scopea por
 * company; aquí filtramos por project_id. Útil para el tablero de cobranza de un
 * condominio/servicio puntual. Fase 6: fetch completo por chunks (ver arriba).
 */
export function useFacturasPorProyectoQuery(companyId?: string, projectId?: string) {
  return useQuery({
    queryKey: facturacionKeys.facturasPorProyecto(companyId, projectId),
    queryFn: async () =>
      await runQueryAll<FacturaRow>((from, to, signal) =>
        db
          .from('registros')
          .select(FACTURA_COLS)
          .eq('project_id', projectId!)
          .is('deleted_at', null) // E2
          .order('fecha', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
          .abortSignal(signal),
      ),
    enabled: !!companyId && !!projectId,
  })
}

/**
 * Reglas de mora del tenant (reglas_mora_config). RLS + filtro defensivo por
 * company_id. Solo las activas, ordenadas por nombre. Las consume el cálculo de
 * mora (calcularMora de business.ts) y la futura UI de tarifas/mora.
 */
export function useReglasMoraQuery(companyId?: string) {
  return useQuery({
    queryKey: facturacionKeys.reglasMora(companyId),
    queryFn: async () => {
      const rows =
        (await runQuery((signal) => {
          let q = db
            .from('reglas_mora_config')
            .select('*')
            .eq('activa', true)
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

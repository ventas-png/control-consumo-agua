// ════════════════════════════════════════════════════════════════════════════
// Tipo de cambio MENSUAL (20261008000000)
//
// Una tasa por empresa, moneda y mes: 1 unidad de `moneda` = `tasa` unidades
// de `moneda_base` (la moneda de la EMPRESA, que fija el servidor). Es la
// única fuente de conversión: compras, ventas, cobros, revaluación y saldos a
// favor usan la del MES del documento. Sin ella, el asiento queda en borrador
// y no se publica hasta configurarla; nunca se usa la de otro mes.
//
// Cambiar una tasa no recalcula asientos publicados. Cada alta, cambio o baja
// queda en la bitácora del servidor (hora, usuario, valor anterior y nuevo).
// Las tasas diarias anteriores son historia: ya no convierten.
// ════════════════════════════════════════════════════════════════════════════
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { contabilidadKeys } from './keys'

export interface TipoCambioMensual {
  id: string
  company_id: string
  /** ISO 4217 de la moneda de origen. */
  moneda: string
  /** ISO 4217 de la moneda de la empresa (a la que se convierte). */
  moneda_base: string
  /** YYYY-MM */
  periodo: string
  tasa: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

export interface CambioTipoCambio {
  id: string
  tipo_cambio_id: string
  accion: 'alta' | 'cambio' | 'baja'
  moneda: string
  moneda_base: string
  periodo: string
  tasa_anterior: number | null
  tasa_nueva: number | null
  actor: string | null
  ocurrido_at: string
}

export const tipoCambioMensualSchema = z.object({
  moneda: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Código ISO de 3 letras (ej. USD)'),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes con formato AAAA-MM'),
  // Seis decimales: la precisión con que se guarda y convierte.
  tasa: z.number().positive('La tasa debe ser mayor que 0').refine(
    (v) => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-6, 'La tasa admite hasta 6 decimales'),
})

export type TipoCambioMensualInput = z.infer<typeof tipoCambioMensualSchema>

/** Tasas mensuales de la empresa, más recientes primero. */
export function useTiposCambioMensualQuery(companyId?: string) {
  return useQuery({
    queryKey: [...contabilidadKeys.all, 'tipos-cambio-mensual', companyId ?? null] as const,
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<TipoCambioMensual[]>((signal) =>
        supabase
          .from('conta_tipos_cambio_mensual')
          .select('*')
          .eq('company_id', companyId!)
          .order('periodo', { ascending: false })
          .order('moneda')
          .limit(240)
          .abortSignal(signal),
      )) ?? [],
  })
}

/** Últimos cambios de la configuración (bitácora del servidor). */
export function useHistorialTipoCambioQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: [...contabilidadKeys.all, 'tipos-cambio-mensual', companyId ?? null, 'historial'] as const,
    enabled: enabled && !!companyId,
    queryFn: async () =>
      (await runQuery<CambioTipoCambio[]>((signal) =>
        supabase
          .from('conta_tipos_cambio_mensual_historial')
          .select('*')
          .eq('company_id', companyId!)
          .order('ocurrido_at', { ascending: false })
          .limit(50)
          .abortSignal(signal),
      )) ?? [],
  })
}

/** La moneda de la empresa: la base de todas las tasas. */
export function useMonedaEmpresaQuery(companyId?: string) {
  return useQuery({
    queryKey: [...contabilidadKeys.all, 'moneda-empresa', companyId ?? null] as const,
    enabled: !!companyId,
    queryFn: async () =>
      (await runQuery<string>((signal) =>
        supabase.rpc('conta_moneda_base', { p_company_id: companyId!, p_project_id: null as unknown as string })
          .abortSignal(signal),
      )) ?? null,
  })
}

/**
 * Registra la tasa de un mes o cambia la existente. La moneda base, el autor
 * y las fechas los fija el servidor; la bitácora la escribe un trigger.
 */
export function useGuardarTipoCambioMensualMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: TipoCambioMensualInput & { id?: string | null }) => {
      if (!companyId) throw new Error('Falta companyId.')
      if (input.id) {
        await runQuery((signal) =>
          supabase.from('conta_tipos_cambio_mensual').update({ tasa: input.tasa })
            .eq('id', input.id!).abortSignal(signal))
      } else {
        await runQuery((signal) =>
          supabase.from('conta_tipos_cambio_mensual')
            .insert({ company_id: companyId, moneda: input.moneda, periodo: input.periodo, tasa: input.tasa,
                      moneda_base: '' })
            .abortSignal(signal))
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'tipos-cambio-mensual', companyId ?? null] })
    },
  })
}

/**
 * Tasa mensual de `de` → `a` para un mes, como la calcula el servidor
 * (conta_tasa_entre): vía la moneda de la EMPRESA (pivote) y con las tasas del
 * MISMO mes, redondeada a 6 decimales. `null` si falta alguna: nunca se usa la
 * de otro mes. Sirve para PROPONER la tasa en una póliza manual (decisión B1).
 */
export function tasaMensualEntre(
  tasas: Pick<TipoCambioMensual, 'moneda' | 'periodo' | 'tasa'>[],
  de: string,
  a: string,
  periodo: string,
  monedaEmpresa: string,
): number | null {
  const norm = (m: string) => m.trim().toUpperCase()
  const [d, b, piv] = [norm(de), norm(a), norm(monedaEmpresa)]
  if (d === b) return 1
  const tasaDe = (m: string) =>
    m === piv ? 1 : (tasas.find((t) => norm(t.moneda) === m && t.periodo === periodo)?.tasa ?? null)
  const vDe = tasaDe(d)
  const vA = tasaDe(b)
  if (vDe == null || vA == null || vA === 0) return null
  return Math.round((vDe / vA) * 1e6) / 1e6
}

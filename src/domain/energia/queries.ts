import { useQuery } from '@tanstack/react-query'
import type { ProveedorEnergia, TarifaEnergia, FuenteEnergia, FacturaEnergia } from '../../types'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { energiaKeys } from './keys'

export function useProveedoresEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: energiaKeys.proveedores(companyId),
    queryFn: async () =>
      (await runQuery<ProveedorEnergia[]>((signal) => {
        let q = supabase.from('proveedores_energia').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

export function useTarifasEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: energiaKeys.tarifas(companyId),
    queryFn: async () =>
      (await runQuery<TarifaEnergia[]>((signal) => {
        let q = supabase.from('tarifas_energia').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

export function useFuentesEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: energiaKeys.fuentes(companyId),
    queryFn: async () =>
      (await runQuery<FuenteEnergia[]>((signal) => {
        let q = supabase.from('fuentes_energia').select('*').order('created_at', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

export function useFacturasEnergiaQuery(companyId?: string) {
  return useQuery({
    queryKey: energiaKeys.facturas(companyId),
    queryFn: async () =>
      (await runQuery<FacturaEnergia[]>((signal) => {
        let q = supabase.from('facturas_energia').select('*').order('periodo_fin', { ascending: false })
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

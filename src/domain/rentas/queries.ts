import { useQuery } from '@tanstack/react-query'
import type { ArticuloInventarioRenta, ContratoRenta, PropiedadRenta, ReservaRenta, ReservaSTR } from '../../types'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { rentasKeys } from './keys'

// Cada lista se pide sólo si la persona puede ver ese módulo (`enabled`): sin
// el permiso la RLS devolvería vacío igual, pero no hace falta el viaje.

export function usePropiedadesRentaQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: rentasKeys.propiedades(companyId),
    queryFn: async () =>
      (await runQuery<PropiedadRenta[]>((signal) =>
        supabase.from('rentas_propiedades').select('*').eq('company_id', companyId ?? '')
          .order('nombre', { ascending: true }).abortSignal(signal)
          .overrideTypes<PropiedadRenta[], { merge: false }>())) ?? [],
    enabled: !!companyId && enabled,
  })
}

export function useReservasRentaQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: rentasKeys.reservas(companyId),
    queryFn: async () =>
      (await runQuery<ReservaRenta[]>((signal) =>
        supabase.from('rentas_reservas').select('*').eq('company_id', companyId ?? '')
          .order('fecha_entrada', { ascending: false }).abortSignal(signal)
          .overrideTypes<ReservaRenta[], { merge: false }>())) ?? [],
    enabled: !!companyId && enabled,
  })
}

/**
 * Reservas de `reservas_str` de las unidades enlazadas a una propiedad en
 * renta. Las lee bajo la RLS de Condominios: quien no tiene la pestaña STR
 * recibe una lista vacía (y un error de la consulta no tumba la pantalla de
 * Rentas: sus propias reservas se siguen viendo).
 */
export function useReservasStrEnlazadasQuery(companyId: string | undefined, unidadIds: string[], enabled = true) {
  const ids = [...unidadIds].sort()
  return useQuery({
    queryKey: rentasKeys.reservasStr(companyId, ids),
    queryFn: async () =>
      (await runQuery<ReservaSTR[]>((signal) =>
        supabase.from('reservas_str').select('*').eq('company_id', companyId ?? '').in('unidad_id', ids)
          .order('fecha_entrada', { ascending: false }).abortSignal(signal)
          .overrideTypes<ReservaSTR[], { merge: false }>())) ?? [],
    enabled: !!companyId && enabled && ids.length > 0,
  })
}

export function useContratosRentaQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: rentasKeys.contratos(companyId),
    queryFn: async () =>
      (await runQuery<ContratoRenta[]>((signal) =>
        supabase.from('rentas_contratos').select('*').eq('company_id', companyId ?? '')
          .order('fecha_inicio', { ascending: false }).abortSignal(signal)
          .overrideTypes<ContratoRenta[], { merge: false }>())) ?? [],
    enabled: !!companyId && enabled,
  })
}

export function useInventarioRentaQuery(companyId?: string, enabled = true) {
  return useQuery({
    queryKey: rentasKeys.inventario(companyId),
    queryFn: async () =>
      (await runQuery<ArticuloInventarioRenta[]>((signal) =>
        supabase.from('rentas_inventario').select('*').eq('company_id', companyId ?? '')
          .order('nombre', { ascending: true }).abortSignal(signal)
          .overrideTypes<ArticuloInventarioRenta[], { merge: false }>())) ?? [],
    enabled: !!companyId && enabled,
  })
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProveedorEnergia, TarifaEnergia, FuenteEnergia, FacturaEnergia } from '../../types'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { energiaKeys } from './keys'

// ── Proveedores ──────────────────────────────────────────────────────────────

export function useCrearProveedorEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Omit<ProveedorEnergia, 'id' | 'created_at' | 'updated_at'>) => {
      const result = await runQuery<ProveedorEnergia>((signal) =>
        supabase.from('proveedores_energia').insert([payload]).select().abortSignal(signal).single()
      )
      if (!result) throw new Error('No se pudo crear el proveedor')
      return result
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.proveedores(companyId) })
    },
  })
}

export function useActualizarProveedorEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<ProveedorEnergia> }) => {
      await runQuery((signal) =>
        supabase
          .from('proveedores_energia')
          .update({ ...vars.patch, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.proveedores(companyId) })
    },
  })
}

export function useEliminarProveedorEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        supabase.from('proveedores_energia').delete().eq('id', id).abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.proveedores(companyId) })
    },
  })
}

// ── Tarifas ──────────────────────────────────────────────────────────────────

export function useCrearTarifaEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Omit<TarifaEnergia, 'id' | 'created_at' | 'updated_at'>) => {
      const result = await runQuery<TarifaEnergia>((signal) =>
        supabase.from('tarifas_energia').insert([payload]).select().abortSignal(signal).single()
      )
      if (!result) throw new Error('No se pudo crear la tarifa')
      return result
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.tarifas(companyId) })
    },
  })
}

export function useActualizarTarifaEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<TarifaEnergia> }) => {
      await runQuery((signal) =>
        supabase
          .from('tarifas_energia')
          .update({ ...vars.patch, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.tarifas(companyId) })
    },
  })
}

export function useEliminarTarifaEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        supabase.from('tarifas_energia').delete().eq('id', id).abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.tarifas(companyId) })
    },
  })
}

// ── Fuentes ──────────────────────────────────────────────────────────────────

export function useCrearFuenteEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Omit<FuenteEnergia, 'id' | 'created_at' | 'updated_at'>) => {
      const result = await runQuery<FuenteEnergia>((signal) =>
        supabase.from('fuentes_energia').insert([payload]).select().abortSignal(signal).single()
      )
      if (!result) throw new Error('No se pudo crear la fuente')
      return result
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.fuentes(companyId) })
    },
  })
}

export function useActualizarFuenteEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<FuenteEnergia> }) => {
      await runQuery((signal) =>
        supabase
          .from('fuentes_energia')
          .update({ ...vars.patch, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.fuentes(companyId) })
    },
  })
}

export function useEliminarFuenteEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        supabase.from('fuentes_energia').delete().eq('id', id).abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.fuentes(companyId) })
    },
  })
}

// ── Facturas ─────────────────────────────────────────────────────────────────

export function useCrearFacturaEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Omit<FacturaEnergia, 'id' | 'created_at' | 'updated_at'>) => {
      const result = await runQuery<FacturaEnergia>((signal) =>
        supabase.from('facturas_energia').insert([payload]).select().abortSignal(signal).single()
      )
      if (!result) throw new Error('No se pudo crear la factura')
      return result
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.facturas(companyId) })
    },
  })
}

export function useActualizarFacturaEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<FacturaEnergia> }) => {
      await runQuery((signal) =>
        supabase
          .from('facturas_energia')
          .update({ ...vars.patch, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.facturas(companyId) })
    },
  })
}

export function useEliminarFacturaEnergiaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        supabase.from('facturas_energia').delete().eq('id', id).abortSignal(signal)
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: energiaKeys.facturas(companyId) })
    },
  })
}

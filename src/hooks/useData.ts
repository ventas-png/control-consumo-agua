import { useState, useCallback } from 'react'
import Swal from 'sweetalert2'
import type { Cliente, Registro, Empresa, FuenteAgua, RegistroCalidad } from '../types'
import { supabase } from '../lib/supabase'

interface AppData {
  clientes: Cliente[]
  registros: Registro[]
  empresa: Empresa
  fuentesAgua: FuenteAgua[]
  registrosCalidad: RegistroCalidad[]
}

const INITIAL_DATA: AppData = {
  clientes: [],
  registros: [],
  empresa: {},
  fuentesAgua: [],
  registrosCalidad: [],
}

export function useData() {
  const [data, setData] = useState<AppData>(INITIAL_DATA)

  const cargarDatos = useCallback(async () => {
    const [clRes, regRes, empRes, fuaRes, rcalRes] = await Promise.allSettled([
      supabase.from('clientes').select('*'),
      supabase.from('registros').select('*'),
      supabase.from('empresa').select('*').limit(1),
      supabase.from('fuentes_agua').select('*').order('created_at', { ascending: false }),
      supabase
        .from('registros_calidad')
        .select('*, fuentes_agua(identificador, nombre, tipo_agua)')
        .order('fecha', { ascending: false }),
    ])

    setData(prev => {
      const next = { ...prev }
      if (clRes.status === 'fulfilled' && clRes.value.data) {
        next.clientes = clRes.value.data as Cliente[]
      }
      if (regRes.status === 'fulfilled' && regRes.value.data) {
        next.registros = regRes.value.data as Registro[]
      }
      if (empRes.status === 'fulfilled' && empRes.value.data?.length) {
        next.empresa = empRes.value.data[0] as Empresa
      }
      if (fuaRes.status === 'fulfilled' && fuaRes.value.data) {
        next.fuentesAgua = fuaRes.value.data as FuenteAgua[]
      }
      if (rcalRes.status === 'fulfilled' && rcalRes.value.data) {
        next.registrosCalidad = rcalRes.value.data as RegistroCalidad[]
      }
      return next
    })

    const anyError =
      (clRes.status === 'fulfilled' && clRes.value.error) ||
      (regRes.status === 'fulfilled' && regRes.value.error)

    if (anyError) {
      Swal.fire('Modo Offline', 'No se pudo conectar a la base de datos.', 'warning')
    }
  }, [])

  const addCliente = useCallback((cliente: Cliente) => {
    setData(prev => ({ ...prev, clientes: [...prev.clientes, cliente] }))
  }, [])

  const addRegistro = useCallback((registro: Registro) => {
    setData(prev => ({ ...prev, registros: [...prev.registros, registro] }))
  }, [])

  const updateRegistroEstado = useCallback((id: string, estado: Registro['estado']) => {
    setData(prev => ({
      ...prev,
      registros: prev.registros.map(r => (r.id === id ? { ...r, estado } : r)),
    }))
  }, [])

  const setFuentesAgua = useCallback((fuentes: FuenteAgua[]) => {
    setData(prev => ({ ...prev, fuentesAgua: fuentes }))
  }, [])

  const setRegistrosCalidad = useCallback((registros: RegistroCalidad[]) => {
    setData(prev => ({ ...prev, registrosCalidad: registros }))
  }, [])

  const recargarFuentesAgua = useCallback(async () => {
    const { data: fua } = await supabase
      .from('fuentes_agua')
      .select('*')
      .order('created_at', { ascending: false })
    if (fua) setData(prev => ({ ...prev, fuentesAgua: fua as FuenteAgua[] }))
  }, [])

  const recargarRegistrosCalidad = useCallback(async () => {
    const { data: rcal } = await supabase
      .from('registros_calidad')
      .select('*, fuentes_agua(identificador, nombre, tipo_agua)')
      .order('fecha', { ascending: false })
    if (rcal) setData(prev => ({ ...prev, registrosCalidad: rcal as RegistroCalidad[] }))
  }, [])

  return {
    ...data,
    cargarDatos,
    addCliente,
    addRegistro,
    updateRegistroEstado,
    setFuentesAgua,
    setRegistrosCalidad,
    recargarFuentesAgua,
    recargarRegistrosCalidad,
  }
}

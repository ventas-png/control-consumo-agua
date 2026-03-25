import { useState, useCallback } from 'react'
import Swal from 'sweetalert2'
import type { Cliente, Registro, Empresa, FuenteAgua, RegistroCalidad, Ruta, Tarifa, Contador, Unidad, MaxUnidadesPorTipo } from '../types'
import { supabase } from '../lib/supabase'

interface AppData {
  clientes: Cliente[]
  registros: Registro[]
  empresa: Empresa
  fuentesAgua: FuenteAgua[]
  registrosCalidad: RegistroCalidad[]
  rutas: Ruta[]
  tarifas: Tarifa[]
  contadores: Contador[]
  unidades: Unidad[]
  moneda: string
  maxUnidadesPorTipo: MaxUnidadesPorTipo | null
}

const INITIAL_DATA: AppData = {
  clientes: [],
  registros: [],
  empresa: {},
  fuentesAgua: [],
  registrosCalidad: [],
  rutas: [],
  tarifas: [],
  contadores: [],
  unidades: [],
  moneda: 'Q',
  maxUnidadesPorTipo: null,
}

export function useData() {
  const [data, setData] = useState<AppData>(INITIAL_DATA)

  const cargarDatos = useCallback(async () => {
    // Auto-desactivar tarifas cuya fecha_revision ya pasó
    try { await supabase.rpc('deactivate_expired_tarifas') } catch { /* silencioso */ }

    const [clRes, regRes, empRes, fuaRes, rcalRes, rutasRes, tarifasRes, contadoresRes, unidadesRes, proyectoRes] = await Promise.allSettled([
      supabase.from('clientes').select('*'),
      supabase.from('registros').select('*'),
      supabase.from('empresa').select('*').limit(1),
      supabase.from('fuentes_agua').select('*').order('created_at', { ascending: false }),
      supabase
        .from('registros_calidad')
        .select('*, fuentes_agua(identificador, nombre, tipo_agua)')
        .order('fecha', { ascending: false }),
      supabase.from('rutas').select('*').order('created_at', { ascending: false }),
      supabase.from('tarifas').select('*').order('created_at', { ascending: false }),
      supabase.from('contadores').select('*').order('created_at', { ascending: false }),
      supabase.from('unidades').select('*').order('nombre', { ascending: true }),
      supabase.from('projects').select('moneda, max_unidades_apartamento, max_unidades_casa, max_unidades_bodega, max_unidades_local_comercial, max_unidades_oficina, max_unidades_parqueadero, max_unidades_otro').limit(1),
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
      if (rutasRes.status === 'fulfilled' && rutasRes.value.data) {
        next.rutas = rutasRes.value.data as Ruta[]
      }
      if (tarifasRes.status === 'fulfilled' && tarifasRes.value.data) {
        next.tarifas = tarifasRes.value.data as Tarifa[]
      }
      if (contadoresRes.status === 'fulfilled' && contadoresRes.value.data) {
        next.contadores = contadoresRes.value.data as Contador[]
      }
      if (unidadesRes.status === 'fulfilled' && unidadesRes.value.data) {
        next.unidades = unidadesRes.value.data as Unidad[]
      }
      if (proyectoRes.status === 'fulfilled' && proyectoRes.value.data?.[0]) {
        const p = proyectoRes.value.data[0]
        next.moneda = p.moneda ?? 'Q'
        next.maxUnidadesPorTipo = {
          apartamento:     p.max_unidades_apartamento ?? null,
          casa:            p.max_unidades_casa ?? null,
          bodega:          p.max_unidades_bodega ?? null,
          local_comercial: p.max_unidades_local_comercial ?? null,
          oficina:         p.max_unidades_oficina ?? null,
          parqueadero:     p.max_unidades_parqueadero ?? null,
          otro:            p.max_unidades_otro ?? null,
        }
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

  const updateCliente = useCallback((id: string, partial: Partial<Cliente>) => {
    setData(prev => ({
      ...prev,
      clientes: prev.clientes.map(c => (c.id === id ? { ...c, ...partial } : c)),
    }))
  }, [])

  const deleteCliente = useCallback((id: string) => {
    setData(prev => ({ ...prev, clientes: prev.clientes.filter(c => c.id !== id) }))
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

  const addRuta = useCallback((ruta: Ruta) => {
    setData(prev => ({ ...prev, rutas: [ruta, ...prev.rutas] }))
  }, [])

  const updateRuta = useCallback((id: string, partial: Partial<Ruta>) => {
    setData(prev => ({
      ...prev,
      rutas: prev.rutas.map(r => (r.id === id ? { ...r, ...partial } : r)),
    }))
  }, [])

  const deleteRuta = useCallback((id: string) => {
    setData(prev => ({ ...prev, rutas: prev.rutas.filter(r => r.id !== id) }))
  }, [])

  const addTarifa = useCallback((tarifa: Tarifa) => {
    setData(prev => ({ ...prev, tarifas: [tarifa, ...prev.tarifas] }))
  }, [])

  const updateTarifa = useCallback((id: string, partial: Partial<Tarifa>) => {
    setData(prev => ({
      ...prev,
      tarifas: prev.tarifas.map(t => (t.id === id ? { ...t, ...partial } : t)),
    }))
  }, [])

  const deleteTarifa = useCallback((id: string) => {
    setData(prev => ({ ...prev, tarifas: prev.tarifas.filter(t => t.id !== id) }))
  }, [])

  const addContador = useCallback((contador: Contador) => {
    setData(prev => ({ ...prev, contadores: [contador, ...prev.contadores] }))
  }, [])

  const updateContador = useCallback((id: string, partial: Partial<Contador>) => {
    setData(prev => ({
      ...prev,
      contadores: prev.contadores.map(c => (c.id === id ? { ...c, ...partial } : c)),
    }))
  }, [])

  const deleteContador = useCallback((id: string) => {
    setData(prev => ({ ...prev, contadores: prev.contadores.filter(c => c.id !== id) }))
  }, [])

  const addUnidad = useCallback((unidad: Unidad) => {
    setData(prev => ({ ...prev, unidades: [...prev.unidades, unidad].sort((a, b) => a.nombre.localeCompare(b.nombre)) }))
  }, [])

  const updateUnidad = useCallback((id: string, partial: Partial<Unidad>) => {
    setData(prev => ({
      ...prev,
      unidades: prev.unidades.map(u => (u.id === id ? { ...u, ...partial } : u)),
    }))
  }, [])

  const deleteUnidad = useCallback((id: string) => {
    setData(prev => ({ ...prev, unidades: prev.unidades.filter(u => u.id !== id) }))
  }, [])

  return {
    ...data,
    cargarDatos,
    addCliente,
    updateCliente,
    deleteCliente,
    addRegistro,
    updateRegistroEstado,
    setFuentesAgua,
    setRegistrosCalidad,
    recargarFuentesAgua,
    recargarRegistrosCalidad,
    addRuta,
    updateRuta,
    deleteRuta,
    addTarifa,
    updateTarifa,
    deleteTarifa,
    addContador,
    updateContador,
    deleteContador,
    addUnidad,
    updateUnidad,
    deleteUnidad,
  }
}

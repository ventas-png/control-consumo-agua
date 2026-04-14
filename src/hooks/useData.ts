import { useState, useCallback } from 'react'
import Swal from 'sweetalert2'
import type { Cliente, Registro, Empresa, FuenteAgua, RegistroCalidad, Ruta, Tarifa, Contador, Unidad, Proyecto, MaxUnidadesPorTipo, ProveedorEnergia, TarifaEnergia, FuenteEnergia, FacturaEnergia } from '../types'
import { supabase } from '../lib/supabase'

const CACHE_KEY = 'aquacontrol_data_v2'
const CACHE_MAX_AGE = 10 * 60 * 1000 // 10 minutes

// Strip PII fields from clientes before caching to localStorage
function sanitizeForCache(payload: AppData): AppData {
  return {
    ...payload,
    clientes: payload.clientes.map(c => ({
      ...c,
      email: undefined,
      telefono: undefined,
      whatsapp: undefined,
      telefono_alterno: undefined,
      cui_dui: undefined,
      numero_facturacion: undefined,
      direccion: undefined,
      fecha_nacimiento: undefined,
    })),
  }
}

function loadCache(): AppData | null {
  try {
    // Clean up old cache key
    localStorage.removeItem('aquacontrol_data_v1')
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { ts, payload }: { ts: number; payload: AppData } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_MAX_AGE) { localStorage.removeItem(CACHE_KEY); return null }
    return payload
  } catch { return null }
}

function saveCache(payload: AppData): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), payload: sanitizeForCache(payload) })) }
  catch { /* storage full — ignore */ }
}

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
  proyectos: Proyecto[]
  moneda: string
  maxUnidadesPorTipo: MaxUnidadesPorTipo | null
  proveedoresEnergia: ProveedorEnergia[]
  tarifasEnergia: TarifaEnergia[]
  fuentesEnergia: FuenteEnergia[]
  facturasEnergia: FacturaEnergia[]
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
  proyectos: [],
  moneda: 'Q',
  maxUnidadesPorTipo: null,
  proveedoresEnergia: [],
  tarifasEnergia: [],
  fuentesEnergia: [],
  facturasEnergia: [],
}

export function useData(companyId?: string) {
  const [data, setData] = useState<AppData>(() => loadCache() ?? INITIAL_DATA)

  const fetchAllData = async () => {
    // Defense-in-depth: add company_id filters where columns exist.
    // RLS is the primary enforcement, these are secondary safeguards.
    const tarifasQ = supabase.from('tarifas').select('*').order('created_at', { ascending: false })
    const contadoresQ = supabase.from('contadores').select('*').order('created_at', { ascending: false })
    const unidadesQ = supabase.from('unidades').select('*').order('nombre', { ascending: true })
    const fuentesQ = supabase.from('fuentes_agua').select('*').order('created_at', { ascending: false })
    const rcalQ = supabase.from('registros_calidad').select('*, fuentes_agua(identificador, nombre, tipo_agua)').order('fecha', { ascending: false })
    const proveedoresEnergiaQ = supabase.from('proveedores_energia').select('*').order('created_at', { ascending: false })
    const tarifasEnergiaQ = supabase.from('tarifas_energia').select('*').order('created_at', { ascending: false })
    const fuentesEnergiaQ = supabase.from('fuentes_energia').select('*').order('created_at', { ascending: false })
    const facturasEnergiaQ = supabase.from('facturas_energia').select('*').order('periodo_fin', { ascending: false })

    if (companyId) {
      tarifasQ.eq('company_id', companyId)
      contadoresQ.eq('company_id', companyId)
      unidadesQ.eq('company_id', companyId)
      fuentesQ.eq('company_id', companyId)
      rcalQ.eq('company_id', companyId)
      proveedoresEnergiaQ.eq('company_id', companyId)
      tarifasEnergiaQ.eq('company_id', companyId)
      fuentesEnergiaQ.eq('company_id', companyId)
      facturasEnergiaQ.eq('company_id', companyId)
    }

    return Promise.allSettled([
      supabase.from('clientes').select('*'),          // filtered via RLS + company_clientes junction
      supabase.from('registros').select('*'),          // filtered via RLS + project assignments
      supabase.from('empresa').select('*').limit(1),
      fuentesQ,
      rcalQ,
      supabase.from('rutas').select('*').order('created_at', { ascending: false }),
      tarifasQ,
      contadoresQ,
      unidadesQ,
      supabase.from('projects').select('*').order('nombre', { ascending: true }),
      proveedoresEnergiaQ,
      tarifasEnergiaQ,
      fuentesEnergiaQ,
      facturasEnergiaQ,
    ])
  }

  const applyResults = (
    prev: AppData,
    [clRes, regRes, empRes, fuaRes, rcalRes, rutasRes, tarifasRes, contadoresRes, unidadesRes, proyectoRes, proveedoresEnergiaRes, tarifasEnergiaRes, fuentesEnergiaRes, facturasEnergiaRes]: Awaited<ReturnType<typeof fetchAllData>>
  ): AppData => {
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
    if (proyectoRes.status === 'fulfilled' && proyectoRes.value.data?.length) {
      next.proyectos = proyectoRes.value.data as Proyecto[]
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
    if (proveedoresEnergiaRes.status === 'fulfilled' && proveedoresEnergiaRes.value.data) {
      next.proveedoresEnergia = proveedoresEnergiaRes.value.data as ProveedorEnergia[]
    }
    if (tarifasEnergiaRes.status === 'fulfilled' && tarifasEnergiaRes.value.data) {
      next.tarifasEnergia = tarifasEnergiaRes.value.data as TarifaEnergia[]
    }
    if (fuentesEnergiaRes.status === 'fulfilled' && fuentesEnergiaRes.value.data) {
      next.fuentesEnergia = fuentesEnergiaRes.value.data as FuenteEnergia[]
    }
    if (facturasEnergiaRes.status === 'fulfilled' && facturasEnergiaRes.value.data) {
      next.facturasEnergia = facturasEnergiaRes.value.data as FacturaEnergia[]
    }
    return next
  }

  const hasErrors = (results: Awaited<ReturnType<typeof fetchAllData>>) => {
    const [clRes, regRes, , , , , , contadoresRes, unidadesRes] = results
    return (
      (clRes.status === 'fulfilled' && !!clRes.value.error) ||
      (regRes.status === 'fulfilled' && !!regRes.value.error) ||
      (contadoresRes.status === 'fulfilled' && !!contadoresRes.value.error) ||
      (unidadesRes.status === 'fulfilled' && !!unidadesRes.value.error)
    )
  }

  const cargarDatos = useCallback(async () => {
    // Auto-desactivar tarifas cuya fecha_revision ya pasó — fire-and-forget, no bloquea la carga
    void Promise.resolve(supabase.rpc('deactivate_expired_tarifas')).catch(() => { /* silencioso */ })

    // Use cached data as base so partial query failures keep cached values for failed tables
    const base = loadCache() ?? INITIAL_DATA

    let results = await fetchAllData()
    const freshData = applyResults(base, results)
    setData(freshData)

    if (!hasErrors(results)) {
      saveCache(freshData)
      return
    }

    // Retry 1: wait 1.5 s to handle cold-start timeouts on the DB connection pool
    await new Promise(resolve => setTimeout(resolve, 1500))
    results = await fetchAllData()
    const retryData = applyResults(base, results)
    setData(retryData)

    if (!hasErrors(results)) {
      saveCache(retryData)
      return
    }

    // Retry 2: wait an additional 3 s for slow Supabase cold starts
    await new Promise(resolve => setTimeout(resolve, 3000))
    results = await fetchAllData()
    const retryData2 = applyResults(base, results)
    setData(retryData2)

    if (!hasErrors(results)) {
      saveCache(retryData2)
    } else {
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

  // ─ Proveedores Energía ──────────────────────────────────────────
  const addProveedorEnergia = useCallback((proveedor: ProveedorEnergia) => {
    setData(prev => ({ ...prev, proveedoresEnergia: [proveedor, ...prev.proveedoresEnergia] }))
  }, [])

  const updateProveedorEnergia = useCallback((id: string, partial: Partial<ProveedorEnergia>) => {
    setData(prev => ({
      ...prev,
      proveedoresEnergia: prev.proveedoresEnergia.map(p => (p.id === id ? { ...p, ...partial } : p)),
    }))
  }, [])

  const deleteProveedorEnergia = useCallback((id: string) => {
    setData(prev => ({ ...prev, proveedoresEnergia: prev.proveedoresEnergia.filter(p => p.id !== id) }))
  }, [])

  // ─ Tarifas Energía ──────────────────────────────────────────────
  const addTarifaEnergia = useCallback((tarifa: TarifaEnergia) => {
    setData(prev => ({ ...prev, tarifasEnergia: [tarifa, ...prev.tarifasEnergia] }))
  }, [])

  const updateTarifaEnergia = useCallback((id: string, partial: Partial<TarifaEnergia>) => {
    setData(prev => ({
      ...prev,
      tarifasEnergia: prev.tarifasEnergia.map(t => (t.id === id ? { ...t, ...partial } : t)),
    }))
  }, [])

  const deleteTarifaEnergia = useCallback((id: string) => {
    setData(prev => ({ ...prev, tarifasEnergia: prev.tarifasEnergia.filter(t => t.id !== id) }))
  }, [])

  // ─ Fuentes Energía ──────────────────────────────────────────────
  const addFuenteEnergia = useCallback((fuente: FuenteEnergia) => {
    setData(prev => ({ ...prev, fuentesEnergia: [fuente, ...prev.fuentesEnergia] }))
  }, [])

  const updateFuenteEnergia = useCallback((id: string, partial: Partial<FuenteEnergia>) => {
    setData(prev => ({
      ...prev,
      fuentesEnergia: prev.fuentesEnergia.map(f => (f.id === id ? { ...f, ...partial } : f)),
    }))
  }, [])

  const deleteFuenteEnergia = useCallback((id: string) => {
    setData(prev => ({ ...prev, fuentesEnergia: prev.fuentesEnergia.filter(f => f.id !== id) }))
  }, [])

  // ─ Facturas Energía ────────────────────────────────────────────
  const addFacturaEnergia = useCallback((factura: FacturaEnergia) => {
    setData(prev => ({ ...prev, facturasEnergia: [factura, ...prev.facturasEnergia] }))
  }, [])

  const updateFacturaEnergia = useCallback((id: string, partial: Partial<FacturaEnergia>) => {
    setData(prev => ({
      ...prev,
      facturasEnergia: prev.facturasEnergia.map(f => (f.id === id ? { ...f, ...partial } : f)),
    }))
  }, [])

  const deleteFacturaEnergia = useCallback((id: string) => {
    setData(prev => ({ ...prev, facturasEnergia: prev.facturasEnergia.filter(f => f.id !== id) }))
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
    addProveedorEnergia,
    updateProveedorEnergia,
    deleteProveedorEnergia,
    addTarifaEnergia,
    updateTarifaEnergia,
    deleteTarifaEnergia,
    addFuenteEnergia,
    updateFuenteEnergia,
    deleteFuenteEnergia,
    addFacturaEnergia,
    updateFacturaEnergia,
    deleteFacturaEnergia,
  }
}

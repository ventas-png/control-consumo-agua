import { useState, useCallback, useRef } from 'react'
import { notify } from '../components/shared/Dialog'
import type { Cliente, Registro, Empresa, FuenteAgua, RegistroCalidad, Unidad, Proyecto, MaxUnidadesPorTipo, ProveedorEnergia, TarifaEnergia, FuenteEnergia, FacturaEnergia } from '../types'
import { supabase } from '../lib/supabase'
import { SYSTEM_ROLE_IDS } from '../lib/systemRoleIds'

async function ensureSupabaseSession(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) return true
  // Try refreshing — handles expired JWT with valid refresh_token
  const { data: { session: refreshed } } = await supabase.auth.refreshSession()
  return !!refreshed
}

// Cache key prefix — per-user keys avoid cross-user leakage on shared devices
// (e.g. employee A logs out, employee B logs in: each user has their own
// cache, no flash of A's data while B's fetch is in flight).
const CACHE_KEY_PREFIX = 'aquacontrol_data_v3_'
// 24 h — under the SWR pattern we ALWAYS refetch in cargarDatos(), the cache
// only powers first-paint while the network request is in flight. Extended
// from 10 min (sessionStorage) so a user returning the next day still gets an
// instant render instead of an empty skeleton while fetch is pending.
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000

// Strip PII fields from clientes before persisting. localStorage is plain-text
// and accessible to any script on the origin — never persist emails, phones,
// addresses, DPI numbers, etc. Sensitive fields are re-hydrated when the
// fresh fetch completes.
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

function cacheKey(userId?: string): string | null {
  if (!userId) return null
  return `${CACHE_KEY_PREFIX}${userId}`
}

function loadCache(userId?: string): AppData | null {
  const key = cacheKey(userId)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { ts, payload }: { ts: number; payload: AppData } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_MAX_AGE) { localStorage.removeItem(key); return null }
    return payload
  } catch { return null }
}

function saveCache(userId: string | undefined, payload: AppData): void {
  const key = cacheKey(userId)
  if (!key) return
  const serialized = JSON.stringify({ ts: Date.now(), payload: sanitizeForCache(payload) })
  try {
    localStorage.setItem(key, serialized)
  } catch (err) {
    // QuotaExceededError — drop OTHER users' caches and retry. localStorage
    // is ~5 MB per origin; a single user's payload should fit, but stale
    // entries from prior sessions on shared devices can fill it up.
    const isQuotaError = err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.code === 22 || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    if (!isQuotaError) return
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith(CACHE_KEY_PREFIX) && k !== key) localStorage.removeItem(k)
      })
      localStorage.setItem(key, serialized)
    } catch { /* still full — give up silently */ }
  }
}

interface AppData {
  clientes: Cliente[]
  registros: Registro[]
  empresa: Empresa
  fuentesAgua: FuenteAgua[]
  registrosCalidad: RegistroCalidad[]
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
  unidades: [],
  proyectos: [],
  moneda: 'Q',
  maxUnidadesPorTipo: null,
  proveedoresEnergia: [],
  tarifasEnergia: [],
  fuentesEnergia: [],
  facturasEnergia: [],
}

const PROJECT_EXEMPT_ROLES = new Set(['super_admin', 'company_owner', 'admin'])

// Condominios system roles that restrict project visibility (everything except
// administrador_general). Derived from systemRoleIds to avoid UUID drift.
const RESTRICTED_COND_ROLE_IDS = new Set<string>(
  Object.entries(SYSTEM_ROLE_IDS.condominios)
    .filter(([k]) => k !== 'administrador_general')
    .map(([, v]) => v)
)

export function useData(companyId?: string, userId?: string, userRole?: string, assignedRoleIds?: string[]) {
  const [data, setData] = useState<AppData>(() => loadCache(userId) ?? INITIAL_DATA)
  const [isLoading, setIsLoading] = useState(false)

  // Refs so the stable cargarDatos closure always reads the latest values
  const userIdRef = useRef(userId)
  const userRoleRef = useRef(userRole)
  const assignedRoleIdsRef = useRef(assignedRoleIds)
  const companyIdRef = useRef(companyId)
  userIdRef.current = userId
  userRoleRef.current = userRole
  assignedRoleIdsRef.current = assignedRoleIds
  companyIdRef.current = companyId

  const fetchAllData = async () => {
    const cid = companyIdRef.current
    // Per-query timeout (15 s). A single slow query no longer kills the entire
    // batch — each query races independently. Faster queries return immediately
    // while slow ones eventually fail in isolation and we keep their cached
    // value (see applyResults' partial-update behavior). 15 s is enough for the
    // heaviest query (registros with limit 5000 ≈ 1 MB JSON) on a 200 kbps mobile
    // connection — under that, the company should be warned to use the lighter
    // dashboard which queries by date range.
    const PER_QUERY_TIMEOUT_MS = 15_000
    const signal = () => AbortSignal.timeout(PER_QUERY_TIMEOUT_MS)

    // Defense-in-depth: add company_id filters where columns exist.
    // RLS is the primary enforcement, these are secondary safeguards.
    // NOTE: Supabase query builder is immutable — .eq() returns a new builder,
    // so we must reassign (use let) to actually apply the filter.
    let unidadesQ = supabase.from('unidades').select('*').order('nombre', { ascending: true })
    let fuentesQ = supabase.from('fuentes_agua').select('*').order('created_at', { ascending: false })
    let rcalQ = supabase.from('registros_calidad').select('*, fuentes_agua(identificador, nombre, tipo_agua)').order('fecha', { ascending: false })
    let proveedoresEnergiaQ = supabase.from('proveedores_energia').select('*').order('created_at', { ascending: false })
    let tarifasEnergiaQ = supabase.from('tarifas_energia').select('*').order('created_at', { ascending: false })
    let fuentesEnergiaQ = supabase.from('fuentes_energia').select('*').order('created_at', { ascending: false })
    let facturasEnergiaQ = supabase.from('facturas_energia').select('*').order('periodo_fin', { ascending: false })
    // clientes has no company_id column — linked via company_clientes junction, filtered via RLS
    const clientesQ = supabase.from('clientes').select('*')
    // registros: RLS policy (registros_select) scopes company_owner to their company's
    // registros via projects + company_clientes. Limit to most-recent 5000 to avoid
    // PostgREST timeouts on companies with large history; dashboard filters by date
    // range so older readings are never needed for KPIs.
    //
    // IMPORTANT: never select `foto` here. It is base64 (up to 15 MB per row) and
    // TOAST-stored — including it inflates the payload to tens of MB and trips the
    // PostgREST statement_timeout on companies with photographed readings. The
    // dashboard/lecturas/historial/cobros views never read `foto`; only
    // CustomerPortal needs it and it fetches its own slice scoped by cliente_id.
    const REGISTROS_LIST_COLS = 'id,cliente_id,cliente_nombre,contador_id,project_id,fecha,lectura_anterior,lectura_actual,consumo,tarifa_aplicada,tarifa_exceso_aplicada,canon_aplicado,monto_calculado,tipo_cobro,estado,monto_pagado,fecha_pago,mes,fecha_lectura_anterior,dias_servicio,notas,gps,created_at'
    const registrosQ = supabase.from('registros').select(REGISTROS_LIST_COLS).order('fecha', { ascending: false }).limit(5000)

    if (cid) {
      unidadesQ        = unidadesQ.eq('company_id', cid)
      fuentesQ         = fuentesQ.eq('company_id', cid)
      rcalQ            = rcalQ.eq('company_id', cid)
      proveedoresEnergiaQ = proveedoresEnergiaQ.eq('company_id', cid)
      tarifasEnergiaQ  = tarifasEnergiaQ.eq('company_id', cid)
      fuentesEnergiaQ  = fuentesEnergiaQ.eq('company_id', cid)
      facturasEnergiaQ = facturasEnergiaQ.eq('company_id', cid)
    }

    return Promise.allSettled([
      clientesQ.abortSignal(signal()),
      registrosQ.abortSignal(signal()),
      supabase.from('empresa').select('*').limit(1).abortSignal(signal()),
      fuentesQ.abortSignal(signal()),
      rcalQ.abortSignal(signal()),
      unidadesQ.abortSignal(signal()),
      supabase.from('projects').select('*').order('nombre', { ascending: true }).abortSignal(signal()),
      proveedoresEnergiaQ.abortSignal(signal()),
      tarifasEnergiaQ.abortSignal(signal()),
      fuentesEnergiaQ.abortSignal(signal()),
      facturasEnergiaQ.abortSignal(signal()),
    ])
  }

  const applyResults = (
    prev: AppData,
    [clRes, regRes, empRes, fuaRes, rcalRes, unidadesRes, proyectoRes, proveedoresEnergiaRes, tarifasEnergiaRes, fuentesEnergiaRes, facturasEnergiaRes]: Awaited<ReturnType<typeof fetchAllData>>
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

  const filterDataByAssignment = async (appData: AppData): Promise<AppData> => {
    const uid = userIdRef.current
    const role = userRoleRef.current
    const roleIds = assignedRoleIdsRef.current ?? []
    const hasRestrictedCondRole = roleIds.some(rid => RESTRICTED_COND_ROLE_IDS.has(rid))
    if (!uid || !role || (PROJECT_EXEMPT_ROLES.has(role) && !hasRestrictedCondRole)) return appData
    const { data: assignments } = await supabase
      .from('user_project_assignments')
      .select('project_id')
      .eq('user_id', uid)
    // Fail closed: a null (error) or empty result restricts to no projects
    // rather than falling back to the full list. RLS on `projects` is the
    // authoritative guard; this keeps the client consistent with it.
    const allowed = new Set((assignments ?? []).map((a: { project_id: string }) => a.project_id))
    const filteredProyectos = appData.proyectos.filter(p => allowed.has(p.id))

    // Las rutas (agua) viven ahora en la capa de datos (TanStack Query); su
    // filtrado por acceso a proyecto se aplica en App con useRutasQuery.
    const proyectosChanged = filteredProyectos.length !== appData.proyectos.length
    if (!proyectosChanged) return appData

    const first = filteredProyectos[0]
    return {
      ...appData,
      proyectos: filteredProyectos,
      moneda: proyectosChanged ? (first?.moneda ?? appData.moneda) : appData.moneda,
      maxUnidadesPorTipo: proyectosChanged
        ? (first ? {
            apartamento:     first.max_unidades_apartamento ?? null,
            casa:            first.max_unidades_casa ?? null,
            bodega:          first.max_unidades_bodega ?? null,
            local_comercial: first.max_unidades_local_comercial ?? null,
            oficina:         first.max_unidades_oficina ?? null,
            parqueadero:     first.max_unidades_parqueadero ?? null,
            otro:            first.max_unidades_otro ?? null,
          } : appData.maxUnidadesPorTipo)
        : appData.maxUnidadesPorTipo,
    }
  }

  const getQueryErrors = (results: Awaited<ReturnType<typeof fetchAllData>>) => {
    const [clRes, regRes, , , , unidadesRes] = results
    const errs: string[] = []
    // Collect both fulfilled-with-error AND rejected (AbortError, network failure, etc.).
    // Previously only the fulfilled branch was checked, so per-query timeouts
    // (AbortSignal.timeout()) silently produced empty arrays in the UI — the
    // user saw 0 records and no error message, because the retry path was
    // also gated on this same `hasErrors` check.
    const errorFrom = (label: string, res: PromiseSettledResult<{ error: { message: string } | null } | unknown>): string | null => {
      if (res.status === 'rejected') {
        const reason = res.reason
        const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
        return `${label}: ${msg}`
      }
      const value = res.value as { error?: { message: string } | null } | null
      if (value && value.error) return `${label}: ${value.error.message}`
      return null
    }
    const checks: Array<[string, typeof clRes]> = [
      ['clientes', clRes],
      ['registros', regRes],
      ['unidades', unidadesRes],
    ]
    for (const [label, res] of checks) {
      const err = errorFrom(label, res)
      if (err) errs.push(err)
    }
    return errs
  }

  const hasErrors = (results: Awaited<ReturnType<typeof fetchAllData>>) =>
    getQueryErrors(results).length > 0

  const cargarDatos = useCallback(async () => {
    setIsLoading(true)
    try {
      // Ensure the Supabase JWT is valid before querying — handles expired tokens
      // that would cause RLS to silently return empty arrays
      const hasSession = await ensureSupabaseSession()
      if (!hasSession) {
        notify({ variant: 'warning', title: 'Sesión expirada', text: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.' })
        setIsLoading(false)
        return
      }

      // Auto-desactivación de tarifas vencidas se hace via pg_cron diario en BD
      // (migración 20260516000004). Antes se invocaba en cada login del cliente, lo
      // que generaba ruido en DevTools cuando el request se cancelaba.

      // Use cached data as base so partial query failures keep cached values for failed tables
      const base = loadCache(userIdRef.current) ?? INITIAL_DATA

      // First attempt. Each query inside fetchAllData() has its own 10 s
      // AbortSignal timeout, so individual slow queries fail in isolation
      // and don't block the rest of the batch.
      let results = await fetchAllData()
      const freshData = await filterDataByAssignment(applyResults(base, results))
      setData(freshData)
      // Hide skeleton as soon as the first fetch completes — data is visible even if
      // some secondary queries failed. Retries continue silently in the background.
      setIsLoading(false)

      if (!hasErrors(results)) {
        saveCache(userIdRef.current, freshData)
        return
      }

      console.error('[useData] Query errors on first fetch:', getQueryErrors(results))

      // If some core data DID load, stay silent on subsequent retries —
      // the app is usable and showing an "Offline" modal would be disruptive.
      const dataLoaded = freshData.proyectos.length > 0 || freshData.clientes.length > 0 || freshData.registros.length > 0

      // Single retry after a brief backoff (per-query timeouts make the
      // older double-retry redundant; what failed once will likely fail again
      // unless the DB connection pool was cold-starting).
      await new Promise(resolve => setTimeout(resolve, 2000))
      results = await fetchAllData()
      const retryData = await filterDataByAssignment(applyResults(freshData, results))
      setData(retryData)

      const finalErrors = getQueryErrors(results)
      if (!hasErrors(results)) {
        saveCache(userIdRef.current, retryData)
      } else {
        console.error('[useData] Persistent query errors after retry:', finalErrors)
        if (!dataLoaded && retryData.proyectos.length === 0 && retryData.clientes.length === 0) {
          // Only block the UI if we truly have no data at all
          notify({ variant: 'warning', title: 'Modo Offline', text: 'No se pudo conectar a la base de datos.' })
        }
        // If data loaded but some queries still error, stay silent — data is visible in the UI
      }
    } catch (err) {
      console.error('[useData] Unexpected error in cargarDatos:', err)
      notify({ variant: 'warning', title: 'Modo Offline', text: 'No se pudo conectar a la base de datos.' })
    } finally {
      setIsLoading(false)
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

  const deleteRegistro = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      registros: prev.registros.filter(r => r.id !== id),
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
    isLoading,
    cargarDatos,
    addCliente,
    updateCliente,
    deleteCliente,
    addRegistro,
    updateRegistroEstado,
    deleteRegistro,
    setFuentesAgua,
    setRegistrosCalidad,
    recargarFuentesAgua,
    recargarRegistrosCalidad,
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

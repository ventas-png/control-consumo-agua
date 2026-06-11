// Capa de datos del módulo agua a nivel app (P1 #4, extraída de App.tsx sin
// cambios de comportamiento).
//
// T7: las colecciones (proyectos, rutas, tarifas, contadores, unidades,
// fuentes, calidad, empresa, clientes, registros) viven en TanStack Query, ya
// no en useData. El filtrado por acceso a proyecto se aplica aquí sobre la
// lista cruda; los nombres de los callbacks optimistas (`addRuta`,
// `updateRuta`, …) se conservan para no tocar a los consumidores.
import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Cliente, Contador, Empresa, FuenteAgua, Registro, RegistroCalidad, Ruta, Tarifa, Unidad, UserSession } from '../types'
import {
  useProyectosQuery, useProyectoAssignmentsQuery, useRutasQuery, useTarifasQuery,
  useContadoresQuery, useUnidadesQuery, useFuentesAguaQuery, useRegistrosCalidadQuery,
  useEmpresaQuery, useClientesQuery, useRegistrosQuery,
} from '../domain/agua/queries'
import { aguaKeys } from '../domain/agua/keys'
import { filterRutasByProjectAccess } from '../lib/rutasAccess'
import { filterProyectosByAssignment, deriveProyectoConfig } from '../lib/proyectosAccess'

export type AguaData = ReturnType<typeof useAguaData>

export function useAguaData(currentUser: UserSession | null) {
  const dataQueryClient = useQueryClient()
  const dataCompanyId = currentUser?.company_id
  // T7 · agua:A4 — `proyectos` (última colección que vivía en useData) migran a la
  // capa de datos. La query devuelve la lista CRUDA que RLS acota por empresa; el
  // filtrado fino por asignación de proyecto (lo que hacía filterDataByAssignment)
  // y la derivación de moneda/maxUnidades se aplican aquí, igual que rutas usa
  // filterRutasByProjectAccess. Va ANTES del useMemo de rutas porque ese filtro usa
  // `proyectos` accesibles para construir su accessibleProjectIds.
  const { data: proyectosRaw = [], isLoading: dataLoading } = useProyectosQuery(dataCompanyId)
  const { data: projectAssignments } = useProyectoAssignmentsQuery(
    currentUser?.user_id, currentUser?.role, currentUser?.assigned_role_ids,
  )
  const { proyectos, moneda, maxUnidadesPorTipo } = useMemo(() => {
    const accesibles = filterProyectosByAssignment({
      proyectos: proyectosRaw,
      userId: currentUser?.user_id,
      role: currentUser?.role,
      assignedRoleIds: currentUser?.assigned_role_ids,
      assignments: projectAssignments,
    })
    return { proyectos: accesibles, ...deriveProyectoConfig(accesibles, proyectosRaw) }
  }, [proyectosRaw, projectAssignments, currentUser?.user_id, currentUser?.role, currentUser?.assigned_role_ids])
  // Refresco manual (reemplaza el `cargarDatos` de useData): invalida todo el
  // dominio agua para que registros/proyectos/etc. se vuelvan a traer. Lo usa
  // AdminClientDashboard tras agregar una lectura (onDataRefresh).
  const refrescarDatos = useCallback(
    () => dataQueryClient.invalidateQueries({ queryKey: aguaKeys.all }),
    [dataQueryClient],
  )
  // T7: `contadores` migran a la capa de datos (scope company). Va ANTES del
  // useMemo de rutas porque ese filtro usa `contadores` como entrada.
  const { data: contadores = [] } = useContadoresQuery(dataCompanyId)
  const addContador = useCallback((contador: Contador) => {
    dataQueryClient.setQueryData<Contador[]>(aguaKeys.contadores(dataCompanyId), (old = []) => [contador, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateContador = useCallback((id: string, partial: Partial<Contador>) => {
    dataQueryClient.setQueryData<Contador[]>(aguaKeys.contadores(dataCompanyId), (old = []) => old.map(c => (c.id === id ? { ...c, ...partial } : c)))
  }, [dataQueryClient, dataCompanyId])
  const deleteContador = useCallback((id: string) => {
    dataQueryClient.setQueryData<Contador[]>(aguaKeys.contadores(dataCompanyId), (old = []) => old.filter(c => c.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `unidades` migran a la capa de datos (scope company, orden por nombre).
  // También va ANTES del useMemo de rutas (es entrada del filtro). addUnidad
  // reordena por nombre al insertar, igual que el setData del antiguo useData.
  const { data: unidades = [] } = useUnidadesQuery(dataCompanyId)
  const addUnidad = useCallback((unidad: Unidad) => {
    dataQueryClient.setQueryData<Unidad[]>(aguaKeys.unidades(dataCompanyId), (old = []) => [...old, unidad].sort((a, b) => a.nombre.localeCompare(b.nombre)))
  }, [dataQueryClient, dataCompanyId])
  const updateUnidad = useCallback((id: string, partial: Partial<Unidad>) => {
    dataQueryClient.setQueryData<Unidad[]>(aguaKeys.unidades(dataCompanyId), (old = []) => old.map(u => (u.id === id ? { ...u, ...partial } : u)))
  }, [dataQueryClient, dataCompanyId])
  const deleteUnidad = useCallback((id: string) => {
    dataQueryClient.setQueryData<Unidad[]>(aguaKeys.unidades(dataCompanyId), (old = []) => old.filter(u => u.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `registros` (core de datos) migran a la capa de datos. Va ANTES del useMemo
  // de rutas (es entrada del filtro). addRegistro APENDE; updateRegistroEstado solo
  // toca `estado`; deleteRegistro filtra. Optimista vía setQueryData.
  const { data: registros = [] } = useRegistrosQuery(dataCompanyId)
  const addRegistro = useCallback((registro: Registro) => {
    dataQueryClient.setQueryData<Registro[]>(aguaKeys.registros(dataCompanyId), (old = []) => [...old, registro])
  }, [dataQueryClient, dataCompanyId])
  const updateRegistroEstado = useCallback((id: string, estado: Registro['estado']) => {
    dataQueryClient.setQueryData<Registro[]>(aguaKeys.registros(dataCompanyId), (old = []) => old.map(r => (r.id === id ? { ...r, estado } : r)))
  }, [dataQueryClient, dataCompanyId])
  const deleteRegistro = useCallback((id: string) => {
    dataQueryClient.setQueryData<Registro[]>(aguaKeys.registros(dataCompanyId), (old = []) => old.filter(r => r.id !== id))
  }, [dataQueryClient, dataCompanyId])
  const { data: rutasRaw = [] } = useRutasQuery(dataCompanyId)
  const rutas = useMemo(
    () => filterRutasByProjectAccess({
      rutas: rutasRaw,
      contadores,
      unidades,
      registros,
      accessibleProjectIds: new Set(proyectos.map(p => p.id)),
      userId: currentUser?.user_id ?? '',
    }),
    [rutasRaw, contadores, unidades, registros, proyectos, currentUser?.user_id],
  )
  // Mutaciones optimistas sobre el caché de rutas (espejan addRuta/updateRuta/
  // deleteRuta del antiguo useData). RutasSection sigue haciendo el INSERT/
  // UPDATE/DELETE en Supabase y luego llama a estos callbacks.
  const addRuta = useCallback((ruta: Ruta) => {
    dataQueryClient.setQueryData<Ruta[]>(aguaKeys.rutas(dataCompanyId), (old = []) => [ruta, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateRuta = useCallback((id: string, partial: Partial<Ruta>) => {
    dataQueryClient.setQueryData<Ruta[]>(aguaKeys.rutas(dataCompanyId), (old = []) => old.map(r => (r.id === id ? { ...r, ...partial } : r)))
  }, [dataQueryClient, dataCompanyId])
  const deleteRuta = useCallback((id: string) => {
    dataQueryClient.setQueryData<Ruta[]>(aguaKeys.rutas(dataCompanyId), (old = []) => old.filter(r => r.id !== id))
  }, [dataQueryClient, dataCompanyId])

  // T7: `tarifas` también migran a la capa de datos (scope company, sin filtro
  // por proyecto). Se conservan los nombres para no tocar TarifasSection ni el
  // resto de consumidores.
  const { data: tarifas = [] } = useTarifasQuery(dataCompanyId)
  const addTarifa = useCallback((tarifa: Tarifa) => {
    dataQueryClient.setQueryData<Tarifa[]>(aguaKeys.tarifas(dataCompanyId), (old = []) => [tarifa, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateTarifa = useCallback((id: string, partial: Partial<Tarifa>) => {
    dataQueryClient.setQueryData<Tarifa[]>(aguaKeys.tarifas(dataCompanyId), (old = []) => old.map(t => (t.id === id ? { ...t, ...partial } : t)))
  }, [dataQueryClient, dataCompanyId])
  const deleteTarifa = useCallback((id: string) => {
    dataQueryClient.setQueryData<Tarifa[]>(aguaKeys.tarifas(dataCompanyId), (old = []) => old.filter(t => t.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // serv:S3/S4/S5 — Energía migrada a domain/energia: ServiciosEnergiaSection
  // se auto-gestiona via queries/mutations; App.tsx ya no maneja su estado.
  // T7: `fuentesAgua` migran a la capa de datos. setFuentesAgua reemplaza la lista
  // en caché (lo usa CalidadSection vía onFuentesUpdated). recargarFuentesAgua del
  // useData previo no se usaba en App, así que se elimina.
  const { data: fuentesAgua = [] } = useFuentesAguaQuery(dataCompanyId)
  const setFuentesAgua = useCallback((fuentes: FuenteAgua[]) => {
    dataQueryClient.setQueryData<FuenteAgua[]>(aguaKeys.fuentesAgua(dataCompanyId), fuentes)
  }, [dataQueryClient, dataCompanyId])
  // T7: `registrosCalidad` migran a la capa de datos. setRegistrosCalidad reemplaza
  // la lista en caché (lo usa CalidadSection vía onRegistrosCalidadUpdated).
  const { data: registrosCalidad = [] } = useRegistrosCalidadQuery(dataCompanyId)
  const setRegistrosCalidad = useCallback((registros: RegistroCalidad[]) => {
    dataQueryClient.setQueryData<RegistroCalidad[]>(aguaKeys.registrosCalidad(dataCompanyId), registros)
  }, [dataQueryClient, dataCompanyId])
  // T7: `empresa` (objeto único del tenant) migra a la capa de datos. Read-only en
  // App (useData no exponía setter); default {} igual que el INITIAL_DATA previo.
  const { data: empresa = {} as Empresa } = useEmpresaQuery(dataCompanyId)
  // T7: `clientes` migran a la capa de datos (RLS por junction company_clientes;
  // su PII ya NO se persiste en localStorage). addCliente APENDE (no prepend) para
  // conservar el orden original de useData.
  const { data: clientes = [] } = useClientesQuery(dataCompanyId)
  const addCliente = useCallback((cliente: Cliente) => {
    dataQueryClient.setQueryData<Cliente[]>(aguaKeys.clientes(dataCompanyId), (old = []) => [...old, cliente])
  }, [dataQueryClient, dataCompanyId])
  const updateCliente = useCallback((id: string, partial: Partial<Cliente>) => {
    dataQueryClient.setQueryData<Cliente[]>(aguaKeys.clientes(dataCompanyId), (old = []) => old.map(c => (c.id === id ? { ...c, ...partial } : c)))
  }, [dataQueryClient, dataCompanyId])
  const deleteCliente = useCallback((id: string) => {
    dataQueryClient.setQueryData<Cliente[]>(aguaKeys.clientes(dataCompanyId), (old = []) => old.filter(c => c.id !== id))
  }, [dataQueryClient, dataCompanyId])

  return {
    dataLoading, refrescarDatos,
    proyectos, moneda, maxUnidadesPorTipo,
    contadores, addContador, updateContador, deleteContador,
    unidades, addUnidad, updateUnidad, deleteUnidad,
    registros, addRegistro, updateRegistroEstado, deleteRegistro,
    rutas, addRuta, updateRuta, deleteRuta,
    tarifas, addTarifa, updateTarifa, deleteTarifa,
    fuentesAgua, setFuentesAgua,
    registrosCalidad, setRegistrosCalidad,
    empresa,
    clientes, addCliente, updateCliente, deleteCliente,
  }
}

// Cobros pluggable (payfac) — Hooks de ESCRITURA del flujo "elige tu payfac y
// solo conecta". Espeja src/domain/fiscal/mutations.ts (parte "selecciona y conecta").
//
// Tres mutaciones:
//   1. useGuardarConfigPagoMutation — escribe la columna NO secreta proveedor_pago
//      DIRECTO en companies (empresa) o projects (locación) vía RLS admin/owner.
//   2. useGuardarCredencialesPayfacMutation — invoca el edge payfac-save-credentials
//      (la bóveda es deny-all; el cliente NO escribe el secreto).
//   3. useProbarConexionPayfacMutation — invoca el edge payfac-test-connection.
//
// Las CREDENCIALES jamás se escriben/leen directo desde el cliente (solo vía edge).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { payfacKeys } from './keys'

/** Ámbito de la config de pago: la empresa (companies) o una locación (projects). */
export type AmbitoPago = { tipo: 'empresa' } | { tipo: 'locacion'; projectId: string }

/** '' → null (un override vacío = "hereda"); deja undefined intacto. */
function limpiar(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Construye el patch de columnas para companies/projects desde el proveedor
 * elegido. PURO/testeable. A nivel EMPRESA proveedor_pago es NOT NULL (no se
 * limpia a null: se cae a 'sandbox'); a nivel LOCACIÓN null = "hereda".
 */
export function buildConfigPagoPatch(
  ambito: AmbitoPago,
  proveedorPago: string | null | undefined,
): Record<string, unknown> {
  const v = limpiar(proveedorPago)
  if (v === undefined) return {}
  // Empresa: la columna es NOT NULL → un vacío cae a 'sandbox' (default seguro).
  if (ambito.tipo === 'empresa') {
    return { proveedor_pago: v ?? 'sandbox' }
  }
  // Locación: null = hereda de la empresa.
  return { proveedor_pago: v }
}

/**
 * Guarda el payfac elegido en el nivel correspondiente (empresa→companies,
 * locación→projects) DIRECTO vía RLS (admin/owner). No toca credenciales. Tras
 * guardar invalida la config efectiva (de ese scope y la raíz, porque la empresa
 * afecta la herencia de todas las locaciones) y el estatus.
 */
export function useGuardarConfigPagoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { ambito: AmbitoPago; proveedorPago: string | null | undefined }) => {
      const patch = buildConfigPagoPatch(vars.ambito, vars.proveedorPago)
      if (Object.keys(patch).length === 0) return { ambito: vars.ambito }
      if (vars.ambito.tipo === 'empresa') {
        if (!companyId) throw new Error('Falta companyId para guardar la config de empresa.')
        await runQuery((signal) =>
          supabase.from('companies').update(patch).eq('id', companyId).abortSignal(signal),
        )
      } else {
        const projectId = vars.ambito.projectId
        await runQuery((signal) =>
          supabase.from('projects').update(patch).eq('id', projectId).abortSignal(signal),
        )
      }
      return { ambito: vars.ambito }
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: payfacKeys.all })
      void qc.invalidateQueries({
        queryKey: payfacKeys.configEfectiva(
          companyId,
          vars.ambito.tipo === 'locacion' ? vars.ambito.projectId : undefined,
        ),
      })
      if (companyId) void qc.invalidateQueries({ queryKey: payfacKeys.estatus(companyId) })
    },
  })
}

/** Respuesta del edge payfac-save-credentials (SOLO flags, jamás el secreto). */
export interface GuardarCredencialesPayfacResult {
  ok?: boolean
  company_id?: string
  project_id?: string | null
  proveedor?: string
  tiene_sandbox?: boolean
  tiene_prod?: boolean
  estado_conexion?: string
  error?: string
}

/** Credenciales de un ambiente (objeto opaco; el adapter las interpreta). */
export type CredencialesAmbienteInput = Record<string, unknown>

export interface GuardarCredencialesPayfacVars {
  companyId?: string
  /** Locación; null/omitido = nivel empresa. */
  projectId?: string | null
  /** Payfac al que pertenecen las credenciales (ej. 'qpaypro'). */
  proveedor?: string
  /** Credenciales por ambiente. Omitir un ambiente lo PRESERVA (merge en el edge). */
  credenciales: {
    sandbox?: CredencialesAmbienteInput | null
    prod?: CredencialesAmbienteInput | null
  }
}

/**
 * Guarda las credenciales del payfac vía el edge `payfac-save-credentials` (la
 * bóveda es deny-all: el cliente NUNCA escribe el secreto directo). Tras guardar
 * invalida el estatus (estado_conexion vuelve a 'desconocido'). La respuesta NO
 * contiene el secreto.
 */
export function useGuardarCredencialesPayfacMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: GuardarCredencialesPayfacVars): Promise<GuardarCredencialesPayfacResult> => {
      const { data, error } = await supabase.functions.invoke<GuardarCredencialesPayfacResult>(
        'payfac-save-credentials',
        {
          body: {
            ...(vars.companyId ? { company_id: vars.companyId } : {}),
            project_id: vars.projectId ?? null,
            ...(vars.proveedor ? { proveedor: vars.proveedor } : {}),
            credenciales: vars.credenciales,
          },
        },
      )
      if (error) throw new Error(error.message)
      if (data && data.ok === false) throw new Error(data.error ?? 'No se pudieron guardar las credenciales.')
      return data ?? {}
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: payfacKeys.all })
      if (companyId) void qc.invalidateQueries({ queryKey: payfacKeys.estatus(companyId) })
    },
  })
}

/** Respuesta del edge payfac-test-connection. */
export interface ProbarConexionPayfacResult {
  ok?: boolean
  mensaje?: string
  proveedor?: string | null
  moneda?: string | null
  ambiente?: string
  desde_locacion?: boolean
  estado_conexion?: string
  probado_en?: string | null
  advertencia?: string
  error?: string
}

export interface ProbarConexionPayfacVars {
  companyId?: string
  projectId?: string | null
  /** Ambiente a probar ('sandbox' | 'prod'). Default 'sandbox'. */
  ambiente?: string
}

/**
 * Prueba la conexión con el payfac vía el edge `payfac-test-connection`. El edge
 * persiste estado_conexion en la bóveda; tras la respuesta invalidamos el estatus
 * para refrescar el badge. NO lanza en un ping fallido (ok:false): la request es
 * válida; quien llama inspecciona `ok`/`mensaje`.
 */
export function useProbarConexionPayfacMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: ProbarConexionPayfacVars): Promise<ProbarConexionPayfacResult> => {
      const { data, error } = await supabase.functions.invoke<ProbarConexionPayfacResult>(
        'payfac-test-connection',
        {
          body: {
            ...(vars.companyId ? { company_id: vars.companyId } : {}),
            project_id: vars.projectId ?? null,
            ...(vars.ambiente ? { ambiente: vars.ambiente } : {}),
          },
        },
      )
      if (error) throw new Error(error.message)
      return data ?? {}
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: payfacKeys.all })
      if (companyId) void qc.invalidateQueries({ queryKey: payfacKeys.estatus(companyId) })
    },
  })
}

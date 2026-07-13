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
 * `monedaDefault` (ISO 4217) solo aplica a nivel empresa: companies.default_currency
 * — la BD la guarda en minúsculas; la locación no tiene moneda propia.
 * `ambientePago` ('sandbox' | 'prod') sigue la MISMA regla que el proveedor:
 * empresa NOT NULL (vacío cae a 'sandbox'), locación null = hereda.
 */
export function buildConfigPagoPatch(
  ambito: AmbitoPago,
  proveedorPago: string | null | undefined,
  monedaDefault?: string | null,
  ambientePago?: string | null,
): Record<string, unknown> {
  const v = limpiar(proveedorPago)
  const patch: Record<string, unknown> = {}
  if (v !== undefined) {
    // Empresa: la columna es NOT NULL → un vacío cae a 'sandbox' (default seguro).
    if (ambito.tipo === 'empresa') patch.proveedor_pago = v ?? 'sandbox'
    // Locación: null = hereda de la empresa.
    else patch.proveedor_pago = v
  }
  const moneda = limpiar(monedaDefault)
  if (ambito.tipo === 'empresa' && moneda != null) {
    patch.default_currency = moneda.toLowerCase()
  }
  const amb = limpiar(ambientePago)
  if (amb !== undefined) {
    if (ambito.tipo === 'empresa') patch.ambiente_pago = amb === 'prod' ? 'prod' : 'sandbox'
    // Locación: null = hereda; cualquier valor que no sea 'prod' explícito cae a sandbox.
    else patch.ambiente_pago = amb == null ? null : amb === 'prod' ? 'prod' : 'sandbox'
  }
  return patch
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
    mutationFn: async (vars: {
      ambito: AmbitoPago
      proveedorPago: string | null | undefined
      monedaDefault?: string | null
      ambientePago?: string | null
    }) => {
      const patch = buildConfigPagoPatch(vars.ambito, vars.proveedorPago, vars.monedaDefault, vars.ambientePago)
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

// ──────────────────────────────────────────────────────────────────────────
// Cobros MANUALES (pagos / convenios) — escrituras directas vía RLS.
//
// Distinto del flujo payfac de arriba (que pasa por edges): estas son las
// escrituras del cobro manual del back-office. El armado del payload y la lógica
// de negocio (saldos, transición de Factura) se quedan en la UI; aquí solo baja
// el acceso a datos. Contrato uniforme: `{ error: string | null }`.
// ──────────────────────────────────────────────────────────────────────────

/** Inserta un pago manual (payload ya armado por la UI). */
export async function createPago(payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('pagos').insert(payload)
  return { error: error?.message ?? null }
}

/** Marca un pago como verificado (sella verification_status/estado + verified_by/at). */
export async function verifyPago(pagoId: string, verifiedBy: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('pagos')
    .update({
      verification_status: 'verificado',
      estado: 'verificado',
      verified_by: verifiedBy,
      verified_at: new Date().toISOString(),
    })
    .eq('id', pagoId)
  return { error: error?.message ?? null }
}

/** Rechaza un pago con motivo (sella verification_status/estado + verified_by/at + notas). */
export async function rejectPago(
  pagoId: string,
  verifiedBy: string,
  notas: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('pagos')
    .update({
      verification_status: 'rechazado',
      estado: 'rechazado',
      verified_by: verifiedBy,
      verified_at: new Date().toISOString(),
      verification_notes: notas,
    })
    .eq('id', pagoId)
  return { error: error?.message ?? null }
}

/** Crea un convenio de pago (payload ya armado por la UI). */
export async function createConvenio(payload: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('convenios_pago').insert(payload)
  return { error: error?.message ?? null }
}

/** Cambia el estado de un convenio (activo/completado/incumplido/cancelado). */
export async function setConvenioEstado(id: string, estado: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('convenios_pago').update({ estado }).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Sube el comprobante de un pago al bucket privado `pagos-comprobantes` (el path
 * lo arma la UI; el display site firma vía useSignedUrl). Usado por el pago
 * manual del portal del cliente. Devuelve `{ error }`.
 */
export async function uploadComprobantePago(
  path: string,
  file: File | Blob,
  contentType?: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage
    .from('pagos-comprobantes')
    .upload(path, file, contentType ? { contentType } : undefined)
  return { error: error?.message ?? null }
}

// serv:S11 · Núcleo fiscal FEL/CFDI — Hooks de ESCRITURA (timbrado).
//
// Dispara el TIMBRADO de una Factura (registro) invocando el edge
// `timbrar-documento` (provider-agnostic; hoy contra el Sandbox, sin PAC real) e
// invalida las query keys de `documentos_fiscales` para que el badge/estatus de
// la UI de cobros se refresque.
//
// FUENTE DE VERDAD de la máquina de estados fiscal: `src/lib/businessFiscal.ts`
// (puro). Aquí solo CONSUMIMOS `puedeTimbrar`/`normalizarEstadoFiscal` para el
// gate defensivo antes de tocar la red — NO se duplica ni se reimplementa la
// lógica de transición. El edge vuelve a validar la transición del lado servidor
// (idempotencia: solo timbra documentos en `por_timbrar`); este gate es UX +
// defense-in-depth, no la autoridad.
//
// Separación de responsabilidades (igual que facturacion/mutations.ts):
//   - keys.ts / queries.ts → LECTURA (no se tocan aquí, solo se consumen).
//   - mutations.ts (este archivo) → ESCRITURA + invalidación.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { fiscalKeys } from './keys'
import {
  normalizarEstadoFiscal,
  puedeTransicionarFiscal,
} from '../../lib/businessFiscal'
import type {
  EstadoFiscal,
  RegimenFiscalConfig,
} from '../../types/fiscal'

// ════════════════════════════════════════════════════════════════════════════
// Helpers PUROS (testeables sin Supabase) — gating del botón "Timbrar".
// ════════════════════════════════════════════════════════════════════════════

/**
 * ¿Se puede disparar el timbrado para una Factura dado el estado del ÚLTIMO
 * documento fiscal asociado (o `null`/`undefined` si aún no existe ninguno)?
 *
 * El edge `timbrar-documento` CREA el documento en `por_timbrar` y lo timbra en
 * una sola llamada, así que el gate no es exactamente `puedeTimbrar(estado)` (que
 * exige `por_timbrar`): razona sobre el último documento del registro:
 *
 *   - sin documento (null) → timbrable (primer intento).
 *   - 'rechazado'          → timbrable (reintento: el edge crea uno nuevo).
 *   - 'por_timbrar'        → NO (ya hay uno encolado/en vuelo; evita duplicar).
 *   - 'timbrado'           → NO (ya certificado; no re-timbrar).
 *   - 'cancelado'          → NO (terminal).
 *
 * Determinista y sin I/O para poder testearlo en aislamiento.
 */
export function puedeDispararTimbrado(
  estadoUltimoDoc: string | null | undefined,
): boolean {
  if (estadoUltimoDoc == null) return true
  const estado = normalizarEstadoFiscal(estadoUltimoDoc)
  // 'rechazado' admite 'reintentar' en la máquina → es re-timbrable.
  return estado === 'rechazado' || puedeTransicionarFiscal(estado, 'reintentar').ok
}

/** Error lanzado ANTES de tocar la red cuando el documento no es timbrable. */
export class TimbradoNoPermitidoError extends Error {
  readonly estadoActual: EstadoFiscal | null
  constructor(estadoActual: EstadoFiscal | null, mensaje?: string) {
    super(
      mensaje ??
        `No se puede timbrar: el comprobante está en estado "${estadoActual ?? 'desconocido'}".`,
    )
    this.name = 'TimbradoNoPermitidoError'
    this.estadoActual = estadoActual
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Mutación · TIMBRAR un comprobante (invoca el edge `timbrar-documento`).
// ════════════════════════════════════════════════════════════════════════════

/** Respuesta normalizada del edge `timbrar-documento` (caso éxito o rechazo). */
export interface TimbrarDocumentoResult {
  ok?: boolean
  documento_id?: string
  estado?: EstadoFiscal
  uuid_fiscal?: string | null
  serie?: string | null
  numero?: string | null
  proveedor?: string | null
  error?: string
  detalles?: string[]
}

export interface TimbrarDocumentoVars {
  /** Factura (registros.id) a timbrar. */
  registroId: string
  /**
   * Estado del ÚLTIMO documento fiscal del registro, si ya existe alguno. Se usa
   * para el gate defensivo (evita re-timbrar / duplicar). `null`/omitido = no hay
   * documento todavía (primer intento, permitido).
   */
  estadoUltimoDoc?: string | null
  /** Tipo de comprobante (default 'factura'). Reservado para follow-up. */
  tipo?: string
}

/**
 * Dispara el timbrado de una Factura. Gate defensivo con la máquina de estados
 * ANTES de la red; luego `supabase.functions.invoke('timbrar-documento')`. Tras
 * la respuesta invalida las keys de `documentos_fiscales` (raíz del dominio +
 * scope company/registro) para refrescar el badge de estatus.
 *
 * `companyId` se usa solo para acotar la invalidación a las vistas del tenant.
 */
export function useTimbrarDocumentoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      registroId,
      estadoUltimoDoc,
      tipo,
    }: TimbrarDocumentoVars): Promise<TimbrarDocumentoResult> => {
      // Gate defensivo: la UI ya oculta el botón, pero revalidamos antes del
      // invoke. El edge vuelve a validar del lado servidor (autoridad real).
      if (!puedeDispararTimbrado(estadoUltimoDoc)) {
        throw new TimbradoNoPermitidoError(normalizarEstadoFiscal(estadoUltimoDoc))
      }

      const { data, error } = await supabase.functions.invoke<TimbrarDocumentoResult>(
        'timbrar-documento',
        { body: { registro_id: registroId, ...(tipo ? { tipo } : {}) } },
      )
      if (error) throw new Error(error.message)
      // El edge devuelve 4xx/5xx con { error, detalles } en el cuerpo para
      // rechazos de negocio (DTE inválido, rechazo del PAC). functions.invoke no
      // siempre los eleva a `error`, así que también miramos el cuerpo.
      if (data && data.ok === false) {
        const detalle = data.detalles?.length ? ` (${data.detalles.join('; ')})` : ''
        throw new Error((data.error ?? 'El comprobante fue rechazado.') + detalle)
      }
      return data ?? {}
    },
    onSuccess: (_data, vars) => {
      // Refresca toda la lectura fiscal del tenant + la del registro concreto.
      void qc.invalidateQueries({ queryKey: fiscalKeys.all })
      if (companyId) void qc.invalidateQueries({ queryKey: fiscalKeys.documentos(companyId) })
      void qc.invalidateQueries({
        queryKey: fiscalKeys.documentosPorRegistro(vars.registroId),
      })
    },
  })
}

// ════════════════════════════════════════════════════════════════════════════
// Query · Régimen fiscal del tenant (companies.regimen_fiscal).
// ════════════════════════════════════════════════════════════════════════════
//
// La UI (form de cliente) necesita saber el régimen del emisor para mostrar el
// campo correcto del receptor (NIT en GT vs RFC + Uso CFDI en MX) y elegir el
// validador. Es una LECTURA de `companies`, pero vive aquí (no en queries.ts) por
// ownership: queries.ts es de #387 y no se toca. Es de scope company y de un solo
// campo, así que el acoplamiento es mínimo.

/**
 * Régimen fiscal del tenant. `'ninguno'` (default de la migración) cuando el
 * tenant aún no emite comprobante fiscal — la UI usa eso para no exigir
 * NIT/RFC ni mostrar campos fiscales del receptor.
 */
export function useRegimenFiscalQuery(companyId?: string) {
  return useQuery({
    queryKey: [...fiscalKeys.all, 'regimen', companyId ?? null] as const,
    queryFn: async (): Promise<RegimenFiscalConfig> => {
      const rows = await runQuery<{ regimen_fiscal: string | null }[]>((signal) =>
        supabase
          .from('companies')
          .select('regimen_fiscal')
          .eq('id', companyId!)
          .limit(1)
          .abortSignal(signal),
      )
      const r = rows?.[0]?.regimen_fiscal
      return r === 'fel_gt' || r === 'cfdi_mx' ? r : 'ninguno'
    },
    enabled: !!companyId,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// serv:S11 — Habilitación "selecciona tu PAC y solo conecta" (UI parte 2).
// ════════════════════════════════════════════════════════════════════════════
//
// Tres mutaciones para el flujo selecciona → conecta → prueba:
//   1. useGuardarConfigFiscalLocacionMutation — escribe las columnas fiscales NO
//      secretas (régimen/NIT/RFC/nombre_fiscal/proveedor/establecimiento/…) DIRECTO
//      en companies (ámbito empresa) o projects (ámbito locación). RLS de admin/
//      owner lo permite (no es secreto). Invalida configEfectiva.
//   2. useGuardarCredencialesPacMutation — invoca el edge fiscal-save-credentials
//      (la bóveda es deny-all; el cliente NO escribe el secreto). Invalida
//      credenciales.
//   3. useProbarConexionPacMutation — invoca el edge fiscal-test-connection.
//      Invalida credenciales (el ping persiste estado_conexion).
//
// Las CREDENCIALES jamás se escriben/leen directo desde el cliente (solo vía edge);
// aquí solo se tocan COLUMNAS NO SENSIBLES de companies/projects.

/** Ámbito de la config fiscal: la empresa (companies) o una locación (projects). */
export type AmbitoFiscal =
  | { tipo: 'empresa' }
  | { tipo: 'locacion'; projectId: string }

/**
 * Datos NO secretos del emisor a persistir. Campos `undefined` se omiten del
 * patch (no se tocan); `null`/'' limpian la columna (= "hereda" en una locación).
 * Las columnas reales difieren por ámbito: establecimiento/serie_fiscal/
 * lugar_expedicion SOLO existen en projects (locación).
 */
export interface ConfigFiscalEmisorInput {
  regimenFiscal?: RegimenFiscalConfig | null
  nombreFiscal?: string | null
  nit?: string | null
  rfc?: string | null
  proveedorTimbrado?: string | null
  /** Solo locación (GT/FEL). */
  establecimiento?: string | null
  /** Solo locación (MX/CFDI). */
  lugarExpedicion?: string | null
  /** Solo locación (MX/CFDI). */
  serieFiscal?: string | null
}

/** '' → null (un override vacío = "hereda"); deja undefined intacto. */
function limpiar(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  const t = v.trim()
  return t === '' ? null : t
}

/** Añade `col` al patch solo si `valor` no es undefined (permite null = limpiar). */
function setSiPresente(
  patch: Record<string, unknown>,
  col: string,
  valor: string | null | undefined,
): void {
  if (valor !== undefined) patch[col] = valor
}

/**
 * Construye el patch de columnas (snake_case) para companies o projects desde el
 * input del emisor. PURO/testeable. A nivel EMPRESA solo van las columnas que
 * existen en companies (sin establecimiento/serie_fiscal/lugar_expedicion). En el
 * mapeo MX, lugar_expedicion de la locación vive en projects.lugar_expedicion.
 */
export function buildConfigFiscalPatch(
  ambito: AmbitoFiscal,
  input: ConfigFiscalEmisorInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  setSiPresente(patch, 'regimen_fiscal', limpiar(input.regimenFiscal as string | null | undefined))
  setSiPresente(patch, 'nombre_fiscal', limpiar(input.nombreFiscal))
  setSiPresente(patch, 'nit', limpiar(input.nit))
  setSiPresente(patch, 'rfc', limpiar(input.rfc))
  setSiPresente(patch, 'proveedor_timbrado', limpiar(input.proveedorTimbrado))
  if (ambito.tipo === 'locacion') {
    // Columnas que SOLO existen en projects (override por locación).
    setSiPresente(patch, 'establecimiento', limpiar(input.establecimiento))
    setSiPresente(patch, 'lugar_expedicion', limpiar(input.lugarExpedicion))
    setSiPresente(patch, 'serie_fiscal', limpiar(input.serieFiscal))
  }
  return patch
}

/**
 * Guarda los datos NO secretos del emisor en el nivel elegido (empresa→companies,
 * locación→projects) DIRECTO vía RLS (admin/owner). No toca credenciales. Tras
 * guardar invalida la config efectiva (de ese scope y la raíz, porque la empresa
 * afecta la herencia de todas las locaciones) y el estatus de credenciales (el
 * proveedor mostrado puede cambiar).
 */
export function useGuardarConfigFiscalLocacionMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      ambito: AmbitoFiscal
      input: ConfigFiscalEmisorInput
    }) => {
      const patch = buildConfigFiscalPatch(vars.ambito, vars.input)
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
      // La config de empresa afecta la herencia de TODAS las locaciones, así que
      // invalidamos la raíz del dominio además del scope concreto.
      void qc.invalidateQueries({ queryKey: fiscalKeys.all })
      void qc.invalidateQueries({
        queryKey: fiscalKeys.configEfectiva(
          companyId,
          vars.ambito.tipo === 'locacion' ? vars.ambito.projectId : undefined,
        ),
      })
      if (companyId) void qc.invalidateQueries({ queryKey: fiscalKeys.credenciales(companyId) })
    },
  })
}

/** Respuesta del edge fiscal-save-credentials (SOLO flags, jamás el secreto). */
export interface GuardarCredencialesResult {
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

export interface GuardarCredencialesVars {
  /** Tenant; opcional para admin/owner (el edge lo infiere del JWT). */
  companyId?: string
  /** Locación; null/omitido = nivel empresa. */
  projectId?: string | null
  /** PAC al que pertenecen las credenciales (ej. 'infile', 'facturama'). */
  proveedor?: string
  /** Credenciales por ambiente. Omitir un ambiente lo PRESERVA (merge en el edge). */
  credenciales: {
    sandbox?: CredencialesAmbienteInput | null
    prod?: CredencialesAmbienteInput | null
  }
}

/**
 * Guarda las credenciales del PAC vía el edge `fiscal-save-credentials` (la bóveda
 * es deny-all: el cliente NUNCA escribe el secreto directo). Tras guardar invalida
 * el estatus de credenciales (flags tiene_sandbox/tiene_prod + estado_conexion, que
 * vuelve a 'desconocido'). La respuesta NO contiene el secreto.
 */
export function useGuardarCredencialesPacMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: GuardarCredencialesVars): Promise<GuardarCredencialesResult> => {
      const { data, error } = await supabase.functions.invoke<GuardarCredencialesResult>(
        'fiscal-save-credentials',
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
      void qc.invalidateQueries({ queryKey: fiscalKeys.all })
      if (companyId) void qc.invalidateQueries({ queryKey: fiscalKeys.credenciales(companyId) })
    },
  })
}

/** Respuesta del edge fiscal-test-connection (ping vía Sandbox). */
export interface ProbarConexionResult {
  ok?: boolean
  mensaje?: string
  proveedor?: string | null
  regimen?: string | null
  ambiente?: string
  desde_locacion?: boolean
  estado_conexion?: string
  probado_en?: string | null
  advertencia?: string
  error?: string
}

export interface ProbarConexionVars {
  /** Tenant; opcional para admin/owner (el edge lo infiere del JWT). */
  companyId?: string
  /** Locación; null/omitido = nivel empresa. */
  projectId?: string | null
  /** Ambiente a reportar ('sandbox' | 'prod'). Default 'sandbox'. */
  ambiente?: string
}

/**
 * Prueba la conexión con el PAC vía el edge `fiscal-test-connection` (hoy pingea
 * el SandboxProvider; sin HTTP a PAC real). El edge persiste estado_conexion en la
 * bóveda; tras la respuesta invalidamos el estatus de credenciales para refrescar
 * el badge. NO lanza en un ping fallido (ok:false): la request es válida; quien
 * llama inspecciona `ok`/`mensaje`.
 */
export function useProbarConexionPacMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: ProbarConexionVars): Promise<ProbarConexionResult> => {
      const { data, error } = await supabase.functions.invoke<ProbarConexionResult>(
        'fiscal-test-connection',
        {
          body: {
            ...(vars.companyId ? { company_id: vars.companyId } : {}),
            project_id: vars.projectId ?? null,
            ...(vars.ambiente ? { ambiente: vars.ambiente } : {}),
          },
        },
      )
      // Errores de transporte/auth SÍ se elevan; un ping con ok:false NO (es un
      // resultado válido de la prueba, lo muestra el badge).
      if (error) throw new Error(error.message)
      return data ?? {}
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fiscalKeys.all })
      if (companyId) void qc.invalidateQueries({ queryKey: fiscalKeys.credenciales(companyId) })
    },
  })
}

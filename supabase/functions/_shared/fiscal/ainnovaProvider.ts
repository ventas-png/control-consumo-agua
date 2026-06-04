// serv:S11 — Adapter del PAC **Ainnova** (Certificador FEL de Guatemala, grupo
// Guatefacturas; autorizado por SAT GT bajo el Acuerdo de Directorio 13-2018).
//
// DECISIÓN DE PROVEEDOR (épica #305): el dueño factura con Ainnova, así que éste es
// el primer certificador REAL de FEL conectado a la arquitectura pluggable. El resto
// del sistema (timbrar-documento) sigue hablando SOLO con la interfaz FiscalProvider.
//
// QUÉ HACE HOY (todo lo verificable sin el manual de Ainnova):
//   1. Resuelve ambiente (sandbox/prod) → endpoint del web service de Guatefacturas.
//   2. Carga y VALIDA las credenciales del ambiente desde la bóveda
//      (fiscal_pac_secrets), inyectadas por el edge (service_role).
//   3. Mapea el DTE canónico → estructura DTE FEL (construirFelDte), lista para
//      serializar a XML SAT GT.
//
// QUÉ FALTA PARA TIMBRAR DE VERDAD (transporte, no verificable desde este entorno —
// el host dte.guatefacturas.com está fuera del allowlist de red y el contrato exacto
// requiere el manual de integración + credenciales sandbox de Ainnova):
//   a) Operación/envelope EXACTOS del web service (SOAP webservices63 vs REST/token).
//   b) MODELO DE FIRMA: ¿firma Ainnova el DTE por el emisor (SaaS), o hay que firmar
//      el XML con el certificado del emisor ANTES de enviarlo? Cambia el flujo y las
//      credenciales requeridas (en el 2º caso hay que guardar el certificado .pfx).
//   c) Whitelisting de dte.guatefacturas.com en la política de red del entorno.
//
// Mientras (a)/(b)/(c) no estén confirmados, el transporte FALLA SEGURO con un error
// claro y accionable (NUNCA finge un timbrado): así el comprobante queda 'rechazado'
// con un mensaje útil, en vez de aparentar valor fiscal que no tiene.

import type { FiscalProvider, FiscalProviderConfig, AmbientePac } from './provider.ts'
import type { DteCanonico, ResultadoTimbrado } from './types.ts'
import { construirFelDte, type FelDte } from './felGtDte.ts'

/** Identificador estable del proveedor (coincide con proveedor_timbrado='ainnova'). */
export const AINNOVA = 'ainnova'

/**
 * Endpoints del web service de certificación de Guatefacturas/Ainnova por ambiente.
 * El path de pruebas (`feltest`) es público; el de producción y la operación exacta
 * se confirman con el manual de Ainnova. Sobreescribibles por secret del edge
 * (AINNOVA_ENDPOINT_SANDBOX / AINNOVA_ENDPOINT_PROD) sin tocar código.
 */
export const AINNOVA_ENDPOINTS: Record<AmbientePac, string> = {
  sandbox: 'https://dte.guatefacturas.com/webservices63/feltest/',
  prod: 'https://dte.guatefacturas.com/webservices63/fel/',
}

/** Lee un secret del edge de forma segura (Deno puede no existir bajo vitest). */
function envOpcional(nombre: string): string | undefined {
  try {
    // @ts-ignore: Deno solo existe en el runtime edge.
    return typeof Deno !== 'undefined' ? Deno.env.get(nombre) ?? undefined : undefined
  } catch {
    return undefined
  }
}

/** Faltan/incompletas las credenciales del ambiente para Ainnova. */
export class AinnovaCredencialesError extends Error {
  constructor(ambiente: AmbientePac) {
    super(
      `Faltan credenciales de Ainnova para el ambiente "${ambiente}". ` +
        'Cárgalas en Empresa → Facturación → Credenciales del PAC (usuario y clave de Ainnova).',
    )
    this.name = 'AinnovaCredencialesError'
  }
}

/**
 * El contrato de integración de Ainnova aún no está confirmado en el código (ver
 * cabecera). Error tipado y accionable: el edge lo persiste como rechazo con mensaje.
 */
export class AinnovaContratoNoConfirmadoError extends Error {
  constructor(operacion: 'timbrar' | 'cancelar' | 'consultar') {
    super(
      `Ainnova: el transporte de "${operacion}" aún no está habilitado. ` +
        'Pendiente: (1) operación/envelope del web service de Guatefacturas, ' +
        '(2) modelo de firma (¿firma Ainnova o el emisor?), ' +
        '(3) habilitar dte.guatefacturas.com en la red del entorno. ' +
        'Aporta el manual de integración + credenciales sandbox de Ainnova para conectarlo.',
    )
    this.name = 'AinnovaContratoNoConfirmadoError'
  }
}

/** Credenciales de Ainnova interpretadas desde el jsonb opaco de la bóveda. */
interface AinnovaCreds {
  usuario: string
  clave: string
  /** Token/llave de usuario o "requestor" si el alta de Ainnova lo provee. */
  token?: string
  /** NIT del emisor con el que se autentica ante Ainnova (si difiere del DTE). */
  nit?: string
}

/** Extrae string de un jsonb opaco de forma tolerante (varias llaves equivalentes). */
function str(obj: Record<string, unknown>, ...llaves: string[]): string {
  for (const k of llaves) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return ''
}

export class AinnovaProvider implements FiscalProvider {
  readonly nombre = AINNOVA
  private readonly ambiente: AmbientePac
  private readonly endpoint: string
  private readonly credsAmbiente: Record<string, unknown> | null

  constructor(config: FiscalProviderConfig) {
    this.ambiente = config.ambiente === 'prod' ? 'prod' : 'sandbox'
    this.endpoint =
      envOpcional(this.ambiente === 'prod' ? 'AINNOVA_ENDPOINT_PROD' : 'AINNOVA_ENDPOINT_SANDBOX') ??
      AINNOVA_ENDPOINTS[this.ambiente]
    const porAmbiente = config.credenciales ?? null
    this.credsAmbiente = (porAmbiente?.[this.ambiente] as Record<string, unknown> | null) ?? null
  }

  /** Valida y normaliza las credenciales del ambiente activo (o lanza). */
  private requireCreds(): AinnovaCreds {
    const c = this.credsAmbiente
    if (!c || typeof c !== 'object') throw new AinnovaCredencialesError(this.ambiente)
    const usuario = str(c, 'usuario', 'user', 'apiKey', 'api_key')
    const clave = str(c, 'clave', 'password', 'pass', 'token', 'apiSecret', 'api_secret')
    if (usuario === '' || clave === '') throw new AinnovaCredencialesError(this.ambiente)
    return {
      usuario,
      clave,
      token: str(c, 'token', 'llave', 'requestor') || undefined,
      nit: str(c, 'nit', 'nitEmisor') || undefined,
    }
  }

  async timbrar(dte: DteCanonico): Promise<ResultadoTimbrado> {
    // 1) Credenciales del ambiente (lanza AinnovaCredencialesError si faltan).
    this.requireCreds()
    // 2) Mapeo canónico → DTE FEL (real y testeable; pre-XML/firma).
    const felDte: FelDte = construirFelDte(dte)
    // 3) Transporte: armar XML SAT GT, firmar y certificar contra `this.endpoint`.
    //    Bloqueado hasta confirmar el contrato/firma de Ainnova (ver cabecera).
    void felDte
    return await this.certificar()
  }

  async cancelar(_uuidFiscal: string, _motivo?: string): Promise<ResultadoTimbrado> {
    this.requireCreds()
    // Anulación FEL (GTAnulacionDocumento) contra el web service de Ainnova.
    return await this.noConfirmado('cancelar')
  }

  async consultarEstado(_uuidFiscal: string): Promise<ResultadoTimbrado> {
    this.requireCreds()
    // Consulta de estado del DTE en Ainnova/SAT (para reconciliar timbrados en limbo).
    return await this.noConfirmado('consultar')
  }

  // ── Transporte (pendiente de confirmar el contrato de Ainnova) ────────────────
  // deno-lint-ignore require-await
  private async certificar(): Promise<ResultadoTimbrado> {
    throw new AinnovaContratoNoConfirmadoError('timbrar')
  }

  // deno-lint-ignore require-await
  private async noConfirmado(
    op: 'cancelar' | 'consultar',
  ): Promise<ResultadoTimbrado> {
    throw new AinnovaContratoNoConfirmadoError(op)
  }
}

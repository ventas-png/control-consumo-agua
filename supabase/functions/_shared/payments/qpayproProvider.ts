// Cobros pluggable — QPayProProvider: adapter REAL del payfac QPayPro (Guatemala).
//
// QPayPro es una pasarela de pagos guatemalteca con API estilo Authorize.Net AIM
// (parámetros `x_`). Este adapter NO maneja datos de tarjeta: registra la
// transacción y obtiene la URL del CHECKOUT HOSPEDADO de QPayPro (la tarjeta se
// captura en la página de QPayPro), por lo que NUESTRO servidor queda FUERA del
// alcance PCI. El cliente se redirige a esa URL para completar el pago.
//
// Credenciales (de payfac_secrets.credenciales[ambiente], inyectadas por el edge):
//   { "x_login": "...", "x_api_key": "...", "x_private_key": "...", "x_api_secret": "..." }
//
// Endpoints (verificados en developers.qpaypro.com / búsqueda pública). Los hosts
// y el path se CENTRALIZAN aquí: algunas cuentas usan los hosts `api-*.qpaypro.com`
// (newer) en vez de `*payments.qpaypro.com` (classic). Al conectar credenciales
// reales y "probar conexión" en sandbox del comercio se confirma la variante; si
// difiere, se ajusta SOLO esta constante.
//
// Refs:
//   - https://developers.qpaypro.com/
//   - Sandbox payments: https://sandboxpayments.qpaypro.com  (classic)
//   - Prod payments:    https://payments.qpaypro.com         (classic)
//   - Sale: POST /checkout/register_transaction_store  (x_login, x_api_key,
//     x_amount, x_currency_code, x_type, x_method=CC, …)

import type { PaymentProvider, PaymentProviderConfig } from './provider.ts'
import type { CobroCanonico, ResultadoCobro } from './types.ts'

/** Hosts por ambiente (classic). Ver nota de cabecera si la cuenta usa api-*. */
const QPAYPRO_HOSTS: Record<'sandbox' | 'prod', string> = {
  sandbox: 'https://sandboxpayments.qpaypro.com',
  prod: 'https://payments.qpaypro.com',
}

/** Path del registro de transacción (devuelve el checkout hospedado). */
const QPAYPRO_SALE_PATH = '/checkout/register_transaction_store'

/** Tipo de transacción: venta inmediata (autorización + captura). */
const QPAYPRO_TX_TYPE = 'AUTH_CAPTURE'

/** Credenciales mínimas extraídas del jsonb opaco de la bóveda. */
interface QPayProCreds {
  xLogin: string
  xApiKey: string
  xPrivateKey?: string
  xApiSecret?: string
}

/** Lee una llave string del objeto de credenciales (tolerante a variantes). */
function leerCred(creds: Record<string, unknown>, ...llaves: string[]): string | undefined {
  for (const k of llaves) {
    const v = creds[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return undefined
}

/**
 * Extrae/valida las credenciales de QPayPro. Devuelve null si faltan las mínimas
 * (x_login + x_api_key/x_private_key), para que el caller responda un error
 * normalizado (no lanza).
 */
function extraerCreds(credenciales: Record<string, unknown> | null | undefined): QPayProCreds | null {
  const c = credenciales ?? {}
  const xLogin = leerCred(c, 'x_login', 'xLogin', 'login')
  const xApiKey = leerCred(c, 'x_api_key', 'xApiKey', 'api_key')
  const xPrivateKey = leerCred(c, 'x_private_key', 'xPrivateKey', 'private_key')
  const xApiSecret = leerCred(c, 'x_api_secret', 'xApiSecret', 'api_secret')
  if (!xLogin || !(xApiKey || xPrivateKey)) return null
  return { xLogin, xApiKey: xApiKey ?? xPrivateKey!, xPrivateKey, xApiSecret }
}

/** Parte un nombre completo en nombre/apellido para los campos del recibo. */
function partirNombre(nombre?: string | null): { first: string; last: string } {
  const limpio = (nombre ?? '').trim()
  if (!limpio) return { first: 'Cliente', last: '' }
  const partes = limpio.split(/\s+/)
  if (partes.length === 1) return { first: partes[0], last: '' }
  return { first: partes[0], last: partes.slice(1).join(' ') }
}

/** Busca recursivamente la primera URL http(s) en un objeto/respuesta del payfac. */
function buscarUrl(obj: unknown, profundidad = 0): string | null {
  if (profundidad > 4 || obj == null) return null
  if (typeof obj === 'string') {
    return /^https?:\/\//i.test(obj.trim()) ? obj.trim() : null
  }
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const u = buscarUrl(it, profundidad + 1)
      if (u) return u
    }
    return null
  }
  if (typeof obj === 'object') {
    // Prioriza llaves típicas de checkout/redirect.
    const rec = obj as Record<string, unknown>
    for (const k of ['url', 'checkout_url', 'redirect_url', 'payment_url', 'href']) {
      const v = rec[k]
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v
    }
    for (const v of Object.values(rec)) {
      const u = buscarUrl(v, profundidad + 1)
      if (u) return u
    }
  }
  return null
}

/** Lee un campo string de la respuesta probando varias llaves. */
function campo(obj: Record<string, unknown>, ...llaves: string[]): string | null {
  for (const k of llaves) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

export class QPayProProvider implements PaymentProvider {
  readonly nombre = 'qpaypro'
  private readonly ambiente: 'sandbox' | 'prod'
  private readonly credenciales: Record<string, unknown> | null

  constructor(config: PaymentProviderConfig) {
    this.ambiente = config.ambiente === 'prod' ? 'prod' : 'sandbox'
    this.credenciales = config.credenciales ?? null
  }

  private host(): string {
    return QPAYPRO_HOSTS[this.ambiente]
  }

  async crearCobro(cobro: CobroCanonico): Promise<ResultadoCobro> {
    const creds = extraerCreds(this.credenciales)
    if (!creds) {
      return {
        ok: false,
        estado: 'error',
        error:
          'Faltan credenciales de QPayPro para este ambiente (se requiere x_login y x_api_key/x_private_key). Conéctelas en la configuración de cobros.',
      }
    }

    const { first, last } = partirNombre(cobro.pagador?.nombre)
    const form = new URLSearchParams()
    form.set('x_login', creds.xLogin)
    form.set('x_api_key', creds.xApiKey)
    if (creds.xPrivateKey) form.set('x_private_key', creds.xPrivateKey)
    if (creds.xApiSecret) form.set('x_api_secret', creds.xApiSecret)
    form.set('x_type', QPAYPRO_TX_TYPE)
    form.set('x_method', 'CC')
    form.set('x_amount', cobro.monto.toFixed(2))
    form.set('x_currency_code', cobro.moneda.toUpperCase())
    if (cobro.referenciaInterna) form.set('x_invoice_num', cobro.referenciaInterna)
    form.set('x_description', cobro.descripcion)
    form.set('x_first_name', first)
    if (last) form.set('x_last_name', last)
    if (cobro.pagador?.email) form.set('x_email', cobro.pagador.email)
    if (cobro.pagador?.telefono) form.set('x_phone', cobro.pagador.telefono)
    // URLs de retorno del checkout hospedado (el cliente vuelve aquí tras pagar).
    if (cobro.urlRetorno) form.set('x_url_complete', cobro.urlRetorno)
    if (cobro.urlCancelacion) form.set('x_url_cancel', cobro.urlCancelacion)

    let resp: Response
    try {
      resp = await fetch(this.host() + QPAYPRO_SALE_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      })
    } catch (e) {
      // Fallo de red: NO lanzamos (el edge responde uniforme con ok:false).
      return {
        ok: false,
        estado: 'error',
        error: `No se pudo contactar a QPayPro: ${e instanceof Error ? e.message : 'error de red'}`,
      }
    }

    const texto = await resp.text()
    let data: unknown = null
    try {
      data = JSON.parse(texto)
    } catch {
      data = { raw: texto }
    }
    const obj = (data && typeof data === 'object' ? data : { raw: texto }) as Record<string, unknown>

    if (!resp.ok) {
      return {
        ok: false,
        estado: 'error',
        error:
          campo(obj, 'message', 'error', 'x_response_reason_text') ??
          `QPayPro respondió HTTP ${resp.status}.`,
        raw: obj,
      }
    }

    // Código de respuesta estilo Authorize.Net AIM: 1=aprobado, 2=declinado,
    // 3=error, 4=retenido. Algunos endpoints devuelven success/status en su lugar.
    const responseCode = campo(obj, 'x_response_code', 'response_code')
    const referencia = campo(obj, 'x_trans_id', 'transaction_id', 'id', 'idTransaction')
    const autorizacion = campo(obj, 'x_auth_code', 'auth_code', 'authorization')
    const motivo = campo(obj, 'x_response_reason_text', 'message', 'reason')
    const redirectUrl = buscarUrl(obj)

    // Si hay URL de checkout hospedado → el cliente debe completar el pago allí.
    if (redirectUrl) {
      return {
        ok: true,
        estado: 'requiere_accion',
        referencia,
        autorizacion,
        redirectUrl,
        raw: obj,
      }
    }

    if (responseCode === '1') {
      return { ok: true, estado: 'aprobado', referencia, autorizacion, raw: obj }
    }
    if (responseCode === '2' || responseCode === '4') {
      return {
        ok: true,
        estado: 'rechazado',
        referencia,
        error: motivo ?? 'QPayPro declinó la transacción.',
        raw: obj,
      }
    }
    // Sin URL de checkout ni código claro: lo tratamos como pendiente para que la
    // confirmación (consultarEstado) resuelva, salvo que haya un motivo de error.
    return {
      ok: responseCode == null ? true : false,
      estado: responseCode == null ? 'pendiente' : 'error',
      referencia,
      error: responseCode == null ? null : (motivo ?? `QPayPro respondió código ${responseCode}.`),
      raw: obj,
    }
  }

  async consultarEstado(referencia: string): Promise<ResultadoCobro> {
    const creds = extraerCreds(this.credenciales)
    // `ping:` → prueba de conexión SIN red: valida que haya credenciales mínimas.
    // (QPayPro/AIM no expone un endpoint de "health" público; un cobro de prueba
    // generaría ruido, así que el ping verifica configuración, no conectividad.)
    if (referencia.startsWith('ping:')) {
      if (!creds) {
        return {
          ok: false,
          estado: 'error',
          error: 'Faltan credenciales de QPayPro (x_login y x_api_key/x_private_key).',
        }
      }
      return {
        ok: true,
        estado: 'aprobado',
        raw: { proveedor: 'qpaypro', ambiente: this.ambiente, credenciales: 'presentes' },
      }
    }

    // Consulta real de estado: el endpoint exacto depende de la versión de la API
    // del comercio; se confirma al integrar el sandbox real. Hoy reportamos
    // 'pendiente' (no resuelto server-side) para no asumir un estado equivocado.
    if (!creds) {
      return { ok: false, estado: 'error', error: 'Faltan credenciales de QPayPro.' }
    }
    return {
      ok: true,
      estado: 'pendiente',
      referencia,
      raw: {
        proveedor: 'qpaypro',
        nota: 'Consulta de estado server-to-server pendiente de cablear contra el endpoint de QPayPro del comercio (follow-up). Confirmar por retorno/webhook del checkout.',
      },
    }
  }

  // deno-lint-ignore require-await
  async reembolsar(referencia: string, monto?: number, motivo?: string): Promise<ResultadoCobro> {
    // El reembolso vía API requiere el endpoint de CREDIT/void de QPayPro (no
    // verificado en este entorno). Se deja como follow-up explícito en vez de
    // simular un éxito que no ocurrió.
    return {
      ok: false,
      estado: 'error',
      referencia,
      error:
        'Reembolso automático de QPayPro aún no cableado (follow-up). Procese el reembolso desde el panel de QPayPro por ahora.',
      raw: { monto: monto ?? null, motivo: motivo ?? null },
    }
  }
}

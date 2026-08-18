// Helpers para paquetería de salida (retiro por tercero).
import { generarToken } from './tokens'

// Código de retiro de un solo uso, corto y legible. B5 (auditoría 2026-07-16,
// S3): CRIPTOGRÁFICO (antes Math.random — predecible) y con el alfabeto sin
// ambiguos de lib/tokens; 8 chars ≈ 40 bits. Usado cuando recepción registra
// una salida directamente; el camino del residente genera el código en el
// servidor (RPC paquete_autorizar_salida, también endurecido en B5).
export function generarCodigoRetiro(): string {
  return generarToken(8)
}

// Ruta de portería donde se entrega el paquete y clave del fragmento que
// transporta el código. El código va en el HASH y no en el query string a
// propósito: el fragmento no viaja al servidor ni al header Referer, así que el
// código de retiro no queda en logs de acceso ni se filtra a terceros.
export const RETIRO_PATH = '/condominios/paqueteria'
export const RETIRO_HASH_KEY = 'retiro'

// Acepta el fragmento del deep link (`#retiro=ABC23456`), una URL completa que
// lo contenga, o un query string. `[^&#\s]+` corta en el siguiente separador.
// Se deriva de RETIRO_HASH_KEY para que la clave no pueda quedar desincronizada
// entre lo que escribimos en el QR y lo que leemos al volver.
const RETIRO_PARAM_RE = new RegExp(`[#&?]${RETIRO_HASH_KEY}=([^&#\\s]+)`, 'i')

// Origen público de la app para el QR. En web usamos el origen real (dominio
// propio o preview de Vercel). En la app nativa `window.location.origin` es
// `https://localhost` / `capacitor://localhost` — un QR con ese origen no abre
// nada en el teléfono del guardia, así que caemos al dominio público. Se puede
// fijar con VITE_APP_URL (útil para despliegues con dominio propio).
const APP_URL_FALLBACK = 'https://administratodo.com'

// Un origen sirve para el QR solo si el teléfono del guardia puede resolverlo:
// http(s) y que no sea loopback. Descarta tanto el `https://localhost` del
// WebView nativo como un VITE_APP_URL apuntando al dev server.
function origenUtilParaQR(origen: string | undefined): string | null {
  const limpio = (origen ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(limpio)) return null
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/i.test(limpio)) return null
  return limpio
}

export function appOriginParaQR(): string {
  return origenUtilParaQR(import.meta.env.VITE_APP_URL as string | undefined)
    ?? (typeof window === 'undefined' ? null : origenUtilParaQR(window.location.origin))
    ?? APP_URL_FALLBACK
}

/**
 * Contenido del QR del código de retiro. Es una URL, NO texto plano.
 *
 * POR QUÉ (bug de portería): antes el QR llevaba `PAQUETE:<código>`. La cámara
 * nativa del teléfono solo ofrece una acción cuando reconoce el formato del
 * contenido (URL, wifi, vCard, tel…); ante un esquema desconocido responde "No
 * se encontraron datos utilizables" y el guardia se queda sin poder escanear.
 * Con una URL propia, la cámara la reconoce y abre portería con el código ya
 * cargado (ver PaqueteriaSalientesTab). El código sigue siendo el secreto: va
 * en el fragmento, que no sale del dispositivo hacia el servidor.
 *
 * El QR se renderiza LOCAL con <QRCodeSVG value={qrPayloadRetiro(c)}>
 * (qrcode.react, igual que Control de Accesos QR). El servicio externo
 * api.qrserver.com se eliminó en B5: la CSP lo bloqueaba (QR roto en prod) y
 * además filtraba el código de retiro a un tercero.
 */
export function qrPayloadRetiro(codigo: string): string {
  return `${appOriginParaQR()}${RETIRO_PATH}#${RETIRO_HASH_KEY}=${encodeURIComponent(codigo)}`
}

/** Código de retiro embebido en un hash/URL, o null si no lo lleva. */
export function codigoRetiroDesdeURL(hashOUrl: string | null | undefined): string | null {
  const m = RETIRO_PARAM_RE.exec(hashOUrl ?? '')
  if (!m) return null
  let valor: string
  try {
    valor = decodeURIComponent(m[1])
  } catch {
    valor = m[1] // % suelto en la cadena: nos quedamos con el crudo.
  }
  const codigo = valor.trim().toUpperCase()
  return codigo || null
}

/**
 * Normaliza lo que el guardia teclea o pega en el campo "Código de retiro".
 * Acepta el código a secas, la URL del QR nuevo y el payload `PAQUETE:<código>`
 * de los QR viejos (que alguien puede haber leído con un lector genérico).
 */
export function normalizarCodigoRetiro(entrada: string | null | undefined): string {
  const raw = (entrada ?? '').trim()
  if (!raw) return ''
  const deURL = codigoRetiroDesdeURL(raw)
  if (deURL) return deURL
  const legacy = /^PAQUETE:(.+)$/i.exec(raw)
  if (legacy) return legacy[1].trim().toUpperCase()
  return raw.toUpperCase()
}

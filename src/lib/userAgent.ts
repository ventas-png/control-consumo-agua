// plat:P9 — Parser PURO y ligero de user-agent para mostrar de forma legible el
// dispositivo de una sesión activa. No pretende ser exhaustivo (eso requeriría
// una librería pesada); cubre los navegadores/SO comunes y degrada con gracia a
// "desconocido". Pura → testeable sin DOM.

export interface DispositivoInfo {
  navegador: string
  sistema: string
  /** "Chrome · Windows" — listo para mostrar. */
  etiqueta: string
}

const DESCONOCIDO = 'Desconocido'

function detectarNavegador(ua: string): string {
  // El orden importa: Edge/Opera/Samsung incluyen "Chrome"; Chrome incluye "Safari".
  if (/\bEdg(?:e|A|iOS)?\//i.test(ua)) return 'Edge'
  if (/\bOPR\/|\bOpera\//i.test(ua)) return 'Opera'
  if (/\bSamsungBrowser\//i.test(ua)) return 'Samsung Internet'
  if (/\bFirefox\/|\bFxiOS\//i.test(ua)) return 'Firefox'
  if (/\bChrome\/|\bCriOS\//i.test(ua)) return 'Chrome'
  if (/\bSafari\//i.test(ua) && /\bVersion\//i.test(ua)) return 'Safari'
  return DESCONOCIDO
}

function detectarSistema(ua: string): string {
  if (/\bWindows NT\b/i.test(ua)) return 'Windows'
  if (/\biPhone\b|\biPad\b|\biPod\b/i.test(ua)) return 'iOS'
  if (/\bAndroid\b/i.test(ua)) return 'Android'
  if (/\bMac OS X\b|\bMacintosh\b/i.test(ua)) return 'macOS'
  if (/\bCrOS\b/i.test(ua)) return 'ChromeOS'
  if (/\bLinux\b|\bX11\b/i.test(ua)) return 'Linux'
  return DESCONOCIDO
}

/**
 * Describe un user-agent en términos legibles. Vacío/nulo → "Dispositivo
 * desconocido". Si solo se reconoce una parte, la otra cae a "Desconocido".
 */
export function describeUserAgent(ua: string | null | undefined): DispositivoInfo {
  const s = (ua ?? '').trim()
  if (s === '') {
    return { navegador: DESCONOCIDO, sistema: DESCONOCIDO, etiqueta: 'Dispositivo desconocido' }
  }
  const navegador = detectarNavegador(s)
  const sistema = detectarSistema(s)
  if (navegador === DESCONOCIDO && sistema === DESCONOCIDO) {
    return { navegador, sistema, etiqueta: 'Dispositivo desconocido' }
  }
  return { navegador, sistema, etiqueta: `${navegador} · ${sistema}` }
}

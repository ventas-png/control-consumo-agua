// Países para elegir la procedencia de una persona. Se guarda el código
// ISO 3166-1 alfa-2 ('GT', 'US'); el nombre lo pone el navegador en español.

/** Códigos ISO 3166-1 alfa-2 asignados oficialmente. */
const CODIGOS = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

export interface Pais {
  codigo: string
  nombre: string
  /** Nombre sin acentos ni mayúsculas, para buscar. */
  clave: string
}

/** Minúsculas, sin acentos ni signos: «Estados Unidos» → «estados unidos». */
export function normalizarPais(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const nombres = (() => {
  try { return new Intl.DisplayNames(['es'], { type: 'region' }) } catch { return null }
})()

/** Todos los países, por nombre en español. */
export const PAISES: readonly Pais[] = CODIGOS
  .map(codigo => {
    const nombre = nombres?.of(codigo) ?? codigo
    return { codigo, nombre, clave: normalizarPais(nombre) }
  })
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

const POR_CODIGO = new Map(PAISES.map(p => [p.codigo, p]))
const POR_CLAVE = new Map(PAISES.map(p => [p.clave, p]))
/** Formas habituales de escribir un país que no son su nombre oficial. */
const ALIAS: Record<string, string> = {
  usa: 'US', eeuu: 'US', 'ee uu': 'US', 'estados unidos de america': 'US', 'united states': 'US',
  uk: 'GB', 'gran bretana': 'GB', inglaterra: 'GB', 'united kingdom': 'GB',
  mexico: 'MX', brasil: 'BR', holanda: 'NL', 'republica dominicana': 'DO', 'corea del sur': 'KR', rusia: 'RU',
  chequia: 'CZ', 'republica checa': 'CZ', 'emiratos arabes': 'AE', 'el salvador': 'SV',
}

export const esCodigoPais = (v: unknown): v is string => typeof v === 'string' && POR_CODIGO.has(v)

/** Nombre en español del país; '' si no hay código, y el código tal cual si no se conoce. */
export function nombrePais(codigo: string | null | undefined): string {
  if (!codigo) return ''
  return POR_CODIGO.get(codigo)?.nombre ?? codigo
}

/** Bandera (emoji) del país; '' si el código no tiene la forma de uno. */
export function banderaPais(codigo: string | null | undefined): string {
  if (!codigo || !/^[A-Z]{2}$/.test(codigo)) return ''
  return String.fromCodePoint(...[...codigo].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** «🇬🇹 Guatemala»; '' sin país. */
export function etiquetaPais(codigo: string | null | undefined): string {
  return codigo ? `${banderaPais(codigo)} ${nombrePais(codigo)}`.trim() : ''
}

/** Código del país escrito como código («gt») o como nombre («Guatemala», «EEUU»); null si no se reconoce. */
export function codigoDePais(texto: string): string | null {
  const t = texto.trim()
  if (/^[a-zA-Z]{2}$/.test(t) && POR_CODIGO.has(t.toUpperCase())) return t.toUpperCase()
  const clave = normalizarPais(t)
  if (!clave) return null
  return POR_CLAVE.get(clave)?.codigo ?? ALIAS[clave] ?? null
}

/** Países cuyo nombre o código contiene lo escrito; primero los que EMPIEZAN así. */
export function buscarPaises(texto: string): Pais[] {
  const q = normalizarPais(texto)
  if (!q) return [...PAISES]
  const alias = ALIAS[q]
  const empiezan: Pais[] = [], contienen: Pais[] = []
  for (const p of PAISES) {
    if (p.clave.startsWith(q) || p.codigo.toLowerCase() === q || p.codigo === alias) empiezan.push(p)
    else if (p.clave.includes(q)) contienen.push(p)
  }
  return [...empiezan, ...contienen]
}

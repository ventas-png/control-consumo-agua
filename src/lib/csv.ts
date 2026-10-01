// CSV — lectura y escritura SEGURAS (sin dependencias).
//
// LEER: RFC 4180. Comillas dobles, comillas escapadas (""), saltos de línea
// dentro de una celda entre comillas, BOM UTF-8 y delimitador `,` `;` o tab
// (los Excel en español exportan con `;`). Todo valor es TEXTO: aquí no se
// convierte nada a número ni a fecha, porque un código «00123» o un NIT
// «1234567-8» no son números. Nada se evalúa ni se interpreta.
//
// ESCRIBIR: una celda que empieza con = + - @ (o tab / CR) se ejecuta como
// FÓRMULA al abrir el archivo en Excel o LibreOffice (=HYPERLINK(...) exfiltra
// datos). Se prefija con comilla simple para forzarla a texto. Esta es la ÚNICA
// definición de esa regla: `exportData` la importa de aquí.
//   https://owasp.org/www-community/attacks/CSV_Injection

/** Prefija con ' toda celda que una hoja de cálculo trataría como fórmula. */
export function neutralizarFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
}

/** Escapa UNA celda para CSV: neutraliza fórmulas y cita lo que lo necesite. */
export function escaparCeldaCsv(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  const seguro = neutralizarFormula(s)
  if (/[",\n\r;]/.test(seguro)) return `"${seguro.replace(/"/g, '""')}"`
  return seguro
}

/** Arma el CSV completo (con BOM para que Excel respete los acentos). */
export function construirCsv(filas: readonly (readonly (string | number | null | undefined)[])[]): string {
  return '﻿' + filas.map((f) => f.map(escaparCeldaCsv).join(',')).join('\r\n') + '\r\n'
}

export class CsvInvalidoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvInvalidoError'
  }
}

export type Delimitador = ',' | ';' | '\t'

/**
 * Adivina el delimitador contando, en la PRIMERA línea y fuera de comillas,
 * cuál aparece más. Empate o ninguno → coma.
 */
export function detectarDelimitador(texto: string): Delimitador {
  const cuentas: Record<Delimitador, number> = { ',': 0, ';': 0, '\t': 0 }
  let enComillas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '"') enComillas = !enComillas
    else if (!enComillas && (c === '\n' || c === '\r')) break
    else if (!enComillas && (c === ',' || c === ';' || c === '\t')) cuentas[c]++
  }
  let mejor: Delimitador = ','
  for (const d of [',', ';', '\t'] as const) if (cuentas[d] > cuentas[mejor]) mejor = d
  return mejor
}

export interface OpcionesCsv {
  /** Máximo de filas (incluido el encabezado). Por defecto 5.001. */
  maxFilas?: number
  /** Máximo de caracteres de una celda. Por defecto 5.000. */
  maxCelda?: number
}

/**
 * Convierte CSV en filas de texto. Lanza `CsvInvalidoError` ante comillas sin
 * cerrar, filas de más o celdas desmesuradas (un archivo así es un ataque o un
 * error, no datos). Ignora las filas completamente vacías.
 */
export function parsearCsv(entrada: string, opciones: OpcionesCsv = {}): string[][] {
  const maxFilas = opciones.maxFilas ?? 5001
  const maxCelda = opciones.maxCelda ?? 5000
  let texto = entrada.charCodeAt(0) === 0xfeff ? entrada.slice(1) : entrada
  if (texto.includes('\u0000')) throw new CsvInvalidoError('El archivo contiene bytes nulos: no es un CSV de texto.')

  const delimitador = detectarDelimitador(texto)
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let enComillas = false

  const cerrarCelda = () => {
    if (celda.length > maxCelda) throw new CsvInvalidoError(`Una celda supera los ${maxCelda} caracteres.`)
    fila.push(celda)
    celda = ''
  }
  const cerrarFila = () => {
    cerrarCelda()
    if (fila.some((c) => c.trim() !== '')) {
      filas.push(fila)
      if (filas.length > maxFilas) throw new CsvInvalidoError(`El archivo supera ${maxFilas - 1} filas: divídelo.`)
    }
    fila = []
  }

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++ } else { enComillas = false }
      } else {
        celda += c
      }
      continue
    }
    if (c === '"' && celda === '') { enComillas = true; continue }
    if (c === delimitador) { cerrarCelda(); continue }
    if (c === '\r') { if (texto[i + 1] === '\n') i++; cerrarFila(); continue }
    if (c === '\n') { cerrarFila(); continue }
    celda += c
  }
  if (enComillas) throw new CsvInvalidoError('Hay comillas sin cerrar: el archivo está incompleto o dañado.')
  if (celda !== '' || fila.length > 0) cerrarFila()
  texto = ''
  return filas
}

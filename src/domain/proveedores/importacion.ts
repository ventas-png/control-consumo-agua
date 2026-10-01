// Carga masiva de proveedores, asignaciones y contratos — lado del NAVEGADOR.
//
// El navegador SOLO convierte un archivo en filas de TEXTO. Todo lo demás
// (validar, detectar duplicados, calcular qué cambia, registrar el lote y
// aplicar) lo hace el servidor (`proveedores_importar_*`), porque lo que el
// navegador valida lo salta quien llama a la API directamente.
//
// Reglas de lectura que este módulo hace cumplir:
//   · CSV y XLSX de verdad (el `ImportModal` compartido aceptaba .csv y .xls
//     pero los leía con el lector de xlsx: CSV y XLS nunca funcionaron).
//   · Todo valor es TEXTO: un código «00123» o un NIT no son números. Una celda
//     numérica en una columna de identificación avisa que pudo perder ceros.
//   · NO se ejecuta nada: un libro con FÓRMULAS se rechaza (se pide convertirlas
//     a valores), un hipervínculo aporta solo su texto visible y nunca se
//     sigue, y se rechazan los formatos con macros (.xlsm) o binarios (.xls,
//     .xlsb). Leer un .xlsx con exceljs no ejecuta macros ni enlaces.
//   · Tamaño acotado (5 MB, 2000 filas por carga) para que un archivo hostil no
//     se coma el navegador.
import { construirCsv, parsearCsv, CsvInvalidoError } from '../../lib/csv'
import type { FilaImportacion, TipoImportacion } from '../../types/proveedores'

// ── Plantillas ──────────────────────────────────────────────────────────────

export interface ColumnaPlantilla {
  key: string
  /** Qué es y cómo se llena (va a la hoja «Instrucciones»). */
  ayuda: string
  requerida?: boolean
  /** Identificadores y códigos: nunca se tratan como número. */
  identificador?: boolean
  ejemplos: [string, string]
}

export interface Plantilla {
  tipo: TipoImportacion
  titulo: string
  descripcion: string
  nombreArchivo: string
  columnas: ColumnaPlantilla[]
  /** Reglas que el usuario debe conocer antes de cargar. */
  notas: string[]
}

export const MAX_FILAS_CARGA = 2000
export const MAX_BYTES_ARCHIVO = 5 * 1024 * 1024

const NOTAS_COMUNES = [
  'Importar NO autoriza proveedores ni habilita en proyectos ni activa contratos: eso se hace en pantalla, con su permiso.',
  'Las celdas vacías NO borran el valor existente, salvo que marques «vaciar celdas vacías».',
  'Los códigos, NIT, teléfonos y referencias se leen como TEXTO. En Excel, formatea la columna como Texto antes de pegar.',
  'No se admiten fórmulas: pega valores. Los hipervínculos aportan solo el texto visible.',
  `Máximo ${MAX_FILAS_CARGA} filas por carga.`,
]

export const PLANTILLAS: Record<TipoImportacion, Plantilla> = {
  proveedores: {
    tipo: 'proveedores',
    titulo: 'Proveedores',
    descripcion: 'Crea o actualiza proveedores del catálogo de la empresa.',
    nombreArchivo: 'plantilla_proveedores',
    columnas: [
      { key: 'codigo', identificador: true, ayuda: 'Código visible. Vacío = el sistema asigna PRV-00001… Con código se puede ACTUALIZAR un proveedor existente.', ejemplos: ['', 'PRV-00007'] },
      { key: 'nombre', requerida: true, ayuda: 'Razón social o nombre comercial (2–150 caracteres).', ejemplos: ['Ferretería La Unión, S.A.', 'Servicios de Limpieza Total'] },
      { key: 'pais', ayuda: 'País de la identificación fiscal (2 letras: GT, MX…). Obligatorio si hay NIT o RFC.', ejemplos: ['GT', 'GT'] },
      { key: 'nit', identificador: true, ayuda: 'NIT (Guatemala). Se normaliza: «1234567-8» y «12345678» son lo mismo.', ejemplos: ['1234567-8', ''] },
      { key: 'rfc', identificador: true, ayuda: 'RFC (México), si aplica.', ejemplos: ['', ''] },
      { key: 'email', ayuda: 'Correo de contacto.', ejemplos: ['ventas@launion.example', ''] },
      { key: 'telefono', identificador: true, ayuda: 'Teléfono (texto).', ejemplos: ['2222-3333', ''] },
      { key: 'direccion', ayuda: 'Dirección fiscal.', ejemplos: ['6a avenida 12-34 zona 1', ''] },
      { key: 'contacto_nombre', ayuda: 'Nombre del contacto principal.', ejemplos: ['Marta Ruiz', ''] },
      { key: 'dias_credito', ayuda: 'Días de crédito (0–365).', ejemplos: ['30', '0'] },
      { key: 'categoria_default', ayuda: 'mantenimiento, servicios, administrativo, seguridad, limpieza, obras u otros.', ejemplos: ['mantenimiento', 'limpieza'] },
      { key: 'abastece', ayuda: 'Qué provee, separado por ;  →  servicios;suministros;equipos', ejemplos: ['suministros;equipos', 'servicios'] },
      { key: 'alcance', ayuda: 'empresa (todos los proyectos) o proyectos (solo donde se habilite). Vacío = empresa.', ejemplos: ['empresa', ''] },
      { key: 'notas', ayuda: 'Observaciones.', ejemplos: ['', 'Sin NIT todavía: pedir RTU'] },
    ],
    notas: [
      ...NOTAS_COMUNES,
      'Un proveedor se reconoce por su CÓDIGO o por su identificación fiscal + país. Un nombre parecido NO une registros.',
      'No incluyas columnas de estado ni autorización: se rechazan.',
    ],
  },
  asignaciones: {
    tipo: 'asignaciones',
    titulo: 'Asignación a proyectos',
    descripcion: 'Vincula proveedores existentes a proyectos de la empresa. Quedan PENDIENTES de habilitar.',
    nombreArchivo: 'plantilla_asignaciones_proveedor_proyecto',
    columnas: [
      { key: 'proveedor_codigo', identificador: true, ayuda: 'Código del proveedor (o usa su identificación + país).', ejemplos: ['PRV-00007', ''] },
      { key: 'proveedor_identificacion', identificador: true, ayuda: 'NIT o RFC del proveedor, si no usas el código.', ejemplos: ['', '1234567-8'] },
      { key: 'pais', ayuda: 'País de la identificación (obligatorio si usas identificación).', ejemplos: ['', 'GT'] },
      { key: 'proyecto', ayuda: 'Nombre del proyecto, exacto como aparece en el sistema.', ejemplos: ['Torre Norte', 'Torre Norte'] },
      { key: 'proyecto_id', identificador: true, ayuda: 'Solo si hay dos proyectos con el mismo nombre.', ejemplos: ['', ''] },
      { key: 'dias_credito', ayuda: 'Días de crédito propios de ESTE proyecto (0–365).', ejemplos: ['45', ''] },
      { key: 'condiciones_pago', ayuda: 'Condiciones de pago propias del proyecto.', ejemplos: ['Neto 45, factura mensual', ''] },
      { key: 'vigente_hasta', ayuda: 'Fecha AAAA-MM-DD hasta la que vale la habilitación.', ejemplos: ['2027-12-31', ''] },
      { key: 'notas', ayuda: 'Observaciones.', ejemplos: ['', ''] },
    ],
    notas: [
      ...NOTAS_COMUNES,
      'Solo ves y cargas proyectos a los que tienes acceso.',
      'La habilitación (pendiente → habilitado) se hace en pantalla y exige el permiso de cambio de estado.',
    ],
  },
  contratos: {
    tipo: 'contratos',
    titulo: 'Contratos',
    descripcion: 'Crea contratos en BORRADOR vinculados a un proveedor del catálogo.',
    nombreArchivo: 'plantilla_contratos_proveedor',
    columnas: [
      { key: 'referencia', requerida: true, identificador: true, ayuda: 'Clave estable del contrato dentro del proyecto. Permite reintentar la carga sin duplicar.', ejemplos: ['CTR-2026-001', 'CTR-2026-002'] },
      { key: 'proveedor_codigo', identificador: true, ayuda: 'Código del proveedor (o su identificación + país).', ejemplos: ['PRV-00007', ''] },
      { key: 'proveedor_identificacion', identificador: true, ayuda: 'NIT o RFC del proveedor, si no usas el código.', ejemplos: ['', '1234567-8'] },
      { key: 'pais', ayuda: 'País de la identificación.', ejemplos: ['', 'GT'] },
      { key: 'proyecto', requerida: true, ayuda: 'Nombre del proyecto.', ejemplos: ['Torre Norte', 'Torre Norte'] },
      { key: 'proyecto_id', identificador: true, ayuda: 'Solo si hay proyectos con el mismo nombre.', ejemplos: ['', ''] },
      { key: 'servicio', ayuda: 'limpieza, jardineria, seguridad, mantenimiento, elevadores, piscina u otro.', ejemplos: ['limpieza', 'mantenimiento'] },
      { key: 'modalidad', requerida: true, ayuda: 'recurrente (servicio periódico) o por_demanda (compras cuando se necesitan).', ejemplos: ['recurrente', 'por_demanda'] },
      { key: 'periodicidad', ayuda: 'Obligatoria si es recurrente: semanal, quincenal, mensual, bimestral, trimestral, semestral, anual, unica.', ejemplos: ['mensual', ''] },
      { key: 'moneda', ayuda: 'Código de 3 letras (GTQ, USD). Obligatoria si hay importes.', ejemplos: ['GTQ', 'GTQ'] },
      { key: 'importe_periodico', ayuda: 'Importe por periodo, con punto decimal y SIN separador de miles. Solo recurrente.', ejemplos: ['2500.50', ''] },
      { key: 'monto_maximo', ayuda: 'Tope total (opcional), útil en compras por demanda.', ejemplos: ['', '10000'] },
      { key: 'fecha_inicio', requerida: true, ayuda: 'AAAA-MM-DD.', ejemplos: ['2026-02-01', '2026-02-01'] },
      { key: 'fecha_fin', ayuda: 'AAAA-MM-DD (opcional).', ejemplos: ['2026-12-31', ''] },
      { key: 'alcance', ayuda: 'Qué cubre el contrato.', ejemplos: ['Limpieza semanal de áreas comunes', 'Compras de ferretería a demanda'] },
      { key: 'descripcion', ayuda: 'Detalle adicional.', ejemplos: ['', ''] },
    ],
    notas: [
      ...NOTAS_COMUNES,
      'Los contratos nacen en BORRADOR: no generan facturas, pagos, órdenes ni asientos. Se activan en pantalla (con responsable).',
      'Un contrato que ya salió de borrador no se modifica por importación: repetir el mismo archivo da «sin cambios».',
      'El proveedor y el proyecto de un contrato no cambian: para otro proveedor se termina el contrato y se crea uno nuevo.',
    ],
  },
}

/** Encabezado + 2 filas de ejemplo, listas para CSV o XLSX. */
export function filasPlantilla(tipo: TipoImportacion): string[][] {
  const p = PLANTILLAS[tipo]
  return [
    p.columnas.map((c) => c.key),
    p.columnas.map((c) => c.ejemplos[0]),
    p.columnas.map((c) => c.ejemplos[1]),
  ]
}

export function csvPlantilla(tipo: TipoImportacion): string {
  return construirCsv(filasPlantilla(tipo))
}

/**
 * Libro XLSX de la plantilla: hoja «Datos» con TODAS las columnas formateadas
 * como Texto (Excel no convierte «00123» en 123 ni «2026-02-01» en una fecha) y
 * hoja «Instrucciones». Devuelve el buffer; la descarga la hace el llamador.
 */
export async function xlsxPlantilla(tipo: TipoImportacion): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const p = PLANTILLAS[tipo]
  const wb = new ExcelJS.Workbook()
  const datos = wb.addWorksheet('Datos')
  for (const fila of filasPlantilla(tipo)) datos.addRow(fila)
  p.columnas.forEach((c, i) => {
    const col = datos.getColumn(i + 1)
    col.numFmt = '@'
    col.width = Math.max(14, Math.min(34, c.key.length + 6))
  })
  datos.getRow(1).font = { bold: true }
  datos.views = [{ state: 'frozen', ySplit: 1 }]

  const ayuda = wb.addWorksheet('Instrucciones')
  ayuda.addRow([p.titulo]).font = { bold: true, size: 14 }
  ayuda.addRow([p.descripcion])
  ayuda.addRow([])
  ayuda.addRow(['Reglas']).font = { bold: true }
  for (const n of p.notas) ayuda.addRow([`• ${n}`])
  ayuda.addRow([])
  ayuda.addRow(['Columna', 'Obligatoria', 'Qué poner']).font = { bold: true }
  for (const c of p.columnas) ayuda.addRow([c.key, c.requerida ? 'Sí' : '', c.ayuda])
  ayuda.getColumn(1).width = 28
  ayuda.getColumn(2).width = 12
  ayuda.getColumn(3).width = 90

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export class ArchivoImportacionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchivoImportacionError'
  }
}

export interface ArchivoLeido {
  columnas: string[]
  filas: Record<string, string>[]
  advertencias: string[]
  /** SHA-256 del archivo original (trazabilidad); '' si el entorno no lo ofrece. */
  sha256: string
}

/** «Código *» → `codigo`, «Días de crédito» → `dias_de_credito`. */
export function normalizarEncabezado(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*]/g, '')
    .trim()
    .replace(/[\s\-/.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
}

const EXTENSIONES_RECHAZADAS: Record<string, string> = {
  xlsm: 'Los libros con macros (.xlsm) no se aceptan: guarda una copia como .xlsx o .csv.',
  xlsb: 'El formato binario (.xlsb) no se acepta: guarda una copia como .xlsx o .csv.',
  xls: 'El formato antiguo .xls no se acepta (puede llevar macros): guárdalo como .xlsx o .csv.',
  xltm: 'Las plantillas con macros no se aceptan: guarda como .xlsx o .csv.',
  xltx: 'Guarda el archivo como libro .xlsx o como .csv.',
  ods: 'Guarda el archivo como .xlsx o .csv.',
}

function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf('.')
  return i < 0 ? '' : nombre.slice(i + 1).toLowerCase()
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return ''
    const h = new Uint8Array(await subtle.digest('SHA-256', buffer))
    return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

function decodificarTexto(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    // Los Excel en español guardan «CSV» en Windows-1252: sin esto, «ñ» y los
    // acentos llegarían como basura.
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

/** Comprueba los encabezados contra la plantilla: faltantes (error) y desconocidos (aviso). */
export function validarEncabezados(
  tipo: TipoImportacion,
  columnas: readonly string[],
): { errores: string[]; advertencias: string[] } {
  const p = PLANTILLAS[tipo]
  const conocidas = new Set(p.columnas.map((c) => c.key))
  const tiene = (k: string) => columnas.includes(k)
  const errores: string[] = []

  for (const c of p.columnas.filter((x) => x.requerida)) {
    // `proyecto` se puede sustituir por `proyecto_id`.
    if (c.key === 'proyecto' && (tiene('proyecto') || tiene('proyecto_id'))) continue
    if (!tiene(c.key)) errores.push(`Falta la columna obligatoria «${c.key}».`)
  }
  if (tipo !== 'proveedores') {
    if (!tiene('proveedor_codigo') && !tiene('proveedor_identificacion')) {
      errores.push('Falta identificar al proveedor: usa «proveedor_codigo» o «proveedor_identificacion».')
    }
    if (!tiene('proyecto') && !tiene('proyecto_id')) {
      if (!errores.some((e) => e.includes('«proyecto»'))) errores.push('Falta la columna «proyecto» (o «proyecto_id»).')
    }
  }
  const advertencias = columnas
    .filter((c) => !conocidas.has(c))
    .map((c) => `Columna desconocida «${c}»: el servidor la ignora (o la rechaza si trae estado/autorización).`)
  return { errores, advertencias }
}

function filasDesdeMatriz(
  matriz: string[][],
  tipo: TipoImportacion,
  advertenciasIniciales: string[],
): Omit<ArchivoLeido, 'sha256'> {
  if (matriz.length === 0) throw new ArchivoImportacionError('El archivo está vacío.')
  const columnas = matriz[0].map(normalizarEncabezado)
  if (columnas.every((c) => c === '')) throw new ArchivoImportacionError('La primera fila debe ser el encabezado con los nombres de columna.')

  const duplicadas = columnas.filter((c, i) => c !== '' && columnas.indexOf(c) !== i)
  if (duplicadas.length > 0) {
    throw new ArchivoImportacionError(`Hay columnas repetidas: ${[...new Set(duplicadas)].join(', ')}.`)
  }
  const { errores, advertencias } = validarEncabezados(tipo, columnas)
  if (errores.length > 0) throw new ArchivoImportacionError(errores.join(' '))

  const filas: Record<string, string>[] = []
  for (let r = 1; r < matriz.length; r++) {
    const obj: Record<string, string> = {}
    let alguno = false
    columnas.forEach((c, i) => {
      if (c === '') return
      const v = (matriz[r][i] ?? '').trim()
      obj[c] = v
      if (v !== '') alguno = true
    })
    if (alguno) filas.push(obj)
  }
  if (filas.length === 0) throw new ArchivoImportacionError('El archivo no tiene filas de datos debajo del encabezado.')
  if (filas.length > MAX_FILAS_CARGA) {
    throw new ArchivoImportacionError(`El archivo tiene ${filas.length} filas y el máximo es ${MAX_FILAS_CARGA} por carga: divídelo.`)
  }
  return { columnas: columnas.filter((c) => c !== ''), filas, advertencias: [...advertenciasIniciales, ...advertencias] }
}

/** Columnas que son identificadores/códigos de la plantilla del tipo. */
function columnasIdentificador(tipo: TipoImportacion): Set<string> {
  return new Set(PLANTILLAS[tipo].columnas.filter((c) => c.identificador).map((c) => c.key))
}

// Valores del enum de exceljs (`ExcelJS.ValueType`), fijos por contrato público.
const VT = { Number: 2, Date: 4, Hyperlink: 5, Formula: 6, RichText: 8, Boolean: 9, Error: 10 } as const

async function matrizDesdeXlsx(
  buffer: ArrayBuffer,
  tipo: TipoImportacion,
): Promise<{ matriz: string[][]; advertencias: string[] }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch {
    throw new ArchivoImportacionError('No se pudo leer el libro: verifica que sea un .xlsx válido.')
  }
  const ws = wb.worksheets[0]
  if (!ws) throw new ArchivoImportacionError('El libro no tiene hojas.')
  if (ws.rowCount > MAX_FILAS_CARGA + 50) {
    throw new ArchivoImportacionError(`La hoja tiene ${ws.rowCount} filas y el máximo es ${MAX_FILAS_CARGA} por carga: divídela.`)
  }

  const advertencias: string[] = []
  const formulas: string[] = []
  const enlaces: string[] = []
  const numericasEnId: string[] = []
  const matriz: string[][] = []
  const ids = columnasIdentificador(tipo)
  let encabezados: string[] | null = null

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const valores: string[] = []
    const ancho = Math.min(row.cellCount, 60)
    for (let c = 1; c <= ancho; c++) {
      const cell = row.getCell(c)
      const tipoCelda = cell.type as number
      let texto = ''
      if (tipoCelda === VT.Formula) {
        formulas.push(cell.address)
      } else if (tipoCelda === VT.Hyperlink) {
        const v = cell.value as { text?: unknown }
        texto = typeof v?.text === 'string' ? v.text : String(cell.text ?? '')
        enlaces.push(cell.address)
      } else if (tipoCelda === VT.Date) {
        const d = cell.value as Date
        texto = Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
      } else if (tipoCelda === VT.RichText) {
        const v = cell.value as { richText?: { text?: string }[] }
        texto = (v.richText ?? []).map((t) => t.text ?? '').join('')
      } else if (tipoCelda === VT.Error) {
        texto = ''
        advertencias.push(`La celda ${cell.address} tiene un error de hoja (${String(cell.text)}): se leyó vacía.`)
      } else if (tipoCelda === VT.Boolean) {
        texto = cell.value ? 'true' : 'false'
      } else if (tipoCelda === VT.Number) {
        texto = String(cell.value)
        const key = encabezados ? normalizarEncabezado(encabezados[c - 1] ?? '') : ''
        if (encabezados && ids.has(key)) {
          numericasEnId.push(cell.address)
        }
      } else if (cell.value !== null && cell.value !== undefined) {
        texto = String(cell.text ?? cell.value)
      }
      valores.push(texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''))
    }
    if (encabezados === null && valores.some((v) => v.trim() !== '')) encabezados = valores
    if (encabezados !== null) matriz.push(valores)
    void rowNumber
  })

  if (formulas.length > 0) {
    const ej = formulas.slice(0, 5).join(', ')
    throw new ArchivoImportacionError(
      `El libro contiene ${formulas.length} celda(s) con FÓRMULAS (${ej}${formulas.length > 5 ? '…' : ''}). ` +
        'No se admiten: copia y «pegar como valores» antes de cargar.',
    )
  }
  if (enlaces.length > 0) {
    advertencias.push(
      `Hay ${enlaces.length} hipervínculo(s) (${enlaces.slice(0, 5).join(', ')}): solo se usa el texto visible; ningún enlace se sigue.`,
    )
  }
  if (numericasEnId.length > 0) {
    advertencias.push(
      `Las celdas ${numericasEnId.slice(0, 5).join(', ')}${numericasEnId.length > 5 ? '…' : ''} de columnas de código/identificación son NUMÉRICAS: si el valor empezaba con ceros, Excel ya los quitó. Formatea la columna como Texto.`,
    )
  }
  return { matriz, advertencias }
}

/**
 * Lee un archivo de carga. Puro respecto del DOM (recibe nombre y bytes), así se
 * prueba en Node. Lanza `ArchivoImportacionError` con un mensaje apto para el
 * usuario; nunca devuelve filas a medias.
 */
export async function leerArchivoImportacion(
  nombre: string,
  buffer: ArrayBuffer,
  tipo: TipoImportacion,
): Promise<ArchivoLeido> {
  const ext = extensionDe(nombre)
  if (EXTENSIONES_RECHAZADAS[ext]) throw new ArchivoImportacionError(EXTENSIONES_RECHAZADAS[ext])
  if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'txt') {
    throw new ArchivoImportacionError('Solo se aceptan archivos .csv o .xlsx.')
  }
  if (buffer.byteLength === 0) throw new ArchivoImportacionError('El archivo está vacío.')
  if (buffer.byteLength > MAX_BYTES_ARCHIVO) {
    throw new ArchivoImportacionError(`El archivo pesa más de ${MAX_BYTES_ARCHIVO / 1024 / 1024} MB: divídelo.`)
  }

  const cabeza = new Uint8Array(buffer.slice(0, 4))
  const esZip = cabeza[0] === 0x50 && cabeza[1] === 0x4b && cabeza[2] === 0x03 && cabeza[3] === 0x04
  const sha256 = await sha256Hex(buffer)

  if (ext === 'xlsx') {
    if (!esZip) throw new ArchivoImportacionError('El archivo no es un .xlsx válido (el contenido no coincide con la extensión).')
    const { matriz, advertencias } = await matrizDesdeXlsx(buffer, tipo)
    return { ...filasDesdeMatriz(matriz, tipo, advertencias), sha256 }
  }

  // CSV / TXT: un zip renombrado no es texto.
  if (esZip) throw new ArchivoImportacionError('El archivo parece un .xlsx renombrado como .csv: ábrelo con su extensión real.')
  try {
    const matriz = parsearCsv(decodificarTexto(buffer), { maxFilas: MAX_FILAS_CARGA + 1 })
    return { ...filasDesdeMatriz(matriz, tipo, []), sha256 }
  } catch (e) {
    if (e instanceof CsvInvalidoError) throw new ArchivoImportacionError(e.message)
    throw e
  }
}

// ── Informe de errores ──────────────────────────────────────────────────────

/** CSV descargable con las filas del lote y su resultado. Toda celda va neutralizada contra fórmulas. */
export function construirInformeLote(filas: readonly FilaImportacion[], columnas: readonly string[]): string {
  const encabezado = ['fila', 'accion', 'estado', ...columnas, 'errores', 'advertencias', 'cambios', 'resultado']
  const cuerpo = filas.map((f) => [
    f.fila,
    f.accion,
    f.estado,
    ...columnas.map((c) => String((f.origen as Record<string, unknown>)?.[c] ?? '')),
    f.errores.map((e) => `${e.campo}: ${e.mensaje}`).join(' | '),
    f.advertencias.map((e) => `${e.campo}: ${e.mensaje}`).join(' | '),
    Object.entries(f.cambios ?? {})
      .map(([k, v]) => `${k}: ${String(v.antes ?? '∅')} → ${String(v.despues ?? '∅')}`)
      .join(' | '),
    f.resultado ?? '',
  ])
  return construirCsv([encabezado, ...cuerpo])
}

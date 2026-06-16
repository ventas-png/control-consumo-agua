import type { CategoriaInventario, EstadoInventario } from '../../types'
import { createInventarioItems } from '../../domain/condominios/mutations'
import { sanitizeInput } from '../../lib/validation'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

const CATEGORIAS_VALIDAS: CategoriaInventario[] = [
  'herramienta', 'equipo', 'material', 'mobiliario', 'vehiculo', 'otro',
]
const ESTADOS_VALIDOS: EstadoInventario[] = [
  'disponible', 'en_uso', 'en_reparacion', 'dado_de_baja',
]

function normalizeDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null
    const y = raw.getFullYear()
    const m = String(raw.getMonth() + 1).padStart(2, '0')
    const d = String(raw.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // Serial de Excel (días desde 1899-12-30).
  if (typeof raw === 'number') {
    const date = new Date((raw - 25569) * 86400 * 1000)
    if (isNaN(date.getTime())) return null
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, '0')
    const d = String(date.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const str = String(raw).trim()
  if (!str) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const parts = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (parts) return `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}`
  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return null
}

function parseOptionalDate(raw: unknown, fieldName: string, errors: string[]): string | undefined {
  if (raw === null || raw === undefined || String(raw).trim() === '') return undefined
  const normalized = normalizeDate(raw)
  if (normalized === null) {
    errors.push(`${fieldName} inválido: "${raw}" — use YYYY-MM-DD o celda tipo fecha`)
    return undefined
  }
  return normalized
}

interface InventarioRow {
  nombre: string
  categoria: CategoriaInventario
  descripcion?: string | null
  numero_serie?: string | null
  ubicacion?: string | null
  estado: EstadoInventario
  cantidad: number
  cantidad_minima: number
  unidad_medida: string
  costo_unitario?: number | null
  proveedor?: string | null
  fecha_adquisicion?: string | null
  fecha_vencimiento?: string | null
  notas?: string | null
}

const COLUMNS: ImportColumn[] = [
  { key: 'nombre',            width: 24, exampleValues: ['Taladro inalámbrico', 'Bomba de agua 1HP', 'Sacos de cemento'] },
  { key: 'categoria',        width: 14, exampleValues: ['herramienta', 'equipo', 'material'] },
  { key: 'estado',           width: 14, exampleValues: ['disponible', 'en_uso', 'disponible'] },
  { key: 'cantidad',         width: 10, exampleValues: [1, 1, 50] },
  { key: 'cantidad_minima',  width: 14, exampleValues: [0, 1, 10] },
  { key: 'unidad_medida',    width: 12, exampleValues: ['unidad', 'unidad', 'saco'] },
  { key: 'costo_unitario',   width: 14, exampleValues: [850.00, 1200.50, 75] },
  { key: 'ubicacion',        width: 22, exampleValues: ['Bodega herramientas', 'Cuarto de máquinas', 'Bodega general'] },
  { key: 'numero_serie',     width: 18, exampleValues: ['SN-12345', '', ''] },
  { key: 'proveedor',        width: 20, exampleValues: ['Ferretería Central', 'Bombas S.A.', ''] },
  { key: 'fecha_adquisicion', width: 18, exampleValues: ['2024-01-15', '2023-06-01', ''] },
  { key: 'fecha_vencimiento', width: 18, exampleValues: ['', '', '2026-12-31'] },
  { key: 'descripcion',      width: 28, exampleValues: ['Marca DeWalt, 20V', 'Motor trifásico', ''] },
]

function validateRow(row: Record<string, unknown>): RowValidationResult<InventarioRow> {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  if (!nombre || nombre.length < 1) errors.push('nombre es obligatorio')

  const categoria = String(row['categoria'] ?? '').trim().toLowerCase() as CategoriaInventario
  if (!CATEGORIAS_VALIDAS.includes(categoria))
    errors.push(`categoria inválida: "${row['categoria']}" — use: ${CATEGORIAS_VALIDAS.join(', ')}`)

  // estado es opcional → default 'disponible'.
  const rawEstado = String(row['estado'] ?? '').trim().toLowerCase()
  let estado: EstadoInventario = 'disponible'
  if (rawEstado) {
    if (!ESTADOS_VALIDOS.includes(rawEstado as EstadoInventario))
      errors.push(`estado inválido: "${row['estado']}" — use: ${ESTADOS_VALIDOS.join(', ')}`)
    else estado = rawEstado as EstadoInventario
  }

  // cantidad → default 1.
  let cantidad = 1
  const rawCantidad = String(row['cantidad'] ?? '').trim()
  if (rawCantidad) {
    cantidad = Number(rawCantidad)
    if (isNaN(cantidad) || cantidad < 0) errors.push('cantidad debe ser un número ≥ 0')
  }

  // cantidad_minima → default 0.
  let cantidad_minima = 0
  const rawMin = String(row['cantidad_minima'] ?? '').trim()
  if (rawMin) {
    cantidad_minima = Number(rawMin)
    if (isNaN(cantidad_minima) || cantidad_minima < 0) errors.push('cantidad_minima debe ser un número ≥ 0')
  }

  // costo_unitario → opcional.
  let costo_unitario: number | undefined
  const rawCosto = String(row['costo_unitario'] ?? '').trim()
  if (rawCosto) {
    costo_unitario = Number(rawCosto)
    if (isNaN(costo_unitario) || costo_unitario < 0) errors.push('costo_unitario debe ser un número ≥ 0')
  }

  const fecha_adquisicion = parseOptionalDate(row['fecha_adquisicion'], 'fecha_adquisicion', errors)
  const fecha_vencimiento = parseOptionalDate(row['fecha_vencimiento'], 'fecha_vencimiento', errors)

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      nombre,
      categoria,
      estado,
      cantidad,
      cantidad_minima,
      unidad_medida: String(row['unidad_medida'] ?? '').trim() || 'unidad',
      costo_unitario: costo_unitario ?? undefined,
      ubicacion:     sanitizeInput(String(row['ubicacion'] ?? '').trim()) || undefined,
      numero_serie:  String(row['numero_serie'] ?? '').trim() || undefined,
      proveedor:     sanitizeInput(String(row['proveedor'] ?? '').trim()) || undefined,
      fecha_adquisicion,
      fecha_vencimiento,
      descripcion:   sanitizeInput(String(row['descripcion'] ?? '').trim()) || undefined,
    },
  }
}

interface Props {
  proyectoId: string
  companyId: string
  onClose: () => void
  onImportado: () => void
}

export function ImportInventarioModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  return (
    <ImportModal<InventarioRow>
      entityLabel="item"
      entityLabelPlural="items"
      sheetName="Inventario"
      templateFilename="plantilla_inventario"
      columns={COLUMNS}
      validateRow={validateRow}
      onInsertBatch={async (batch) => {
        const payload = batch.map(i => ({
          ...i,
          project_id: proyectoId,
          company_id: companyId,
        }))
        const { error } = await createInventarioItems(payload)
        return error
          ? { ok: 0, error }
          : { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado()}
    />
  )
}

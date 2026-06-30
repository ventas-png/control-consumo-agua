import type { CategoriaSupministro, UnidadMedidaSum } from '../../types'
import { createSuministrosCondominio } from '../../domain/condominios/mutations'
import { sanitizeInput } from '../../lib/validation'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

const CATEGORIAS_VALIDAS: CategoriaSupministro[] = [
  'limpieza', 'herramienta', 'material', 'oficina', 'seguridad', 'otro',
]
const UNIDADES_VALIDAS: UnidadMedidaSum[] = [
  'unidad', 'litro', 'kg', 'metro', 'caja', 'rollo', 'otro',
]

interface SuministroRow {
  nombre: string
  categoria: CategoriaSupministro
  unidad_medida: UnidadMedidaSum
  stock_actual: number
  stock_minimo: number
  ubicacion?: string | null
  proveedor?: string | null
  costo_unitario?: number | null
  notas?: string | null
}

const COLUMNS: ImportColumn[] = [
  { key: 'nombre',         width: 26, exampleValues: ['Detergente multiusos', 'Bolsas de basura 50L', 'Cloro industrial'] },
  { key: 'categoria',      width: 14, exampleValues: ['limpieza', 'limpieza', 'limpieza'] },
  { key: 'unidad_medida',  width: 14, exampleValues: ['litro', 'caja', 'litro'] },
  { key: 'stock_actual',   width: 14, exampleValues: [20, 5, 12] },
  { key: 'stock_minimo',   width: 14, exampleValues: [5, 1, 4] },
  { key: 'costo_unitario', width: 16, exampleValues: [35.50, 80, 22.75] },
  { key: 'ubicacion',      width: 22, exampleValues: ['Cuarto de limpieza', 'Bodega general', 'Cuarto de máquinas'] },
  { key: 'proveedor',      width: 20, exampleValues: ['Distribuidora XYZ', '', 'Químicos S.A.'] },
  { key: 'notas',          width: 28, exampleValues: ['Diluir 1:10', '', 'Manejar con guantes'] },
]

function validateRow(row: Record<string, unknown>): RowValidationResult<SuministroRow> {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  if (!nombre || nombre.length < 1) errors.push('nombre es obligatorio')

  // categoria es opcional → default 'limpieza'.
  const rawCategoria = String(row['categoria'] ?? '').trim().toLowerCase()
  let categoria: CategoriaSupministro = 'limpieza'
  if (rawCategoria) {
    if (!CATEGORIAS_VALIDAS.includes(rawCategoria as CategoriaSupministro))
      errors.push(`categoria inválida: "${row['categoria']}" — use: ${CATEGORIAS_VALIDAS.join(', ')}`)
    else categoria = rawCategoria as CategoriaSupministro
  }

  // unidad_medida es opcional → default 'unidad'.
  const rawUnidad = String(row['unidad_medida'] ?? '').trim().toLowerCase()
  let unidad_medida: UnidadMedidaSum = 'unidad'
  if (rawUnidad) {
    if (!UNIDADES_VALIDAS.includes(rawUnidad as UnidadMedidaSum))
      errors.push(`unidad_medida inválida: "${row['unidad_medida']}" — use: ${UNIDADES_VALIDAS.join(', ')}`)
    else unidad_medida = rawUnidad as UnidadMedidaSum
  }

  // stock_actual → default 0.
  let stock_actual = 0
  const rawStock = String(row['stock_actual'] ?? '').trim()
  if (rawStock) {
    stock_actual = Number(rawStock)
    if (isNaN(stock_actual) || stock_actual < 0) errors.push('stock_actual debe ser un número ≥ 0')
  }

  // stock_minimo → default 0.
  let stock_minimo = 0
  const rawMin = String(row['stock_minimo'] ?? '').trim()
  if (rawMin) {
    stock_minimo = Number(rawMin)
    if (isNaN(stock_minimo) || stock_minimo < 0) errors.push('stock_minimo debe ser un número ≥ 0')
  }

  // costo_unitario → opcional.
  let costo_unitario: number | undefined
  const rawCosto = String(row['costo_unitario'] ?? '').trim()
  if (rawCosto) {
    costo_unitario = Number(rawCosto)
    if (isNaN(costo_unitario) || costo_unitario < 0) errors.push('costo_unitario debe ser un número ≥ 0')
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      nombre,
      categoria,
      unidad_medida,
      stock_actual,
      stock_minimo,
      costo_unitario: costo_unitario ?? undefined,
      ubicacion:  sanitizeInput(String(row['ubicacion'] ?? '').trim()) || undefined,
      proveedor:  sanitizeInput(String(row['proveedor'] ?? '').trim()) || undefined,
      notas:      sanitizeInput(String(row['notas'] ?? '').trim()) || undefined,
    },
  }
}

interface Props {
  proyectoId: string
  companyId: string
  onClose: () => void
  onImportado: () => void
}

export function ImportSuministrosModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  return (
    <ImportModal<SuministroRow>
      entityLabel="suministro"
      entityLabelPlural="suministros"
      sheetName="Suministros"
      templateFilename="plantilla_suministros"
      columns={COLUMNS}
      validateRow={validateRow}
      onInsertBatch={async (batch) => {
        const payload = batch.map(s => ({
          ...s,
          project_id: proyectoId,
          company_id: companyId,
        }))
        const { error } = await createSuministrosCondominio(payload)
        return error
          ? { ok: 0, error }
          : { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado()}
    />
  )
}

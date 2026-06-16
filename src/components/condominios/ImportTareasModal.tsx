import type { CategoriaTareaCondominio, PrioridadTarea, EstadoTarea } from '../../types'
import { createTareasCondominio } from '../../domain/condominios/mutations'
import { sanitizeInput } from '../../lib/validation'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

const CATEGORIAS_VALIDAS: CategoriaTareaCondominio[] = [
  'operativa', 'mantenimiento', 'administrativa', 'seguridad', 'limpieza', 'otro',
]
const PRIORIDADES_VALIDAS: PrioridadTarea[] = ['baja', 'media', 'alta', 'urgente']

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

interface TareaRow {
  titulo: string
  descripcion?: string | null
  categoria: CategoriaTareaCondominio
  prioridad: PrioridadTarea
  estado: EstadoTarea
  asignado_a?: string | null
  reportado_por?: string | null
  area?: string | null
  fecha_inicio?: string | null
  fecha_limite?: string | null
  costo_estimado?: number | null
}

const COLUMNS: ImportColumn[] = [
  { key: 'titulo',         width: 30, exampleValues: ['Revisar bomba de cisterna', 'Limpieza de áreas verdes', 'Inspección de extintores'] },
  { key: 'categoria',      width: 16, exampleValues: ['mantenimiento', 'limpieza', 'seguridad'] },
  { key: 'prioridad',      width: 12, exampleValues: ['alta', 'media', 'urgente'] },
  { key: 'area',           width: 18, exampleValues: ['Cuarto de máquinas', 'Jardín principal', 'Todo el edificio'] },
  { key: 'asignado_a',     width: 20, exampleValues: ['Juan Pérez', 'Cuadrilla jardinería', 'Empresa XYZ'] },
  { key: 'reportado_por',  width: 20, exampleValues: ['Administración', 'Residente 4B', ''] },
  { key: 'costo_estimado', width: 16, exampleValues: [500, 0, 1200.50] },
  { key: 'fecha_inicio',   width: 16, exampleValues: ['2026-06-20', '', '2026-07-01'] },
  { key: 'fecha_limite',   width: 16, exampleValues: ['2026-06-30', '2026-07-05', '2026-07-15'] },
  { key: 'descripcion',    width: 32, exampleValues: ['Cambiar empaque y verificar presión', '', 'Recargar las que estén vencidas'] },
]

function validateRow(row: Record<string, unknown>): RowValidationResult<TareaRow> {
  const errors: string[] = []

  const titulo = sanitizeInput(String(row['titulo'] ?? '').trim())
  if (!titulo || titulo.length < 1) errors.push('titulo es obligatorio')

  // categoria es opcional → default 'operativa'.
  const rawCategoria = String(row['categoria'] ?? '').trim().toLowerCase()
  let categoria: CategoriaTareaCondominio = 'operativa'
  if (rawCategoria) {
    if (!CATEGORIAS_VALIDAS.includes(rawCategoria as CategoriaTareaCondominio))
      errors.push(`categoria inválida: "${row['categoria']}" — use: ${CATEGORIAS_VALIDAS.join(', ')}`)
    else categoria = rawCategoria as CategoriaTareaCondominio
  }

  // prioridad es opcional → default 'media'.
  const rawPrioridad = String(row['prioridad'] ?? '').trim().toLowerCase()
  let prioridad: PrioridadTarea = 'media'
  if (rawPrioridad) {
    if (!PRIORIDADES_VALIDAS.includes(rawPrioridad as PrioridadTarea))
      errors.push(`prioridad inválida: "${row['prioridad']}" — use: ${PRIORIDADES_VALIDAS.join(', ')}`)
    else prioridad = rawPrioridad as PrioridadTarea
  }

  // costo_estimado → opcional.
  let costo_estimado: number | undefined
  const rawCosto = String(row['costo_estimado'] ?? '').trim()
  if (rawCosto) {
    costo_estimado = Number(rawCosto)
    if (isNaN(costo_estimado) || costo_estimado < 0) errors.push('costo_estimado debe ser un número ≥ 0')
  }

  const fecha_inicio = parseOptionalDate(row['fecha_inicio'], 'fecha_inicio', errors)
  const fecha_limite = parseOptionalDate(row['fecha_limite'], 'fecha_limite', errors)

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      titulo,
      categoria,
      prioridad,
      estado: 'pendiente',
      asignado_a:    sanitizeInput(String(row['asignado_a'] ?? '').trim()) || undefined,
      reportado_por: sanitizeInput(String(row['reportado_por'] ?? '').trim()) || undefined,
      area:          sanitizeInput(String(row['area'] ?? '').trim()) || undefined,
      fecha_inicio,
      fecha_limite,
      costo_estimado: costo_estimado ?? undefined,
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

export function ImportTareasModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  return (
    <ImportModal<TareaRow>
      entityLabel="tarea"
      entityLabelPlural="tareas"
      sheetName="Tareas"
      templateFilename="plantilla_tareas"
      columns={COLUMNS}
      validateRow={validateRow}
      onInsertBatch={async (batch) => {
        const payload = batch.map(t => ({
          ...t,
          project_id: proyectoId,
          company_id: companyId,
        }))
        const { error } = await createTareasCondominio(payload)
        return error
          ? { ok: 0, error }
          : { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado()}
    />
  )
}

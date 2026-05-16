import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

function normalizeTime(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const str = String(raw).trim()
  if (!str) return null
  if (/^\d{2}:\d{2}$/.test(str)) return str
  if (/^\d{1}:\d{2}$/.test(str)) return `0${str}`
  if (/^\d{2}:\d{2}:\d{2}$/.test(str)) return str.slice(0, 5)
  // Excel stores times as fractions of a day
  if (typeof raw === 'number' && raw >= 0 && raw < 1) {
    const totalMinutes = Math.round(raw * 24 * 60)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return null
}

function normalizeBool(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === '') return false
  const str = String(raw).trim().toLowerCase()
  return str === 'sí' || str === 'si' || str === 'yes' || str === '1' || str === 'true' || str === 'x'
}

interface AmenidadImportRow {
  nombre: string
  descripcion?: string
  capacidad_max?: number
  horario_inicio?: string
  horario_fin?: string
  requiere_deposito: boolean
  monto_deposito?: number
  requiere_tarifa: boolean
  tarifa_uso?: number
  tarifa_uso_finde?: number
  requiere_aprobacion: boolean
  reglamento?: string
}

const COLUMNS: ImportColumn[] = [
  { key: 'nombre',              width: 18, exampleValues: ['Piscina', 'Salón Social', 'Gimnasio'] },
  { key: 'descripcion',         width: 30, exampleValues: ['Área de natación principal', 'Salón para eventos y reuniones', ''] },
  { key: 'capacidad_max',       width: 14, exampleValues: [30, 80, 20] },
  { key: 'horario_inicio',      width: 14, exampleValues: ['06:00', '08:00', '05:00'] },
  { key: 'horario_fin',         width: 12, exampleValues: ['22:00', '23:00', '23:00'] },
  { key: 'requiere_deposito',   width: 18, exampleValues: ['sí', 'sí', 'no'] },
  { key: 'monto_deposito',      width: 15, exampleValues: [100, 200, ''] },
  { key: 'requiere_tarifa',     width: 16, exampleValues: ['no', 'sí', 'no'] },
  { key: 'tarifa_uso',          width: 12, exampleValues: ['', 50, ''] },
  { key: 'tarifa_uso_finde',    width: 16, exampleValues: ['', 75, ''] },
  { key: 'requiere_aprobacion', width: 20, exampleValues: ['no', 'sí', 'no'] },
  { key: 'reglamento',          width: 40, exampleValues: ['', 'El residente es responsable de dejar el salón limpio.', ''] },
]

function validateRow(row: Record<string, unknown>): RowValidationResult<AmenidadImportRow> {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  if (!nombre || nombre.length < 2)
    errors.push('nombre debe tener al menos 2 caracteres')

  let capacidad_max: number | undefined
  const capacidad_raw = row['capacidad_max']
  if (capacidad_raw !== '' && capacidad_raw !== null && capacidad_raw !== undefined) {
    const n = Number(capacidad_raw)
    if (isNaN(n) || n < 1 || !Number.isInteger(n))
      errors.push('capacidad_max debe ser un número entero mayor a 0')
    else capacidad_max = n
  }

  const horario_inicio = normalizeTime(row['horario_inicio'])
  if (row['horario_inicio'] && String(row['horario_inicio']).trim() !== '' && horario_inicio === null)
    errors.push('horario_inicio inválido — use formato HH:MM (ej. 08:00) o celda tipo hora')

  const horario_fin = normalizeTime(row['horario_fin'])
  if (row['horario_fin'] && String(row['horario_fin']).trim() !== '' && horario_fin === null)
    errors.push('horario_fin inválido — use formato HH:MM (ej. 22:00) o celda tipo hora')

  const requiere_tarifa = normalizeBool(row['requiere_tarifa'])
  let tarifa_uso: number | undefined
  let tarifa_uso_finde: number | undefined
  if (requiere_tarifa) {
    const t = Number(row['tarifa_uso'])
    if (isNaN(t) || t < 0)
      errors.push('tarifa_uso debe ser un número ≥ 0 cuando requiere_tarifa es sí')
    else tarifa_uso = t
    const tf = row['tarifa_uso_finde']
    if (tf !== '' && tf !== null && tf !== undefined) {
      const tfn = Number(tf)
      if (isNaN(tfn) || tfn < 0) errors.push('tarifa_uso_finde debe ser un número ≥ 0')
      else tarifa_uso_finde = tfn
    }
  }

  const requiere_deposito = normalizeBool(row['requiere_deposito'])
  let monto_deposito: number | undefined
  if (requiere_deposito) {
    const md = Number(row['monto_deposito'])
    if (isNaN(md) || md < 0)
      errors.push('monto_deposito debe ser un número ≥ 0 cuando requiere_deposito es sí')
    else monto_deposito = md
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      nombre,
      descripcion:         String(row['descripcion'] ?? '').trim() || undefined,
      capacidad_max,
      horario_inicio:      horario_inicio ?? undefined,
      horario_fin:         horario_fin ?? undefined,
      requiere_deposito,
      monto_deposito,
      requiere_tarifa,
      tarifa_uso,
      tarifa_uso_finde,
      requiere_aprobacion: normalizeBool(row['requiere_aprobacion']),
      reglamento:          String(row['reglamento'] ?? '').trim() || undefined,
    },
  }
}

interface Props {
  proyectoId: string
  companyId: string
  onClose: () => void
  onImportado: () => void
}

export function ImportAmenidadesModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  return (
    <ImportModal<AmenidadImportRow>
      entityLabel="amenidad"
      entityLabelPlural="amenidades"
      sheetName="Amenidades"
      templateFilename="plantilla_amenidades"
      columns={COLUMNS}
      validateRow={validateRow}
      onInsertBatch={async (batch) => {
        const payload = batch.map(a => ({
          ...a,
          project_id: proyectoId,
          company_id: companyId,
          activo: true,
        }))
        const { error } = await supabase.from('amenidades').insert(payload)
        return error
          ? { ok: 0, error: error.message }
          : { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado()}
    />
  )
}

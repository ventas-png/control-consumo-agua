import type { TipoContactoEmergencia } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

const TIPOS_VALIDOS: TipoContactoEmergencia[] = [
  'bomberos', 'policia', 'ambulancia', 'hospital',
  'electricidad', 'agua', 'gas', 'administracion', 'general',
]

function normalizeBool(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === '') return false
  const str = String(raw).trim().toLowerCase()
  return str === 'sí' || str === 'si' || str === 'yes' || str === '1' || str === 'true' || str === 'x'
}

interface ContactoRow {
  nombre: string
  tipo: TipoContactoEmergencia
  telefono: string
  telefono_alternativo?: string
  descripcion?: string
  disponible_24h: boolean
  orden: number
}

const COLUMNS: ImportColumn[] = [
  { key: 'nombre',               width: 28, exampleValues: ['Policía Nacional Civil', 'Bomberos Voluntarios', 'Cruz Roja / Ambulancia', 'Hospital General', 'EEGSA Electricidad', 'EMPAGUA Agua', 'Administración'] },
  { key: 'tipo',                 width: 14, exampleValues: ['policia', 'bomberos', 'ambulancia', 'hospital', 'electricidad', 'agua', 'administracion'] },
  { key: 'telefono',             width: 16, exampleValues: ['110', '122', '125', '2329-0000', '1516', '1543', '+502 5555-0000'] },
  { key: 'telefono_alternativo', width: 18, exampleValues: ['', '123', '', '2329-0001', '', '', ''] },
  { key: 'descripcion',          width: 28, exampleValues: ['', 'Estación central', '', 'Urgencias 24h', 'Reporte de averías', '', 'Encargado: Juan Pérez'] },
  { key: 'disponible_24h',       width: 14, exampleValues: ['sí', 'sí', 'sí', 'sí', 'sí', 'no', 'no'] },
  { key: 'orden',                width:  8, exampleValues: [1, 2, 3, 4, 5, 6, 7] },
]

function validateRow(row: Record<string, unknown>): RowValidationResult<ContactoRow> {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  if (!nombre || nombre.length < 2)
    errors.push('nombre debe tener al menos 2 caracteres')

  const tipoRaw = String(row['tipo'] ?? '').trim().toLowerCase() as TipoContactoEmergencia
  if (!TIPOS_VALIDOS.includes(tipoRaw))
    errors.push(`tipo inválido: "${row['tipo']}" — use: ${TIPOS_VALIDOS.join(', ')}`)

  const telefono = String(row['telefono'] ?? '').trim()
  if (!telefono) errors.push('telefono es requerido')

  let orden = 0
  const ordenRaw = row['orden']
  if (ordenRaw !== '' && ordenRaw !== null && ordenRaw !== undefined) {
    const n = parseInt(String(ordenRaw))
    if (!isNaN(n) && n >= 0) orden = n
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      nombre,
      tipo: tipoRaw,
      telefono,
      telefono_alternativo: String(row['telefono_alternativo'] ?? '').trim() || undefined,
      descripcion:          String(row['descripcion'] ?? '').trim() || undefined,
      disponible_24h: normalizeBool(row['disponible_24h']),
      orden,
    },
  }
}

interface Props {
  proyectoId: string
  companyId: string
  onClose: () => void
  onImportado: () => void
}

export function ImportEmergenciasModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  return (
    <ImportModal<ContactoRow>
      entityLabel="contacto de emergencia"
      entityLabelPlural="contactos de emergencia"
      sheetName="Emergencias"
      templateFilename="plantilla_emergencias"
      columns={COLUMNS}
      validateRow={validateRow}
      onInsertBatch={async (batch) => {
        const payload = batch.map(c => ({
          ...c,
          project_id: proyectoId,
          company_id: companyId,
          activo: true,
        }))
        const { error } = await supabase.from('contactos_emergencia').insert(payload)
        return error
          ? { ok: 0, error: error.message }
          : { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado()}
    />
  )
}

import { useEffect, useState, useRef } from 'react'
import { notify } from '../shared/Dialog'
import type { Unidad, TipoUnidad, TipoRegimen, EstadoOcupacional, ContratoSuministro, UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

const TIPOS_UNIDAD_VALIDOS: TipoUnidad[] = [
  'apartamento', 'casa', 'bodega', 'local_comercial', 'oficina', 'parqueadero', 'otro',
]

const TIPOS_REGIMEN_VALIDOS: TipoRegimen[] = [
  'no_sujeto', 'urbanizacion', 'condominio', 'propiedad_horizontal', 'otro',
]

const ESTADOS_OCUPACIONALES_VALIDOS: EstadoOcupacional[] = [
  'en_construccion', 'habitado', 'en_remodelacion', 'desabitado', 'en_proceso_de_mudanza',
  'desocupada', 'disponible_venta', 'disponible_renta', 'en_mantenimiento',
  'problemas_legales', 'activo_extraordinario',
]

const CONTRATO_SUMINISTRO_VALIDOS: ContratoSuministro[] = ['si', 'no', 'na']

function normalizeDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null
    const y = raw.getFullYear()
    const m = String(raw.getMonth() + 1).padStart(2, '0')
    const d = String(raw.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

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

const COLUMNS: ImportColumn[] = [
  { key: 'nombre',                       width: 14, exampleValues: ['Apto 101', 'Casa 5'] },
  { key: 'tipo',                         width: 16, exampleValues: ['apartamento', 'casa'] },
  { key: 'descripcion',                  width: 26, exampleValues: ['Primer piso, vista al jardín', ''] },
  { key: 'piso',                         width:  6, exampleValues: [1, 0] },
  { key: 'area_m2',                      width: 10, exampleValues: [85.5, 120] },
  { key: 'propietario_nombre',           width: 20, exampleValues: ['Juan Pérez', 'María López'] },
  { key: 'propietario_telefono',         width: 18, exampleValues: ['88887777', ''] },
  { key: 'propietario_email',            width: 22, exampleValues: ['juan@email.com', ''] },
  { key: 'direccion',                    width: 22, exampleValues: ['Bloque A, Torre 1', 'Calle Principal #5'] },
  { key: 'datos_registrales',            width: 18, exampleValues: ['Finca 12345', ''] },
  { key: 'tipo_regimen',                 width: 22, exampleValues: ['propiedad_horizontal', 'urbanizacion'] },
  { key: 'fecha_construccion',           width: 16, exampleValues: ['2020-06-15', ''] },
  { key: 'estado_ocupacional',           width: 22, exampleValues: ['habitado', 'desocupada'] },
  { key: 'contrato_suministro',          width: 20, exampleValues: ['si', 'no'] },
  { key: 'fecha_firma_contrato',         width: 18, exampleValues: ['2023-01-01', ''] },
  { key: 'numero_contrato_suministro',   width: 26, exampleValues: ['CONT-001', ''] },
  { key: 'fecha_vencimiento_contrato',   width: 24, exampleValues: ['2025-12-31', ''] },
]

type UnidadRow = Partial<Unidad>

function validateRow(row: Record<string, unknown>): RowValidationResult<UnidadRow> {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  const tipo = String(row['tipo'] ?? '').trim().toLowerCase() as TipoUnidad

  if (!nombre || nombre.length < 1) errors.push('nombre es obligatorio')
  if (!TIPOS_UNIDAD_VALIDOS.includes(tipo))
    errors.push(`tipo inválido: "${row['tipo']}" — use: ${TIPOS_UNIDAD_VALIDOS.join(', ')}`)

  // Optional numeric fields
  const rawPiso = String(row['piso'] ?? '').trim()
  let piso: number | undefined
  if (rawPiso) {
    piso = parseInt(rawPiso)
    if (isNaN(piso)) errors.push('piso debe ser un número entero')
  }

  const rawArea = String(row['area_m2'] ?? '').trim()
  let area_m2: number | undefined
  if (rawArea) {
    area_m2 = parseFloat(rawArea)
    if (isNaN(area_m2) || area_m2 < 0) errors.push('area_m2 debe ser un número ≥ 0')
  }

  // Optional enums
  const rawRegimen = String(row['tipo_regimen'] ?? '').trim().toLowerCase() as TipoRegimen
  if (rawRegimen && !TIPOS_REGIMEN_VALIDOS.includes(rawRegimen))
    errors.push(`tipo_regimen inválido: "${row['tipo_regimen']}" — use: ${TIPOS_REGIMEN_VALIDOS.join(', ')}`)

  const rawEstado = String(row['estado_ocupacional'] ?? '').trim().toLowerCase() as EstadoOcupacional
  if (rawEstado && !ESTADOS_OCUPACIONALES_VALIDOS.includes(rawEstado))
    errors.push(`estado_ocupacional inválido: "${row['estado_ocupacional']}"`)

  const rawContrato = String(row['contrato_suministro'] ?? '').trim().toLowerCase() as ContratoSuministro
  if (rawContrato && !CONTRATO_SUMINISTRO_VALIDOS.includes(rawContrato))
    errors.push(`contrato_suministro inválido: "${row['contrato_suministro']}" — use: si, no, na`)

  // Optional dates
  const fecha_construccion = parseOptionalDate(row['fecha_construccion'], 'fecha_construccion', errors)
  const fecha_firma_contrato = parseOptionalDate(row['fecha_firma_contrato'], 'fecha_firma_contrato', errors)
  const fecha_vencimiento_contrato = parseOptionalDate(row['fecha_vencimiento_contrato'], 'fecha_vencimiento_contrato', errors)

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      nombre,
      tipo,
      descripcion:                String(row['descripcion'] ?? '').trim() || undefined,
      piso:                       piso ?? undefined,
      area_m2:                    area_m2 ?? undefined,
      propietario_nombre:         sanitizeInput(String(row['propietario_nombre'] ?? '').trim()) || undefined,
      propietario_telefono:       String(row['propietario_telefono'] ?? '').trim() || undefined,
      propietario_email:          String(row['propietario_email'] ?? '').trim() || undefined,
      direccion:                  sanitizeInput(String(row['direccion'] ?? '').trim()) || undefined,
      datos_registrales:          sanitizeInput(String(row['datos_registrales'] ?? '').trim()) || undefined,
      tipo_regimen:               rawRegimen && TIPOS_REGIMEN_VALIDOS.includes(rawRegimen) ? rawRegimen : undefined,
      fecha_construccion,
      estado_ocupacional:         rawEstado && ESTADOS_OCUPACIONALES_VALIDOS.includes(rawEstado) ? rawEstado : undefined,
      contrato_suministro:        rawContrato && CONTRATO_SUMINISTRO_VALIDOS.includes(rawContrato) ? rawContrato : undefined,
      fecha_firma_contrato,
      numero_contrato_suministro: String(row['numero_contrato_suministro'] ?? '').trim() || undefined,
      fecha_vencimiento_contrato,
      activo: true,
    },
  }
}

interface Props {
  currentUser: UserSession
  onClose: () => void
  onImportado: (unidades: Unidad[]) => void
}

export function ImportUnidadesModal({ currentUser, onClose, onImportado }: Props) {
  const [ids, setIds] = useState<{ projectId: string; companyId: string } | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const insertedRef = useRef<Unidad[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: userData } = await supabase
        .from('app_users')
        .select('project_id, company_id')
        .eq('id', currentUser.user_id)
        .single()
      let projectId: string | null = (userData as { project_id?: string } | null)?.project_id ?? null
      let companyId: string | null =
        (userData as { company_id?: string } | null)?.company_id ?? currentUser.company_id ?? null

      if (!projectId) {
        const { data: assignment } = await supabase
          .from('user_project_assignments')
          .select('project_id')
          .eq('user_id', currentUser.user_id)
          .limit(1)
          .single()
        if (assignment) projectId = (assignment as { project_id: string }).project_id
      }
      if (!projectId && companyId) {
        const { data: proj } = await supabase
          .from('projects')
          .select('id')
          .eq('company_id', companyId)
          .limit(1)
          .single()
        if (proj) projectId = (proj as { id: string }).id
      }

      if (cancelled) return
      if (!projectId || !companyId) {
        setResolveError('No se pudo determinar el proyecto o empresa. Contacte al administrador.')
      } else {
        setIds({ projectId, companyId })
      }
    })()
    return () => { cancelled = true }
  }, [currentUser.user_id, currentUser.company_id])

  if (resolveError) {
    notify({ variant: 'error', title: 'Error', text: resolveError })
    onClose()
    return null
  }
  if (!ids) return null

  return (
    <ImportModal<UnidadRow>
      entityLabel="unidad"
      entityLabelPlural="unidades"
      sheetName="Unidades"
      templateFilename="plantilla_unidades"
      columns={COLUMNS}
      validateRow={validateRow}
      onInsertBatch={async (batch) => {
        const payload = batch.map(u => ({
          ...u,
          project_id: ids.projectId,
          company_id: ids.companyId,
          activo: true,
        }))
        const { data, error } = await supabase.from('unidades').insert(payload).select()
        if (error) return { ok: 0, error: error.message }
        if (data) insertedRef.current.push(...(data as Unidad[]))
        return { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado(insertedRef.current)}
    />
  )
}

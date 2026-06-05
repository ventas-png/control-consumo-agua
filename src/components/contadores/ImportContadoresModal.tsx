import { useEffect, useState, useRef } from 'react'
import { notify } from '../shared/Dialog'
import type { Contador, TipoAgua, UserSession } from '../../types'
import { fetchUnidadesByCompany, resolveDefaultProjectCompany } from '../../domain/contadores/queries'
import { validatedInsertMany } from '../../lib/validatedInsert'
import { contadorInputSchema } from '../../domain/agua/schemas'
import { sanitizeInput } from '../../lib/validation'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

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

const TIPOS_AGUA_VALIDOS: TipoAgua[] = [
  'potable', 'rehuso', 'piscina', 'desalinada', 'riego',
  'jacuzzi', 'consumo_humano', 'desmineralizada', 'residuales_tratadas',
]

const COLUMNS: ImportColumn[] = [
  { key: 'numero_serie',                width: 14, exampleValues: ['MED-001', 'MED-002'] },
  { key: 'unidad',                      width: 20, exampleValues: ['Apto. 1AB', ''] },
  { key: 'tipo_agua',                   width: 20, exampleValues: ['potable', 'riego'] },
  { key: 'lectura_inicial',             width: 16, exampleValues: [0, 0] },
  { key: 'descripcion',                 width: 22, exampleValues: ['Medidor zona A', 'Medidor riego sur'] },
  { key: 'marca',                       width: 12, exampleValues: ['Sensus', ''] },
  { key: 'modelo',                      width: 10, exampleValues: ['620', ''] },
  { key: 'fecha_instalacion',           width: 16, exampleValues: ['2024-01-15', ''] },
  { key: 'medida',                      width: 10, exampleValues: ['1/2"', '3/4"'] },
  { key: 'material',                    width: 12, exampleValues: ['Latón', ''] },
  { key: 'tipo_contador',               width: 24, exampleValues: ['Analógico volumétrico', ''] },
  { key: 'valvula_cheque',              width: 14, exampleValues: ['Sí', ''] },
  { key: 'tipo_llave',                  width: 12, exampleValues: ['Bola', ''] },
  { key: 'periodicidad_lectura_dias',   width: 24, exampleValues: [30, ''] },
  { key: 'contratista_instalador',      width: 26, exampleValues: ['Instalaciones Pérez S.A.', ''] },
  { key: 'garantia_instalacion_vence',  width: 26, exampleValues: ['2027-01-15', ''] },
]

// `_unidad_nombre` es transitorio: lo captura validateRow y onInsertBatch lo
// resuelve a unidad_id (no es columna de la tabla, se elimina antes del insert).
type ContadorRow = Partial<Contador> & { _unidad_nombre?: string }

function validateRow(row: Record<string, unknown>): RowValidationResult<ContadorRow> {
  const errors: string[] = []

  const numero_serie = sanitizeInput(String(row['numero_serie'] ?? '').trim())
  const tipo_agua = String(row['tipo_agua'] ?? '').trim().toLowerCase() as TipoAgua
  const lectura_inicial = Number(row['lectura_inicial'])

  if (!numero_serie || numero_serie.length < 2)
    errors.push('numero_serie debe tener al menos 2 caracteres')
  if (!TIPOS_AGUA_VALIDOS.includes(tipo_agua))
    errors.push(`tipo_agua inválido: "${row['tipo_agua']}" — use: ${TIPOS_AGUA_VALIDOS.join(', ')}`)
  if (isNaN(lectura_inicial) || lectura_inicial < 0)
    errors.push('lectura_inicial debe ser un número ≥ 0')

  const fecha_instalacion = normalizeDate(row['fecha_instalacion'])
  if (row['fecha_instalacion'] && String(row['fecha_instalacion']).trim() !== '' && fecha_instalacion === null)
    errors.push(`fecha_instalacion inválida — use YYYY-MM-DD o celda tipo fecha`)

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: {
      numero_serie,
      _unidad_nombre:             String(row['unidad'] ?? '').trim() || undefined,
      tipo_agua,
      lectura_inicial,
      descripcion:                String(row['descripcion'] ?? '').trim() || undefined,
      marca:                      String(row['marca'] ?? '').trim() || undefined,
      modelo:                     String(row['modelo'] ?? '').trim() || undefined,
      fecha_instalacion:          fecha_instalacion ?? undefined,
      medida:                     String(row['medida'] ?? '').trim() || undefined,
      material:                   String(row['material'] ?? '').trim() || undefined,
      tipo_contador:              String(row['tipo_contador'] ?? '').trim() || undefined,
      valvula_cheque:             String(row['valvula_cheque'] ?? '').trim() || undefined,
      tipo_llave:                 String(row['tipo_llave'] ?? '').trim() || undefined,
      periodicidad_lectura_dias:  row['periodicidad_lectura_dias']
        ? parseInt(String(row['periodicidad_lectura_dias'])) || undefined
        : undefined,
      contratista_instalador:     String(row['contratista_instalador'] ?? '').trim() || undefined,
      garantia_instalacion_vence: normalizeDate(row['garantia_instalacion_vence']) ?? undefined,
      activo: true,
    },
  }
}

interface Props {
  currentUser: UserSession
  onClose: () => void
  onImportado: (contadores: Contador[]) => void
}

export function ImportContadoresModal({ currentUser, onClose, onImportado }: Props) {
  // Resolvemos projectId/companyId al montar — antes solo se hacía al click
  // "Importar" pero ahora el framework necesita la closure desde el inicio.
  const [ids, setIds] = useState<{ projectId: string; companyId: string } | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const insertedRef = useRef<Contador[]>([])
  // Mapa nombre_unidad (minúsculas) → unidad, cacheado para no re-consultar por lote.
  const unidadMapRef = useRef<Map<string, { id: string; project_id: string; company_id: string }> | null>(null)

  async function getUnidadMap() {
    if (unidadMapRef.current) return unidadMapRef.current
    const map = new Map<string, { id: string; project_id: string; company_id: string }>()
    if (ids) {
      const rows = await fetchUnidadesByCompany(ids.companyId)
      for (const u of rows) {
        if (u.nombre) map.set(u.nombre.trim().toLowerCase(), { id: u.id, project_id: u.project_id, company_id: u.company_id })
      }
    }
    unidadMapRef.current = map
    return map
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { projectId, companyId } = await resolveDefaultProjectCompany(
        currentUser.user_id,
        currentUser.company_id ?? null,
      )

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
    // Mostramos el error y cerramos el modal.
    notify({ variant: 'error', title: 'Error', text: resolveError })
    onClose()
    return null
  }
  if (!ids) return null  // brevísimo loading state; el modal se monta cuando ids está listo

  return (
    <ImportModal<ContadorRow>
      entityLabel="contador"
      entityLabelPlural="contadores"
      sheetName="Contadores"
      templateFilename="plantilla_contadores"
      columns={COLUMNS}
      validateRow={validateRow}
      onInsertBatch={async (batch) => {
        const unidadMap = await getUnidadMap()
        const payload = batch.map(({ _unidad_nombre, ...rest }) => {
          // Si la fila trae unidad y coincide con una de la empresa, el contador
          // hereda su proyecto/empresa (el trigger en BD garantiza el invariante).
          // Si no coincide o no viene, queda en el proyecto del usuario importador.
          const u = _unidad_nombre ? unidadMap.get(_unidad_nombre.toLowerCase()) : undefined
          return {
            ...rest,
            project_id: u?.project_id ?? ids.projectId,
            company_id: u?.company_id ?? ids.companyId,
            unidad_id: u?.id,
            activo: true,
          }
        })
        // agua:C6 — batch insert con pre-validación Zod por fila.
        // `.passthrough()` preserva los campos físicos del medidor que no
        // están en el schema input (medida, material, válvulas, etc.).
        const { data, error } = await validatedInsertMany(
          'contadores',
          contadorInputSchema.passthrough(),
          payload,
          { returning: true },
        )
        if (error) return { ok: 0, error: error.message }
        if (data) insertedRef.current.push(...(data as unknown as Contador[]))
        return { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado(insertedRef.current)}
    />
  )
}

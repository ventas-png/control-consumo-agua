import { useState, useRef, type CSSProperties, type ChangeEvent, type DragEvent} from 'react'
import * as XLSX from 'xlsx'
import Swal from 'sweetalert2'
import type { Contador, TipoAgua, UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'

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
  if (parts) {
    return `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}`
  }

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

interface ParsedRow {
  index: number
  data: Partial<Contador>
  errors: string[]
  valid: boolean
}

interface Props {
  currentUser: UserSession
  onClose: () => void
  onImportado: (contadores: Contador[]) => void
}

function validateRow(row: Record<string, unknown>, index: number): ParsedRow {
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

  const data: Partial<Contador> = {
    numero_serie,
    tipo_agua,
    lectura_inicial,
    descripcion: String(row['descripcion'] ?? '').trim() || undefined,
    marca: String(row['marca'] ?? '').trim() || undefined,
    modelo: String(row['modelo'] ?? '').trim() || undefined,
    fecha_instalacion: fecha_instalacion ?? undefined,
    medida: String(row['medida'] ?? '').trim() || undefined,
    material: String(row['material'] ?? '').trim() || undefined,
    tipo_contador: String(row['tipo_contador'] ?? '').trim() || undefined,
    valvula_cheque: String(row['valvula_cheque'] ?? '').trim() || undefined,
    tipo_llave: String(row['tipo_llave'] ?? '').trim() || undefined,
    periodicidad_lectura_dias: row['periodicidad_lectura_dias']
      ? parseInt(String(row['periodicidad_lectura_dias'])) || undefined
      : undefined,
    contratista_instalador: String(row['contratista_instalador'] ?? '').trim() || undefined,
    garantia_instalacion_vence: normalizeDate(row['garantia_instalacion_vence']) ?? undefined,
    activo: true,
  }

  return { index, data, errors, valid: errors.length === 0 }
}

export function ImportContadoresModal({ currentUser, onClose, onImportado }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importados, setImportados] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function descargarPlantilla() {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      [
        'numero_serie', 'tipo_agua', 'lectura_inicial', 'descripcion', 'marca', 'modelo',
        'fecha_instalacion', 'medida', 'material', 'tipo_contador', 'valvula_cheque',
        'tipo_llave', 'periodicidad_lectura_dias', 'contratista_instalador', 'garantia_instalacion_vence',
      ],
      [
        'MED-001', 'potable', 0, 'Medidor zona A', 'Sensus', '620',
        '2024-01-15', '1/2"', 'Latón', 'Analógico volumétrico', 'Sí',
        'Bola', 30, 'Instalaciones Pérez S.A.', '2027-01-15',
      ],
      [
        'MED-002', 'riego', 0, 'Medidor riego sur', '', '',
        '', '3/4"', '', '', '',
        '', '', '', '',
      ],
    ])
    // Column widths
    ws['!cols'] = [
      { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 10 },
      { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 24 }, { wch: 14 },
      { wch: 12 }, { wch: 24 }, { wch: 26 }, { wch: 26 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, 'Contadores')
    XLSX.writeFile(wb, 'plantilla_contadores.xlsx')
  }

  function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      Swal.fire('Formato inválido', 'Solo se aceptan archivos .xlsx, .xls o .csv', 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target!.result as ArrayBuffer, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        if (raw.length === 0) {
          Swal.fire('Archivo vacío', 'El archivo no contiene filas de datos.', 'warning')
          return
        }
        const parsed = raw.map((row, i) => validateRow(row, i + 2))
        setRows(parsed)
        setStep('preview')
      } catch {
        Swal.fire('Error', 'No se pudo leer el archivo. Verifique que sea un Excel válido.', 'error')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function resolveProjectAndCompany(): Promise<{ projectId: string; companyId: string } | null> {
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

    if (!projectId || !companyId) return null
    return { projectId, companyId }
  }

  async function handleImportar() {
    setStep('importing')

    const ids = await resolveProjectAndCompany()
    if (!ids) {
      Swal.fire('Error', 'No se pudo determinar el proyecto o empresa. Contacte al administrador.', 'error')
      setStep('preview')
      return
    }

    const { projectId, companyId } = ids
    const validRows = rows.filter(r => r.valid)
    const BATCH_SIZE = 100
    const insertados: Contador[] = []

    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const lote = validRows.slice(i, i + BATCH_SIZE).map(r => ({
        ...r.data,
        project_id: projectId,
        company_id: companyId,
        activo: true,
      }))
      const { data, error } = await supabase.from('contadores').insert(lote).select()
      if (!error && data) {
        insertados.push(...(data as Contador[]))
      } else {
        Swal.fire('Error en inserción', error?.message ?? 'Error al guardar lote de contadores.', 'error')
        setStep('preview')
        return
      }
    }

    onImportado(insertados)
    setImportados(insertados.length)
    setStep('done')
  }

  const validCount = rows.filter(r => r.valid).length
  const invalidCount = rows.filter(r => !r.valid).length

  // ── Styles ──────────────────────────────────────────────────────────────────
  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '16px',
  }
  const modalStyle: CSSProperties = {
    background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '780px',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  }
  const headerStyle: CSSProperties = {
    padding: '24px 28px 20px', borderBottom: '1px solid #e2e8f0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }
  const bodyStyle: CSSProperties = {
    padding: '24px 28px', overflowY: 'auto', flex: 1,
  }
  const footerStyle: CSSProperties = {
    padding: '16px 28px', borderTop: '1px solid #e2e8f0',
    display: 'flex', justifyContent: 'flex-end', gap: '10px',
  }
  const btnPrimary: CSSProperties = {
    padding: '10px 22px', background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
    color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }
  const btnSecondary: CSSProperties = {
    padding: '10px 22px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
              Importar contadores desde Excel
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              {step === 'upload' && 'Descarga la plantilla, complétala y sube el archivo.'}
              {step === 'preview' && `${rows.length} fila${rows.length !== 1 ? 's' : ''} encontrada${rows.length !== 1 ? 's' : ''} — ${validCount} válida${validCount !== 1 ? 's' : ''}, ${invalidCount} con error${invalidCount !== 1 ? 'es' : ''}`}
              {step === 'importing' && 'Guardando contadores en la base de datos...'}
              {step === 'done' && `${importados} contador${importados !== 1 ? 'es' : ''} importado${importados !== 1 ? 's' : ''} exitosamente.`}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '22px', lineHeight: 1, padding: '4px' }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {/* Step: upload */}
          {step === 'upload' && (
            <div>
              {/* Download template */}
              <div style={{ marginBottom: '24px', padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#0369a1', fontSize: '14px' }}>Paso 1 — Descarga la plantilla</div>
                  <div style={{ fontSize: '13px', color: '#0ea5e9', marginTop: '2px' }}>
                    Incluye encabezados y 2 filas de ejemplo con los valores aceptados.
                  </div>
                </div>
                <button onClick={descargarPlantilla} style={{ ...btnPrimary, background: '#0ea5e9', whiteSpace: 'nowrap' }}>
                  ⬇ plantilla_contadores.xlsx
                </button>
              </div>

              {/* Tipos de agua reference */}
              <div style={{ marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Valores válidos para la columna <code>tipo_agua</code>:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {TIPOS_AGUA_VALIDOS.map(t => (
                    <span key={t} style={{ fontSize: '12px', background: '#e2e8f0', color: '#334155', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>{t}</span>
                  ))}
                </div>
              </div>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? '#0ea5e9' : '#cbd5e1'}`,
                  borderRadius: '12px',
                  padding: '48px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragOver ? '#f0f9ff' : '#fafafa',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>📂</div>
                <div style={{ fontWeight: 600, color: '#334155', fontSize: '15px', marginBottom: '6px' }}>
                  Paso 2 — Arrastra tu archivo aquí o haz clic para seleccionar
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>Formatos aceptados: .xlsx, .xls, .csv</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
              </div>
            </div>
          )}

          {/* Step: preview */}
          {step === 'preview' && (
            <div>
              {/* Summary badges */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <span style={{ padding: '6px 14px', background: '#dcfce7', color: '#166534', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                  ✅ {validCount} válida{validCount !== 1 ? 's' : ''}
                </span>
                {invalidCount > 0 && (
                  <span style={{ padding: '6px 14px', background: '#fee2e2', color: '#991b1b', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                    ❌ {invalidCount} con error{invalidCount !== 1 ? 'es' : ''}
                  </span>
                )}
                <span style={{ padding: '6px 14px', background: '#f1f5f9', color: '#475569', borderRadius: '20px', fontSize: '13px' }}>
                  {rows.length} fila{rows.length !== 1 ? 's' : ''} en total
                </span>
              </div>

              {/* Preview table */}
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Fila', 'N° Serie', 'Tipo', 'Lectura inicial', 'Marca', 'Estado'].map(h => (
                        <th scope="col" key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr
                        key={row.index}
                        style={{ background: row.valid ? '#f0fdf4' : '#fff1f2', borderBottom: '1px solid #e2e8f0' }}
                      >
                        <td style={{ padding: '9px 14px', color: '#94a3b8', fontWeight: 500 }}>{row.index}</td>
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>{String(row.data.numero_serie ?? '—')}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>{String(row.data.tipo_agua ?? '—')}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>{row.data.lectura_inicial ?? '—'}</td>
                        <td style={{ padding: '9px 14px', color: '#64748b' }}>{String(row.data.marca ?? '—')}</td>
                        <td style={{ padding: '9px 14px' }}>
                          {row.valid
                            ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✅ OK</span>
                            : (
                              <span title={row.errors.join('\n')} style={{ color: '#dc2626', cursor: 'help' }}>
                                ❌ {row.errors[0]}{row.errors.length > 1 ? ` (+${row.errors.length - 1})` : ''}
                              </span>
                            )
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {invalidCount > 0 && (
                <p style={{ marginTop: '12px', fontSize: '13px', color: '#92400e', background: '#fffbeb', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fde68a' }}>
                  ⚠️ Las filas con errores serán ignoradas. Solo se importarán las {validCount} filas válidas.
                </p>
              )}
            </div>
          )}

          {/* Step: importing */}
          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏳</div>
              <div style={{ fontWeight: 600, color: '#334155', fontSize: '16px' }}>Importando contadores...</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>Por favor espera, no cierres esta ventana.</div>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
              <div style={{ fontWeight: 700, color: '#166534', fontSize: '20px' }}>
                {importados} contador{importados !== 1 ? 'es' : ''} importado{importados !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
                Los contadores ya aparecen en la lista.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          {step === 'upload' && (
            <button onClick={onClose} style={btnSecondary}>Cancelar</button>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('upload'); setRows([]) }} style={btnSecondary}>← Volver</button>
              <button
                onClick={handleImportar}
                disabled={validCount === 0}
                style={{ ...btnPrimary, opacity: validCount === 0 ? 0.5 : 1, cursor: validCount === 0 ? 'not-allowed' : 'pointer' }}
              >
                Importar {validCount} contador{validCount !== 1 ? 'es' : ''}
              </button>
            </>
          )}
          {step === 'done' && (
            <button onClick={onClose} style={btnPrimary}>Cerrar</button>
          )}
        </div>
      </div>
    </div>
  )
}

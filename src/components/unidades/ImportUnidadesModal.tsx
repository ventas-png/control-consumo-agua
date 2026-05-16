import { useState, useRef, type CSSProperties, type ChangeEvent, type DragEvent} from 'react'
import Swal from 'sweetalert2'
import type { Unidad, TipoUnidad, TipoRegimen, EstadoOcupacional, ContratoSuministro, UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { parseXlsxToObjects, writeXlsx } from '../../lib/xlsx'

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

interface ParsedRow {
  index: number
  data: Partial<Unidad>
  errors: string[]
  valid: boolean
}

interface Props {
  currentUser: UserSession
  onClose: () => void
  onImportado: (unidades: Unidad[]) => void
}

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

function parseOptionalDate(raw: unknown, fieldName: string, errors: string[]): string | undefined {
  if (raw === null || raw === undefined || String(raw).trim() === '') return undefined
  const normalized = normalizeDate(raw)
  if (normalized === null) {
    errors.push(`${fieldName} inválido: "${raw}" — use YYYY-MM-DD o celda tipo fecha`)
    return undefined
  }
  return normalized
}

function validateRow(row: Record<string, unknown>, index: number): ParsedRow {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  const tipo = String(row['tipo'] ?? '').trim().toLowerCase() as TipoUnidad

  if (!nombre || nombre.length < 1)
    errors.push('nombre es obligatorio')
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

  const data: Partial<Unidad> = {
    nombre,
    tipo,
    descripcion: String(row['descripcion'] ?? '').trim() || undefined,
    piso: piso ?? undefined,
    area_m2: area_m2 ?? undefined,
    propietario_nombre: sanitizeInput(String(row['propietario_nombre'] ?? '').trim()) || undefined,
    propietario_telefono: String(row['propietario_telefono'] ?? '').trim() || undefined,
    propietario_email: String(row['propietario_email'] ?? '').trim() || undefined,
    direccion: sanitizeInput(String(row['direccion'] ?? '').trim()) || undefined,
    datos_registrales: sanitizeInput(String(row['datos_registrales'] ?? '').trim()) || undefined,
    tipo_regimen: rawRegimen && TIPOS_REGIMEN_VALIDOS.includes(rawRegimen) ? rawRegimen : undefined,
    fecha_construccion,
    estado_ocupacional: rawEstado && ESTADOS_OCUPACIONALES_VALIDOS.includes(rawEstado) ? rawEstado : undefined,
    contrato_suministro: rawContrato && CONTRATO_SUMINISTRO_VALIDOS.includes(rawContrato) ? rawContrato : undefined,
    fecha_firma_contrato,
    numero_contrato_suministro: String(row['numero_contrato_suministro'] ?? '').trim() || undefined,
    fecha_vencimiento_contrato,
    activo: true,
  }

  return { index, data, errors, valid: errors.length === 0 }
}

export function ImportUnidadesModal({ currentUser, onClose, onImportado }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importados, setImportados] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function descargarPlantilla() {
    void writeXlsx('plantilla_unidades', [{
      name: 'Unidades',
      rows: [
        [
          'nombre', 'tipo', 'descripcion', 'piso', 'area_m2',
          'propietario_nombre', 'propietario_telefono', 'propietario_email',
          'direccion', 'datos_registrales', 'tipo_regimen', 'fecha_construccion',
          'estado_ocupacional', 'contrato_suministro', 'fecha_firma_contrato',
          'numero_contrato_suministro', 'fecha_vencimiento_contrato',
        ],
        [
          'Apto 101', 'apartamento', 'Primer piso, vista al jardín', 1, 85.5,
          'Juan Pérez', '88887777', 'juan@email.com',
          'Bloque A, Torre 1', 'Finca 12345', 'propiedad_horizontal', '2020-06-15',
          'habitado', 'si', '2023-01-01',
          'CONT-001', '2025-12-31',
        ],
        [
          'Casa 5', 'casa', '', 0, 120,
          'María López', '', '',
          'Calle Principal #5', '', 'urbanizacion', '',
          'desocupada', 'no', '',
          '', '',
        ],
      ],
      colWidths: [14, 16, 26, 6, 10, 20, 18, 22, 22, 18, 22, 16, 22, 20, 18, 26, 24],
    }]).catch(err => Swal.fire('Error', err.message ?? 'No se pudo generar la plantilla', 'error'))
  }

  function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      Swal.fire('Formato inválido', 'Solo se aceptan archivos .xlsx, .xls o .csv', 'error')
      return
    }
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const raw = await parseXlsxToObjects<Record<string, string | number | boolean>>(e.target!.result as ArrayBuffer)
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
    const insertados: Unidad[] = []

    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const lote = validRows.slice(i, i + BATCH_SIZE).map(r => ({
        ...r.data,
        project_id: projectId,
        company_id: companyId,
        activo: true,
      }))
      const { data, error } = await supabase.from('unidades').insert(lote).select()
      if (!error && data) {
        insertados.push(...(data as Unidad[]))
      } else {
        Swal.fire('Error en inserción', error?.message ?? 'Error al guardar lote de unidades.', 'error')
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
    background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '860px',
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
              Importar unidades desde Excel
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              {step === 'upload' && 'Descarga la plantilla, complétala y sube el archivo.'}
              {step === 'preview' && `${rows.length} fila${rows.length !== 1 ? 's' : ''} encontrada${rows.length !== 1 ? 's' : ''} — ${validCount} válida${validCount !== 1 ? 's' : ''}, ${invalidCount} con error${invalidCount !== 1 ? 'es' : ''}`}
              {step === 'importing' && 'Guardando unidades en la base de datos...'}
              {step === 'done' && `${importados} unidad${importados !== 1 ? 'es' : ''} importada${importados !== 1 ? 's' : ''} exitosamente.`}
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
                  ⬇ plantilla_unidades.xlsx
                </button>
              </div>

              {/* Valid values reference */}
              <div style={{ marginBottom: '12px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Valores válidos para <code>tipo</code> (obligatorio):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {TIPOS_UNIDAD_VALIDOS.map(t => (
                    <span key={t} style={{ fontSize: '12px', background: '#e2e8f0', color: '#334155', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>{t}</span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '12px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Valores válidos para <code>tipo_regimen</code> (opcional):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {TIPOS_REGIMEN_VALIDOS.map(t => (
                    <span key={t} style={{ fontSize: '12px', background: '#e2e8f0', color: '#334155', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>{t}</span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Valores válidos para <code>contrato_suministro</code> (opcional):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {CONTRATO_SUMINISTRO_VALIDOS.map(t => (
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
                      {['Fila', 'Nombre', 'Tipo', 'Piso', 'Área m²', 'Propietario', 'Estado'].map(h => (
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
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>{String(row.data.nombre ?? '—')}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>{String(row.data.tipo ?? '—')}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>{row.data.piso ?? '—'}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>{row.data.area_m2 ?? '—'}</td>
                        <td style={{ padding: '9px 14px', color: '#64748b' }}>{String(row.data.propietario_nombre ?? '—')}</td>
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
              <div style={{ fontWeight: 600, color: '#334155', fontSize: '16px' }}>Importando unidades...</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>Por favor espera, no cierres esta ventana.</div>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
              <div style={{ fontWeight: 700, color: '#166534', fontSize: '20px' }}>
                {importados} unidad{importados !== 1 ? 'es' : ''} importada{importados !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
                Las unidades ya aparecen en la lista.
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
                Importar {validCount} unidad{validCount !== 1 ? 'es' : ''}
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

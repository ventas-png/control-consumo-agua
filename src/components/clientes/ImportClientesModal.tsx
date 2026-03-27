import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import Swal from 'sweetalert2'
import type { Cliente } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, validateEmail, validatePhoneNumber } from '../../lib/validation'

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

interface ParsedRow {
  index: number
  rawData: Record<string, string>
  data: Partial<Cliente>
  errors: string[]
  valid: boolean
  duplicateReason?: string
}

interface AnalyzedResult {
  yaExisten: ParsedRow[]
  nuevos: ParsedRow[]
  conErrores: ParsedRow[]
}

interface Props {
  existingClientes: Cliente[]
  userId: string
  companyId?: string
  onClose: () => void
  onImportado: (clientes: Cliente[]) => void
}

function validateRow(row: Record<string, unknown>, index: number): ParsedRow {
  const errors: string[] = []

  const rawData: Record<string, string> = {}
  for (const key of Object.keys(row)) {
    rawData[key] = String(row[key] ?? '')
  }

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  const codigo = sanitizeInput(String(row['codigo'] ?? '').trim())
  const email = sanitizeInput(String(row['email'] ?? '').trim())
  const telefono = sanitizeInput(String(row['telefono'] ?? '').trim())
  const whatsapp = sanitizeInput(String(row['whatsapp'] ?? '').trim())
  const telefono_alterno = sanitizeInput(String(row['telefono_alterno'] ?? '').trim())
  const fecha_nacimiento = normalizeDate(row['fecha_nacimiento'])

  if (!nombre || nombre.length < 2)
    errors.push('nombre debe tener al menos 2 caracteres')
  if (!codigo || codigo.length < 3)
    errors.push('codigo debe tener al menos 3 caracteres')
  if (email && !validateEmail(email))
    errors.push(`email inválido: "${email}"`)
  if (telefono && !validatePhoneNumber(telefono))
    errors.push('telefono debe tener 8 dígitos')
  if (whatsapp && !validatePhoneNumber(whatsapp))
    errors.push('whatsapp debe tener 8 dígitos')
  if (telefono_alterno && !validatePhoneNumber(telefono_alterno))
    errors.push('telefono_alterno debe tener 8 dígitos')
  if (row['fecha_nacimiento'] && String(row['fecha_nacimiento']).trim() !== '' && fecha_nacimiento === null)
    errors.push(`fecha_nacimiento inválida: "${row['fecha_nacimiento']}" — use YYYY-MM-DD o celda tipo fecha`)

  const data: Partial<Cliente> = {
    nombre,
    codigo,
    email: email || undefined,
    direccion: sanitizeInput(String(row['direccion'] ?? '').trim()) || undefined,
    telefono: telefono || undefined,
    whatsapp: whatsapp || null,
    nacionalidad: sanitizeInput(String(row['nacionalidad'] ?? '').trim()) || null,
    cui_dui: sanitizeInput(String(row['cui_dui'] ?? '').trim()) || null,
    fecha_nacimiento: fecha_nacimiento,
    numero_facturacion: sanitizeInput(String(row['numero_facturacion'] ?? '').trim()) || null,
    telefono_alterno: telefono_alterno || null,
    puede_crear_cuenta: false,
  }

  return { index, rawData, data, errors, valid: errors.length === 0 }
}

function analyzeRows(parsedRows: ParsedRow[], existingClientes: Cliente[]): AnalyzedResult {
  const existingCodigos = new Set(existingClientes.map(c => c.codigo.toLowerCase()))
  const existingCuiDuis = new Set(
    existingClientes.filter(c => c.cui_dui).map(c => c.cui_dui!.toLowerCase())
  )

  const yaExisten: ParsedRow[] = []
  const nuevos: ParsedRow[] = []
  const conErrores: ParsedRow[] = []

  for (const row of parsedRows) {
    if (!row.valid) {
      conErrores.push(row)
      continue
    }
    const codigoMatch = existingCodigos.has(row.data.codigo!.toLowerCase())
    const cuiMatch = row.data.cui_dui
      ? existingCuiDuis.has(row.data.cui_dui.toLowerCase())
      : false

    if (codigoMatch || cuiMatch) {
      const reasons: string[] = []
      if (codigoMatch) reasons.push(`código "${row.data.codigo}" ya existe`)
      if (cuiMatch) reasons.push(`CUI/DUI "${row.data.cui_dui}" ya existe`)
      yaExisten.push({ ...row, duplicateReason: reasons.join(', ') })
    } else {
      nuevos.push(row)
    }
  }

  return { yaExisten, nuevos, conErrores }
}

export function ImportClientesModal({ existingClientes, userId, companyId, onClose, onImportado }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [analyzed, setAnalyzed] = useState<AnalyzedResult>({ yaExisten: [], nuevos: [], conErrores: [] })
  const [activeTab, setActiveTab] = useState<'nuevos' | 'yaExisten' | 'conErrores'>('nuevos')
  const [importados, setImportados] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function descargarPlantilla() {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      [
        'nombre', 'codigo', 'email', 'telefono', 'whatsapp', 'direccion',
        'nacionalidad', 'cui_dui', 'fecha_nacimiento', 'numero_facturacion', 'telefono_alterno',
      ],
      [
        'María López', 'CLI-001', 'maria@email.com', '22223333', '22223333', 'Av. Principal 123',
        'Guatemalteca', '1234567890101', '1985-06-15', 'FAC-001', '',
      ],
      [
        'Juan Pérez', 'CLI-002', 'juan@email.com', '44445555', '', 'Calle 5 Norte',
        '', '', '', '', '',
      ],
    ])
    ws['!cols'] = [
      { wch: 22 }, { wch: 12 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 26 },
      { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
    XLSX.writeFile(wb, 'plantilla_clientes.xlsx')
  }

  function descargarErrores() {
    if (analyzed.conErrores.length === 0) return
    const wb = XLSX.utils.book_new()
    const headers = [
      'nombre', 'codigo', 'email', 'telefono', 'whatsapp', 'direccion',
      'nacionalidad', 'cui_dui', 'fecha_nacimiento', 'numero_facturacion', 'telefono_alterno',
      'motivo_error',
    ]
    const dataRows = analyzed.conErrores.map(r => [
      r.rawData['nombre'] ?? '',
      r.rawData['codigo'] ?? '',
      r.rawData['email'] ?? '',
      r.rawData['telefono'] ?? '',
      r.rawData['whatsapp'] ?? '',
      r.rawData['direccion'] ?? '',
      r.rawData['nacionalidad'] ?? '',
      r.rawData['cui_dui'] ?? '',
      r.rawData['fecha_nacimiento'] ?? '',
      r.rawData['numero_facturacion'] ?? '',
      r.rawData['telefono_alterno'] ?? '',
      r.errors.join('; '),
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
    ws['!cols'] = [
      { wch: 22 }, { wch: 12 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 26 },
      { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 50 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, 'Errores')
    XLSX.writeFile(wb, 'clientes_con_errores.xlsx')
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
        const result = analyzeRows(parsed, existingClientes)
        setAnalyzed(result)
        // Default to most relevant tab
        if (result.nuevos.length > 0) setActiveTab('nuevos')
        else if (result.yaExisten.length > 0) setActiveTab('yaExisten')
        else setActiveTab('conErrores')
        setStep('preview')
      } catch {
        Swal.fire('Error', 'No se pudo leer el archivo. Verifique que sea un Excel válido.', 'error')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function handleImportar() {
    if (analyzed.nuevos.length === 0) return

    setStep('importing')
    const BATCH_SIZE = 100
    const insertados: Cliente[] = []

    for (let i = 0; i < analyzed.nuevos.length; i += BATCH_SIZE) {
      const lote = analyzed.nuevos.slice(i, i + BATCH_SIZE).map(r => ({
        nombre: r.data.nombre,
        codigo: r.data.codigo,
        email: r.data.email ?? null,
        direccion: r.data.direccion ?? null,
        telefono: r.data.telefono ?? null,
        whatsapp: r.data.whatsapp ?? null,
        nacionalidad: r.data.nacionalidad ?? null,
        cui_dui: r.data.cui_dui ?? null,
        fecha_nacimiento: r.data.fecha_nacimiento ?? null,
        numero_facturacion: r.data.numero_facturacion ?? null,
        telefono_alterno: r.data.telefono_alterno ?? null,
        puede_crear_cuenta: false,
      }))

      const { data, error } = await supabase.from('clientes').insert(lote).select()
      if (!error && data) {
        insertados.push(...(data as Cliente[]))

        // Link each new client to the company
        if (companyId && data.length > 0) {
          const links = (data as Cliente[]).map(c => ({
            company_id: companyId,
            cliente_id: c.id,
            added_by: userId,
          }))
          await supabase.from('company_clientes').insert(links)
        }
      } else {
        Swal.fire('Error en inserción', error?.message ?? 'Error al guardar lote de clientes.', 'error')
        setStep('preview')
        return
      }
    }

    onImportado(insertados)
    setImportados(insertados.length)
    setStep('done')
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '16px',
  }
  const modalStyle: React.CSSProperties = {
    background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '860px',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  }
  const headerStyle: React.CSSProperties = {
    padding: '24px 28px 20px', borderBottom: '1px solid #e2e8f0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }
  const bodyStyle: React.CSSProperties = {
    padding: '24px 28px', overflowY: 'auto', flex: 1,
  }
  const footerStyle: React.CSSProperties = {
    padding: '16px 28px', borderTop: '1px solid #e2e8f0',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px',
    flexWrap: 'wrap',
  }
  const btnPrimary: React.CSSProperties = {
    padding: '10px 22px', background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
    color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }
  const btnSecondary: React.CSSProperties = {
    padding: '10px 22px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }
  const btnDanger: React.CSSProperties = {
    padding: '10px 22px', background: '#fef2f2', color: '#b91c1c',
    border: '1px solid #fecaca', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }

  const { yaExisten, nuevos, conErrores } = analyzed

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: active ? '2px solid #0ea5e9' : '2px solid transparent',
    background: 'none',
    color: active ? '#0ea5e9' : '#64748b',
    fontWeight: active ? 700 : 500,
    fontSize: '14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  const stepLabel = () => {
    if (step === 'upload') return 'Descarga la plantilla, complétala y sube el archivo.'
    if (step === 'preview') {
      const total = yaExisten.length + nuevos.length + conErrores.length
      return `${total} fila${total !== 1 ? 's' : ''} analizadas — ${nuevos.length} nueva${nuevos.length !== 1 ? 's' : ''}, ${yaExisten.length} ya en sistema, ${conErrores.length} con error${conErrores.length !== 1 ? 'es' : ''}`
    }
    if (step === 'importing') return 'Guardando clientes en la base de datos...'
    if (step === 'done') return `${importados} cliente${importados !== 1 ? 's' : ''} importado${importados !== 1 ? 's' : ''} exitosamente.`
    return ''
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
              Importar clientes desde Excel
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              {stepLabel()}
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
              {/* Template download */}
              <div style={{ marginBottom: '24px', padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#0369a1', fontSize: '14px' }}>Paso 1 — Descarga la plantilla</div>
                  <div style={{ fontSize: '13px', color: '#0ea5e9', marginTop: '2px' }}>
                    Incluye encabezados y 2 filas de ejemplo con los campos aceptados.
                  </div>
                </div>
                <button onClick={descargarPlantilla} style={{ ...btnPrimary, background: '#0ea5e9', whiteSpace: 'nowrap' }}>
                  ⬇ plantilla_clientes.xlsx
                </button>
              </div>

              {/* Fields reference */}
              <div style={{ marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Columnas de la plantilla:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {['nombre *', 'codigo *', 'email', 'telefono', 'whatsapp', 'direccion', 'nacionalidad', 'cui_dui', 'fecha_nacimiento', 'numero_facturacion', 'telefono_alterno'].map(col => (
                    <span
                      key={col}
                      style={{
                        fontSize: '12px',
                        background: col.endsWith('*') ? '#dbeafe' : '#e2e8f0',
                        color: col.endsWith('*') ? '#1e40af' : '#334155',
                        padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace',
                      }}
                    >
                      {col}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                  * Requerido — <code>fecha_nacimiento</code>: formato YYYY-MM-DD — teléfonos: 8 dígitos
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
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <span style={{ padding: '6px 14px', background: '#dcfce7', color: '#166534', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                  ✅ {nuevos.length} nuevo{nuevos.length !== 1 ? 's' : ''}
                </span>
                <span style={{ padding: '6px 14px', background: '#e0f2fe', color: '#0369a1', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                  🔁 {yaExisten.length} ya en sistema
                </span>
                {conErrores.length > 0 && (
                  <span style={{ padding: '6px 14px', background: '#fee2e2', color: '#991b1b', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                    ❌ {conErrores.length} con error{conErrores.length !== 1 ? 'es' : ''}
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '16px', gap: '4px' }}>
                <button style={tabStyle(activeTab === 'nuevos')} onClick={() => setActiveTab('nuevos')}>
                  Nuevos ({nuevos.length})
                </button>
                <button style={tabStyle(activeTab === 'yaExisten')} onClick={() => setActiveTab('yaExisten')}>
                  Ya en sistema ({yaExisten.length})
                </button>
                <button style={tabStyle(activeTab === 'conErrores')} onClick={() => setActiveTab('conErrores')}>
                  Con errores ({conErrores.length})
                </button>
              </div>

              {/* Tab: Nuevos */}
              {activeTab === 'nuevos' && (
                <div>
                  {nuevos.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0', fontSize: '14px' }}>
                      No hay clientes nuevos para agregar.
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: '13px', color: '#166534', background: '#f0fdf4', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', border: '1px solid #bbf7d0' }}>
                        ✅ Estos {nuevos.length} cliente{nuevos.length !== 1 ? 's' : ''} serán agregados a tu empresa al confirmar.
                      </p>
                      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#f8fafc' }}>
                              {['Fila', 'Nombre', 'Código', 'Email', 'Teléfono'].map(h => (
                                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {nuevos.map(row => (
                              <tr key={row.index} style={{ background: '#f0fdf4', borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '9px 14px', color: '#94a3b8' }}>{row.index}</td>
                                <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>{row.data.nombre ?? '—'}</td>
                                <td style={{ padding: '9px 14px', color: '#334155' }}>{row.data.codigo ?? '—'}</td>
                                <td style={{ padding: '9px 14px', color: '#64748b' }}>{row.data.email ?? '—'}</td>
                                <td style={{ padding: '9px 14px', color: '#64748b' }}>{row.data.telefono ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Tab: Ya en sistema */}
              {activeTab === 'yaExisten' && (
                <div>
                  {yaExisten.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0', fontSize: '14px' }}>
                      Ningún cliente del archivo ya existe en tu empresa.
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: '13px', color: '#0369a1', background: '#f0f9ff', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', border: '1px solid #bae6fd' }}>
                        🔁 Estos clientes ya están registrados en tu empresa y no serán modificados.
                      </p>
                      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#f8fafc' }}>
                              {['Fila', 'Nombre', 'Código', 'Motivo'].map(h => (
                                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {yaExisten.map(row => (
                              <tr key={row.index} style={{ background: '#f0f9ff', borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '9px 14px', color: '#94a3b8' }}>{row.index}</td>
                                <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>{row.data.nombre ?? '—'}</td>
                                <td style={{ padding: '9px 14px', color: '#334155' }}>{row.data.codigo ?? '—'}</td>
                                <td style={{ padding: '9px 14px', color: '#0369a1', fontSize: '12px' }}>{row.duplicateReason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Tab: Con errores */}
              {activeTab === 'conErrores' && (
                <div>
                  {conErrores.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0', fontSize: '14px' }}>
                      No se encontraron filas con errores. ¡Excelente!
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: '13px', color: '#92400e', background: '#fffbeb', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', border: '1px solid #fde68a' }}>
                        ⚠️ Estas {conErrores.length} fila{conErrores.length !== 1 ? 's' : ''} contienen errores y no serán importadas. Descárgalas para revisarlas y corregirlas.
                      </p>
                      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#f8fafc' }}>
                              {['Fila', 'Nombre', 'Código', 'Error'].map(h => (
                                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {conErrores.map(row => (
                              <tr key={row.index} style={{ background: '#fff1f2', borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '9px 14px', color: '#94a3b8' }}>{row.index}</td>
                                <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>{row.rawData['nombre'] || '—'}</td>
                                <td style={{ padding: '9px 14px', color: '#334155' }}>{row.rawData['codigo'] || '—'}</td>
                                <td style={{ padding: '9px 14px' }}>
                                  <span title={row.errors.join('\n')} style={{ color: '#dc2626', cursor: 'help' }}>
                                    ❌ {row.errors[0]}{row.errors.length > 1 ? ` (+${row.errors.length - 1})` : ''}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step: importing */}
          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏳</div>
              <div style={{ fontWeight: 600, color: '#334155', fontSize: '16px' }}>Importando clientes...</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>Por favor espera, no cierres esta ventana.</div>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
              <div style={{ fontWeight: 700, color: '#166534', fontSize: '20px', marginBottom: '12px' }}>
                {importados} cliente{importados !== 1 ? 's' : ''} importado{importados !== 1 ? 's' : ''} correctamente
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '16px', fontSize: '14px', color: '#64748b' }}>
                {analyzed.yaExisten.length > 0 && (
                  <span style={{ padding: '6px 14px', background: '#e0f2fe', color: '#0369a1', borderRadius: '20px', fontWeight: 600 }}>
                    🔁 {analyzed.yaExisten.length} ya existían
                  </span>
                )}
                {analyzed.conErrores.length > 0 && (
                  <span style={{ padding: '6px 14px', background: '#fee2e2', color: '#991b1b', borderRadius: '20px', fontWeight: 600 }}>
                    ❌ {analyzed.conErrores.length} con errores
                  </span>
                )}
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
              <button onClick={() => { setStep('upload') }} style={btnSecondary}>← Volver</button>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {conErrores.length > 0 && (
                  <button onClick={descargarErrores} style={btnDanger}>
                    ⬇ Descargar errores ({conErrores.length})
                  </button>
                )}
                <button
                  onClick={handleImportar}
                  disabled={nuevos.length === 0}
                  style={{ ...btnPrimary, opacity: nuevos.length === 0 ? 0.5 : 1, cursor: nuevos.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  Grabar {nuevos.length} cliente{nuevos.length !== 1 ? 's' : ''} nuevo{nuevos.length !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div>
                {analyzed.conErrores.length > 0 && (
                  <button onClick={descargarErrores} style={btnDanger}>
                    ⬇ Descargar errores ({analyzed.conErrores.length})
                  </button>
                )}
              </div>
              <button onClick={onClose} style={btnPrimary}>Cerrar</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

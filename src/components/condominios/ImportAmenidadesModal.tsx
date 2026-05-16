import { useState, useRef, type CSSProperties, type ChangeEvent, type DragEvent } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { parseXlsxToObjects, writeXlsx } from '../../lib/xlsx'

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

interface ParsedRow {
  index: number
  data: AmenidadImportRow
  errors: string[]
  valid: boolean
}

interface Props {
  proyectoId: string
  companyId: string
  onClose: () => void
  onImportado: () => void
}

function validateRow(row: Record<string, unknown>, index: number): ParsedRow {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  if (!nombre || nombre.length < 2)
    errors.push('nombre debe tener al menos 2 caracteres')

  const capacidad_raw = row['capacidad_max']
  let capacidad_max: number | undefined
  if (capacidad_raw !== '' && capacidad_raw !== null && capacidad_raw !== undefined) {
    const n = Number(capacidad_raw)
    if (isNaN(n) || n < 1 || !Number.isInteger(n))
      errors.push('capacidad_max debe ser un número entero mayor a 0')
    else
      capacidad_max = n
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
    else
      tarifa_uso = t
    const tf = row['tarifa_uso_finde']
    if (tf !== '' && tf !== null && tf !== undefined) {
      const tfn = Number(tf)
      if (isNaN(tfn) || tfn < 0)
        errors.push('tarifa_uso_finde debe ser un número ≥ 0')
      else
        tarifa_uso_finde = tfn
    }
  }

  const requiere_deposito = normalizeBool(row['requiere_deposito'])
  let monto_deposito: number | undefined
  if (requiere_deposito) {
    const md = Number(row['monto_deposito'])
    if (isNaN(md) || md < 0)
      errors.push('monto_deposito debe ser un número ≥ 0 cuando requiere_deposito es sí')
    else
      monto_deposito = md
  }

  const data: AmenidadImportRow = {
    nombre,
    descripcion: String(row['descripcion'] ?? '').trim() || undefined,
    capacidad_max,
    horario_inicio: horario_inicio ?? undefined,
    horario_fin: horario_fin ?? undefined,
    requiere_deposito,
    monto_deposito,
    requiere_tarifa,
    tarifa_uso,
    tarifa_uso_finde,
    requiere_aprobacion: normalizeBool(row['requiere_aprobacion']),
    reglamento: String(row['reglamento'] ?? '').trim() || undefined,
  }

  return { index, data, errors, valid: errors.length === 0 }
}

export function ImportAmenidadesModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importados, setImportados] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function descargarPlantilla() {
    void writeXlsx('plantilla_amenidades', [{
      name: 'Amenidades',
      rows: [
        [
          'nombre', 'descripcion', 'capacidad_max', 'horario_inicio', 'horario_fin',
          'requiere_deposito', 'monto_deposito', 'requiere_tarifa', 'tarifa_uso',
          'tarifa_uso_finde', 'requiere_aprobacion', 'reglamento',
        ],
        [
          'Piscina', 'Área de natación principal', 30, '06:00', '22:00',
          'sí', 100, 'no', '', '', 'no', '',
        ],
        [
          'Salón Social', 'Salón para eventos y reuniones', 80, '08:00', '23:00',
          'sí', 200, 'sí', 50, 75, 'sí', 'El residente es responsable de dejar el salón limpio.',
        ],
        [
          'Gimnasio', '', 20, '05:00', '23:00',
          'no', '', 'no', '', '', 'no', '',
        ],
      ],
      colWidths: [18, 30, 14, 14, 12, 18, 15, 16, 12, 16, 20, 40],
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

  async function handleImportar() {
    setStep('importing')
    const validRows = rows.filter(r => r.valid)
    const BATCH_SIZE = 100
    let total = 0

    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const lote = validRows.slice(i, i + BATCH_SIZE).map(r => ({
        ...r.data,
        project_id: proyectoId,
        company_id: companyId,
        activo: true,
      }))
      const { error } = await supabase.from('amenidades').insert(lote)
      if (error) {
        Swal.fire('Error en inserción', error.message, 'error')
        setStep('preview')
        return
      }
      total += lote.length
    }

    onImportado()
    setImportados(total)
    setStep('done')
  }

  const validCount = rows.filter(r => r.valid).length
  const invalidCount = rows.filter(r => !r.valid).length

  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: '16px',
  }
  const modalStyle: CSSProperties = {
    background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '820px',
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
              Importar amenidades desde Excel
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              {step === 'upload' && 'Descarga la plantilla, complétala y sube el archivo. Podrás agregar fotos editando cada amenidad después.'}
              {step === 'preview' && `${rows.length} fila${rows.length !== 1 ? 's' : ''} encontrada${rows.length !== 1 ? 's' : ''} — ${validCount} válida${validCount !== 1 ? 's' : ''}, ${invalidCount} con error${invalidCount !== 1 ? 'es' : ''}`}
              {step === 'importing' && 'Guardando amenidades en la base de datos...'}
              {step === 'done' && `${importados} amenidad${importados !== 1 ? 'es' : ''} importada${importados !== 1 ? 's' : ''} exitosamente.`}
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
              <div style={{ marginBottom: '24px', padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#0369a1', fontSize: '14px' }}>Paso 1 — Descarga la plantilla</div>
                  <div style={{ fontSize: '13px', color: '#0ea5e9', marginTop: '2px' }}>
                    Incluye encabezados y 3 filas de ejemplo (piscina, salón social, gimnasio).
                  </div>
                </div>
                <button onClick={descargarPlantilla} style={{ ...btnPrimary, background: '#0ea5e9', whiteSpace: 'nowrap' }}>
                  ⬇ plantilla_amenidades.xlsx
                </button>
              </div>

              {/* Columnas reference */}
              <div style={{ marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>Columnas de la plantilla:</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px' }}>
                  {[
                    { col: 'nombre', note: 'Requerido, mín. 2 caracteres' },
                    { col: 'descripcion', note: 'Opcional' },
                    { col: 'capacidad_max', note: 'Número entero (personas)' },
                    { col: 'horario_inicio', note: 'Formato HH:MM (ej. 08:00)' },
                    { col: 'horario_fin', note: 'Formato HH:MM (ej. 22:00)' },
                    { col: 'requiere_deposito', note: 'sí / no' },
                    { col: 'monto_deposito', note: 'Número si requiere_deposito=sí' },
                    { col: 'requiere_tarifa', note: 'sí / no' },
                    { col: 'tarifa_uso', note: 'Número si requiere_tarifa=sí' },
                    { col: 'tarifa_uso_finde', note: 'Tarifa fin de semana (opcional)' },
                    { col: 'requiere_aprobacion', note: 'sí / no' },
                    { col: 'reglamento', note: 'Texto libre (opcional)' },
                  ].map(({ col, note }) => (
                    <div key={col} style={{ fontSize: '12px' }}>
                      <code style={{ background: '#e2e8f0', color: '#334155', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>{col}</code>
                      <span style={{ color: '#64748b', marginLeft: 5 }}>{note}</span>
                    </div>
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

              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Fila', 'Nombre', 'Capacidad', 'Horario', 'Depósito', 'Tarifa', 'Estado'].map(h => (
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
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>{row.data.nombre || '—'}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>{row.data.capacidad_max ?? '—'}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>
                          {row.data.horario_inicio && row.data.horario_fin
                            ? `${row.data.horario_inicio}–${row.data.horario_fin}`
                            : '—'}
                        </td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>
                          {row.data.requiere_deposito ? `Sí (${row.data.monto_deposito ?? '?'})` : 'No'}
                        </td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>
                          {row.data.requiere_tarifa ? `Sí (${row.data.tarifa_uso ?? '?'})` : 'No'}
                        </td>
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
              <div style={{ fontWeight: 600, color: '#334155', fontSize: '16px' }}>Importando amenidades...</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>Por favor espera, no cierres esta ventana.</div>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
              <div style={{ fontWeight: 700, color: '#166534', fontSize: '20px' }}>
                {importados} amenidad{importados !== 1 ? 'es' : ''} importada{importados !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
                Las amenidades ya aparecen en la lista. Puedes agregar fotos editando cada una.
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
                Importar {validCount} amenidad{validCount !== 1 ? 'es' : ''}
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

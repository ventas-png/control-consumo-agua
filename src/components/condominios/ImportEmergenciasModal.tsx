import { useState, useRef, type CSSProperties, type ChangeEvent, type DragEvent } from 'react'
import Swal from 'sweetalert2'
import type { TipoContactoEmergencia } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { parseXlsxToObjects, writeXlsx } from '../../lib/xlsx'

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

interface ParsedRow {
  index: number
  data: ContactoRow
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

  const tipoRaw = String(row['tipo'] ?? '').trim().toLowerCase() as TipoContactoEmergencia
  if (!TIPOS_VALIDOS.includes(tipoRaw))
    errors.push(`tipo inválido: "${row['tipo']}" — use: ${TIPOS_VALIDOS.join(', ')}`)

  const telefono = String(row['telefono'] ?? '').trim()
  if (!telefono)
    errors.push('telefono es requerido')

  const ordenRaw = row['orden']
  let orden = 0
  if (ordenRaw !== '' && ordenRaw !== null && ordenRaw !== undefined) {
    const n = parseInt(String(ordenRaw))
    if (!isNaN(n) && n >= 0) orden = n
  }

  const data: ContactoRow = {
    nombre,
    tipo: TIPOS_VALIDOS.includes(tipoRaw) ? tipoRaw : 'general',
    telefono,
    telefono_alternativo: String(row['telefono_alternativo'] ?? '').trim() || undefined,
    descripcion: String(row['descripcion'] ?? '').trim() || undefined,
    disponible_24h: normalizeBool(row['disponible_24h']),
    orden,
  }

  return { index, data, errors, valid: errors.length === 0 }
}

export function ImportEmergenciasModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importados, setImportados] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function descargarPlantilla() {
    void writeXlsx('plantilla_emergencias', [{
      name: 'Emergencias',
      rows: [
        ['nombre', 'tipo', 'telefono', 'telefono_alternativo', 'descripcion', 'disponible_24h', 'orden'],
        ['Policía Nacional Civil', 'policia', '110', '', '', 'sí', 1],
        ['Bomberos Voluntarios', 'bomberos', '122', '123', 'Estación central', 'sí', 2],
        ['Cruz Roja / Ambulancia', 'ambulancia', '125', '', '', 'sí', 3],
        ['Hospital General', 'hospital', '2329-0000', '2329-0001', 'Urgencias 24h', 'sí', 4],
        ['EEGSA Electricidad', 'electricidad', '1516', '', 'Reporte de averías', 'sí', 5],
        ['EMPAGUA Agua', 'agua', '1543', '', '', 'no', 6],
        ['Administración', 'administracion', '+502 5555-0000', '', 'Encargado: Juan Pérez', 'no', 7],
      ],
      colWidths: [28, 14, 16, 18, 28, 14, 8],
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
      const { error } = await supabase.from('contactos_emergencia').insert(lote)
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

  const TIPO_ICONS: Record<string, string> = {
    bomberos: '🚒', policia: '🚔', ambulancia: '🚑', hospital: '🏥',
    electricidad: '⚡', agua: '💧', gas: '🔥', administracion: '🏢', general: '📞',
  }

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
  const bodyStyle: CSSProperties = { padding: '24px 28px', overflowY: 'auto', flex: 1 }
  const footerStyle: CSSProperties = {
    padding: '16px 28px', borderTop: '1px solid #e2e8f0',
    display: 'flex', justifyContent: 'flex-end', gap: '10px',
  }
  const btnPrimary: CSSProperties = {
    padding: '10px 22px', background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
    color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
  }
  const btnSecondary: CSSProperties = {
    padding: '10px 22px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
              Importar contactos de emergencia desde Excel
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              {step === 'upload' && 'Descarga la plantilla, complétala y sube el archivo.'}
              {step === 'preview' && `${rows.length} fila${rows.length !== 1 ? 's' : ''} encontrada${rows.length !== 1 ? 's' : ''} — ${validCount} válida${validCount !== 1 ? 's' : ''}, ${invalidCount} con error${invalidCount !== 1 ? 'es' : ''}`}
              {step === 'importing' && 'Guardando contactos en la base de datos...'}
              {step === 'done' && `${importados} contacto${importados !== 1 ? 's' : ''} importado${importados !== 1 ? 's' : ''} exitosamente.`}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '22px', lineHeight: 1, padding: '4px' }}>✕</button>
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
                    Incluye encabezados y 7 filas de ejemplo con los tipos más comunes.
                  </div>
                </div>
                <button onClick={descargarPlantilla} style={{ ...btnPrimary, background: '#0ea5e9', whiteSpace: 'nowrap' }}>
                  ⬇ plantilla_emergencias.xlsx
                </button>
              </div>

              {/* Tipos válidos */}
              <div style={{ marginBottom: '20px', padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>Valores válidos para la columna <code>tipo</code>:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {TIPOS_VALIDOS.map(t => (
                    <span key={t} style={{ fontSize: '12px', background: '#e2e8f0', color: '#334155', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                      {TIPO_ICONS[t]} {t}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>
                  <strong>disponible_24h:</strong> sí / no &nbsp;·&nbsp; <strong>orden:</strong> número entero (prioridad en el directorio)
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
                  borderRadius: '12px', padding: '48px 24px', textAlign: 'center',
                  cursor: 'pointer', background: dragOver ? '#f0f9ff' : '#fafafa', transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>📂</div>
                <div style={{ fontWeight: 600, color: '#334155', fontSize: '15px', marginBottom: '6px' }}>
                  Paso 2 — Arrastra tu archivo aquí o haz clic para seleccionar
                </div>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>Formatos aceptados: .xlsx, .xls, .csv</div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileInput} style={{ display: 'none' }} />
              </div>
            </div>
          )}

          {/* Step: preview */}
          {step === 'preview' && (
            <div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <span style={{ padding: '6px 14px', background: '#dcfce7', color: '#166534', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                  ✅ {validCount} válido{validCount !== 1 ? 's' : ''}
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
                      {['Fila', 'Nombre', 'Tipo', 'Teléfono', '24h', 'Estado'].map(h => (
                        <th scope="col" key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.index} style={{ background: row.valid ? '#f0fdf4' : '#fff1f2', borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '9px 14px', color: '#94a3b8', fontWeight: 500 }}>{row.index}</td>
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a' }}>{row.data.nombre || '—'}</td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>
                          {TIPO_ICONS[row.data.tipo] ?? ''} {row.data.tipo}
                        </td>
                        <td style={{ padding: '9px 14px', color: '#334155' }}>{row.data.telefono || '—'}</td>
                        <td style={{ padding: '9px 14px', color: row.data.disponible_24h ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                          {row.data.disponible_24h ? '✓' : '—'}
                        </td>
                        <td style={{ padding: '9px 14px' }}>
                          {row.valid
                            ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✅ OK</span>
                            : <span title={row.errors.join('\n')} style={{ color: '#dc2626', cursor: 'help' }}>
                                ❌ {row.errors[0]}{row.errors.length > 1 ? ` (+${row.errors.length - 1})` : ''}
                              </span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {invalidCount > 0 && (
                <p style={{ marginTop: '12px', fontSize: '13px', color: '#92400e', background: '#fffbeb', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fde68a' }}>
                  ⚠️ Las filas con errores serán ignoradas. Solo se importarán los {validCount} contactos válidos.
                </p>
              )}
            </div>
          )}

          {/* Step: importing */}
          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏳</div>
              <div style={{ fontWeight: 600, color: '#334155', fontSize: '16px' }}>Importando contactos...</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>Por favor espera, no cierres esta ventana.</div>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
              <div style={{ fontWeight: 700, color: '#166534', fontSize: '20px' }}>
                {importados} contacto{importados !== 1 ? 's' : ''} importado{importados !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
                Los contactos ya aparecen en el directorio de emergencias.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          {step === 'upload' && <button onClick={onClose} style={btnSecondary}>Cancelar</button>}
          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('upload'); setRows([]) }} style={btnSecondary}>← Volver</button>
              <button
                onClick={handleImportar}
                disabled={validCount === 0}
                style={{ ...btnPrimary, opacity: validCount === 0 ? 0.5 : 1, cursor: validCount === 0 ? 'not-allowed' : 'pointer' }}
              >
                Importar {validCount} contacto{validCount !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'done' && <button onClick={onClose} style={btnPrimary}>Cerrar</button>}
        </div>
      </div>
    </div>
  )
}

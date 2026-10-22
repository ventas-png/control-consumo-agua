import { useState, useRef, type CSSProperties, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import { notify } from '../shared/Dialog'
import type { Cliente } from '../../types'
import { fetchClientesForDedup } from '../../domain/clientes/queries'
import { addCompanyClientesLinks } from '../../domain/clientes/mutations'
import { esErrorDuplicado, mensajeErrorGuardarCliente } from '../../domain/clientes/errores'
import { validatedInsertMany } from '../../lib/validatedInsert'
import { clienteInputSchema } from '../../domain/agua/schemas'
import { sanitizeInput, validateEmail, validatePhoneNumber } from '../../lib/validation'
import { parseXlsxToObjects, writeXlsx } from '../../lib/xlsx'
import { EditModal } from '../shared/EditModal'

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

/**
 * Clasifica las filas del archivo.
 *
 * `visibles` son los clientes que el usuario puede leer (RLS de `clientes`: los
 * de su empresa; todos, si es super admin) y `deTuLista` los de su lista de
 * Clientes. Una fila que ya existe NO se importa ni se "vincula": la de tu
 * lista ya está vinculada, y una de la plataforma fuera de tu lista solo se
 * vincula con «Solicitar Cliente», que verifica CUI/DUI, fecha de nacimiento y
 * correo. Lo que este usuario no ve (otra empresa) sale como nuevo y, si choca
 * con un código o CUI/DUI ya usado, se rechaza al grabar (ver handleImportar).
 */
function analyzeRows(parsedRows: ParsedRow[], visibles: Cliente[], deTuLista: Cliente[]): AnalyzedResult {
  const codigos = (cs: Cliente[]) => new Set(cs.map(c => c.codigo.toLowerCase()))
  const cuis = (cs: Cliente[]) => new Set(cs.filter(c => c.cui_dui).map(c => c.cui_dui!.toLowerCase()))
  const listaCodigos = codigos(deTuLista)
  const listaCuis = cuis(deTuLista)
  const visiblesCodigos = codigos(visibles)
  const visiblesCuis = cuis(visibles)

  // Track duplicates WITHIN the imported file
  const seenCodigosInFile = new Set<string>()
  const seenCuiDuisInFile = new Set<string>()

  const yaExisten: ParsedRow[] = []
  const nuevos: ParsedRow[] = []
  const conErrores: ParsedRow[] = []

  const dondeEsta = (enLista: boolean, visible: boolean, enArchivo: boolean) =>
    enLista ? 'ya está en tu lista de clientes'
      : visible ? 'ya está registrado en la plataforma, fuera de tu lista'
        : enArchivo ? 'está repetido en este archivo' : null

  for (const row of parsedRows) {
    if (!row.valid) {
      conErrores.push(row)
      continue
    }

    const codigoNorm = row.data.codigo!.toLowerCase()
    const cuiNorm = row.data.cui_dui?.toLowerCase()

    const motivoCodigo = dondeEsta(listaCodigos.has(codigoNorm), visiblesCodigos.has(codigoNorm), seenCodigosInFile.has(codigoNorm))
    const motivoCui = cuiNorm
      ? dondeEsta(listaCuis.has(cuiNorm), visiblesCuis.has(cuiNorm), seenCuiDuisInFile.has(cuiNorm))
      : null

    if (motivoCodigo || motivoCui) {
      const reasons: string[] = []
      if (motivoCodigo) reasons.push(`código "${row.data.codigo}" ${motivoCodigo}`)
      if (motivoCui) reasons.push(`CUI/DUI "${row.data.cui_dui}" ${motivoCui}`)
      yaExisten.push({ ...row, duplicateReason: reasons.join(', ') })
    } else {
      // Mark as seen for future iterations
      seenCodigosInFile.add(codigoNorm)
      if (cuiNorm) seenCuiDuisInFile.add(cuiNorm)
      nuevos.push(row)
    }
  }

  return { yaExisten, nuevos, conErrores }
}

/** Fila que no se pudo grabar porque su código o CUI/DUI ya está en uso. */
interface Rechazado {
  row: ParsedRow
  motivo: string
}

function payloadCliente(r: ParsedRow) {
  return {
    id: crypto.randomUUID(),
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
  }
}

export function ImportClientesModal({ existingClientes, userId, companyId, onClose, onImportado }: Props) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload')
  const [analyzed, setAnalyzed] = useState<AnalyzedResult>({ yaExisten: [], nuevos: [], conErrores: [] })
  const [activeTab, setActiveTab] = useState<'nuevos' | 'yaExisten' | 'conErrores'>('nuevos')
  const [importados, setImportados] = useState(0)
  const [rechazados, setRechazados] = useState<Rechazado[]>([])
  // Error que cortó la importación a medias (lo grabado antes se conserva).
  const [errorFatal, setErrorFatal] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function descargarPlantilla() {
    void writeXlsx('plantilla_clientes', [{
      name: 'Clientes',
      rows: [
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
      ],
      colWidths: [22, 12, 26, 12, 12, 26, 16, 18, 18, 18, 18],
    }]).catch(err => notify({ variant: 'error', title: 'Error', text: err.message ?? 'No se pudo generar la plantilla' }))
  }

  function descargarErrores() {
    const filas = [
      ...analyzed.conErrores.map(r => ({ r, motivo: r.errors.join('; ') })),
      ...rechazados.map(x => ({ r: x.row, motivo: x.motivo })),
    ]
    if (filas.length === 0) return
    const headers: (string | number | null | undefined)[] = [
      'nombre', 'codigo', 'email', 'telefono', 'whatsapp', 'direccion',
      'nacionalidad', 'cui_dui', 'fecha_nacimiento', 'numero_facturacion', 'telefono_alterno',
      'motivo_error',
    ]
    const dataRows = filas.map(({ r, motivo }) => [
      String(r.rawData['nombre'] ?? ''),
      String(r.rawData['codigo'] ?? ''),
      String(r.rawData['email'] ?? ''),
      String(r.rawData['telefono'] ?? ''),
      String(r.rawData['whatsapp'] ?? ''),
      String(r.rawData['direccion'] ?? ''),
      String(r.rawData['nacionalidad'] ?? ''),
      String(r.rawData['cui_dui'] ?? ''),
      String(r.rawData['fecha_nacimiento'] ?? ''),
      String(r.rawData['numero_facturacion'] ?? ''),
      String(r.rawData['telefono_alterno'] ?? ''),
      motivo,
    ])
    void writeXlsx('clientes_con_errores', [{
      name: 'Errores',
      rows: [headers, ...dataRows],
      colWidths: [22, 12, 26, 12, 12, 26, 16, 18, 18, 18, 18, 50],
    }]).catch(err => notify({ variant: 'error', title: 'Error', text: err.message ?? 'No se pudo exportar' }))
  }

  async function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      notify({ variant: 'error', title: 'Formato inválido', text: 'Solo se aceptan archivos .xlsx, .xls o .csv' })
      return
    }
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const raw = await parseXlsxToObjects<Record<string, string | number | boolean>>(e.target!.result as ArrayBuffer)
        if (raw.length === 0) {
          notify({ variant: 'warning', title: 'Archivo vacío', text: 'El archivo no contiene filas de datos.' })
          return
        }

        // Load ALL global clients (not just filtered ones) for accurate duplicate detection
        const { data: allClientes, error } = await fetchClientesForDedup()

        if (error) {
          notify({ variant: 'error', title: 'Error', text: 'No se pudieron cargar los clientes globales.' })
          console.error('Error loading global clients:', error)
          return
        }

        // Use all clients + existing clients for comprehensive duplicate detection
        const globalClientes = (allClientes || []) as Cliente[]

        const parsed = raw.map((row, i) => validateRow(row, i + 2))
        const result = analyzeRows(parsed, globalClientes, existingClientes)
        setAnalyzed(result)
        // Default to most relevant tab
        if (result.nuevos.length > 0) setActiveTab('nuevos')
        else if (result.yaExisten.length > 0) setActiveTab('yaExisten')
        else setActiveTab('conErrores')
        setStep('preview')
      } catch {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo leer el archivo. Verifique que sea un Excel válido.' })
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
    if (analyzed.nuevos.length === 0) return

    setStep('importing')
    const BATCH_SIZE = 100
    const insertados: Cliente[] = []
    const rechazadosAhora: Rechazado[] = []
    let fatal: string | null = null

    // agua:C6 — batch insert con pre-validación Zod por fila. Si cualquier
    // fila falla shape (e.g. email malformado, código vacío), aborta el
    // lote sin tocar DB y muestra fieldErrors granular al usuario.
    // `.passthrough()` para preservar `id` generado y otros campos
    // system-side que no están en el schema de input.
    // Sin `.select()` para evitar conflicto RETURNING + SELECT RLS
    // (SELECT policy requiere company_clientes link que aún no existe).
    async function grabar(lote: ReturnType<typeof payloadCliente>[]) {
      const { error } = await validatedInsertMany('clientes', clienteInputSchema.passthrough(), lote)
      if (!error && companyId) {
        // Link to company now that the clients exist
        await addCompanyClientesLinks(lote.map(c => ({ company_id: companyId, cliente_id: c.id, added_by: userId })))
      }
      return error
    }

    for (let i = 0; i < analyzed.nuevos.length && !fatal; i += BATCH_SIZE) {
      const filas = analyzed.nuevos.slice(i, i + BATCH_SIZE)
      const lote = filas.map(payloadCliente)
      const error = await grabar(lote)
      if (!error) {
        insertados.push(...lote.map(c => ({ ...c } as unknown as Cliente)))
        continue
      }
      if (!esErrorDuplicado(error)) {
        fatal = mensajeErrorGuardarCliente(error)
        break
      }
      // El código y el CUI/DUI son únicos en toda la plataforma, y los de otra
      // empresa no se ven desde aquí (RLS): una sola fila así hacía fallar el
      // INSERT del lote entero. Se reintenta fila por fila para grabar las que
      // sí pueden entrar y rechazar, con su motivo, solo las que chocan.
      for (let k = 0; k < lote.length; k++) {
        const errFila = await grabar([lote[k]])
        if (!errFila) insertados.push({ ...lote[k] } as unknown as Cliente)
        else if (esErrorDuplicado(errFila)) rechazadosAhora.push({ row: filas[k], motivo: mensajeErrorGuardarCliente(errFila) })
        else { fatal = mensajeErrorGuardarCliente(errFila); break }
      }
    }

    // Lo grabado se informa aunque la importación se haya cortado: volver a la
    // vista previa invitaba a reintentar filas que ya estaban guardadas.
    onImportado(insertados)
    setImportados(insertados.length)
    setRechazados(rechazadosAhora)
    setErrorFatal(fatal)
    setStep('done')
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  // Overlay, panel, cabecera y cuerpo los pone EditModal. El pie conserva su
  // reparto (Volver a la izquierda, acciones a la derecha) dentro del de EditModal.
  const footerStyle: CSSProperties = {
    width: '100%',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px',
    flexWrap: 'wrap',
  }
  const btnPrimary: CSSProperties = {
    padding: '10px 22px', background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
    color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }
  const btnSecondary: CSSProperties = {
    padding: '10px 22px', background: 'var(--at-chip)', color: 'var(--at-ink-2)',
    border: '1px solid var(--at-line)', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }
  const btnDanger: CSSProperties = {
    padding: '10px 22px', background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)',
    border: '1px solid var(--at-danger-border)', borderRadius: '8px', fontWeight: 600,
    fontSize: '14px', cursor: 'pointer',
  }

  const { yaExisten, nuevos, conErrores } = analyzed

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: active ? '2px solid var(--at-primary)' : '2px solid transparent',
    background: 'none',
    color: active ? 'var(--at-primary)' : 'var(--at-ink-3)',
    fontWeight: active ? 700 : 500,
    fontSize: '14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  const stepLabel = () => {
    if (step === 'upload') return 'Descarga la plantilla, complétala y sube el archivo.'
    if (step === 'preview') {
      const total = yaExisten.length + nuevos.length + conErrores.length
      return `${total} fila${total !== 1 ? 's' : ''} analizadas — ${nuevos.length} nueva${nuevos.length !== 1 ? 's' : ''}, ${yaExisten.length} ya registrada${yaExisten.length !== 1 ? 's' : ''}${yaExisten.length > 0 ? ' (no se importan)' : ''}, ${conErrores.length} con error${conErrores.length !== 1 ? 'es' : ''}`
    }
    if (step === 'importing') return 'Guardando clientes en la base de datos...'
    if (step === 'done') return errorFatal
      ? 'La importación se detuvo antes de terminar.'
      : `${importados} cliente${importados !== 1 ? 's' : ''} importado${importados !== 1 ? 's' : ''}.`
    return ''
  }

  // Abrir el selector de archivo también con teclado (antes solo con clic).
  function handleDropZoneKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInputRef.current?.click()
    }
  }

  // Durante la importación no se cierra con Escape ni tocando el fondo: el
  // ciclo de lotes sigue en curso y el aviso pide no cerrar la ventana.
  const importando = step === 'importing'

  return (
    <EditModal
      title="Importar clientes desde Excel"
      subtitle={stepLabel()}
      maxWidth="860px"
      fullScreenOnMobile
      onClose={onClose}
      closeOnBackdropClick={!importando}
      closeOnEscape={!importando}
      footer={importando ? undefined : (
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
                  {nuevos.length > 0
                    ? `Grabar ${nuevos.length} cliente${nuevos.length !== 1 ? 's' : ''} nuevo${nuevos.length !== 1 ? 's' : ''}`
                    : 'No hay clientes nuevos que grabar'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div>
                {analyzed.conErrores.length + rechazados.length > 0 && (
                  <button onClick={descargarErrores} style={btnDanger}>
                    ⬇ Descargar errores ({analyzed.conErrores.length + rechazados.length})
                  </button>
                )}
              </div>
              <button onClick={onClose} style={btnPrimary}>Cerrar</button>
            </>
          )}
        </div>
      )}
    >
      {/* Step: upload */}
      {step === 'upload' && (
        <div>
          {/* Template download */}
          <div style={{ marginBottom: '24px', padding: '16px 20px', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--at-primary-hover)', fontSize: '14px' }}>Paso 1 — Descarga la plantilla</div>
              <div style={{ fontSize: '13px', color: 'var(--at-primary)', marginTop: '2px' }}>
                Incluye encabezados y 2 filas de ejemplo con los campos aceptados.
              </div>
            </div>
            <button onClick={descargarPlantilla} style={{ ...btnPrimary, background: 'var(--at-primary)', whiteSpace: 'nowrap' }}>
              ⬇ plantilla_clientes.xlsx
            </button>
          </div>

          {/* Fields reference */}
          <div style={{ marginBottom: '20px', padding: '12px 16px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>Columnas de la plantilla:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {['nombre *', 'codigo *', 'email', 'telefono', 'whatsapp', 'direccion', 'nacionalidad', 'cui_dui', 'fecha_nacimiento', 'numero_facturacion', 'telefono_alterno'].map(col => (
                <span
                  key={col}
                  style={{
                    fontSize: '12px',
                    background: col.endsWith('*') ? 'var(--at-primary-soft)' : 'var(--at-line)',
                    color: col.endsWith('*') ? 'var(--at-ink-deep)' : 'var(--at-ink-2)',
                    padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace',
                  }}
                >
                  {col}
                </span>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '8px' }}>
              * Requerido — <code>fecha_nacimiento</code>: formato YYYY-MM-DD — teléfonos: 8 dígitos
            </div>
          </div>

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onKeyDown={handleDropZoneKey}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--at-primary)' : 'var(--at-line-strong)'}`,
              borderRadius: '12px',
              padding: '48px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>📂</div>
            <div style={{ fontWeight: 600, color: 'var(--at-ink-2)', fontSize: '15px', marginBottom: '6px' }}>
              Paso 2 — Arrastra tu archivo aquí o haz clic para seleccionar
            </div>
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Formatos aceptados: .xlsx, .xls, .csv</div>
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
            <span style={{ padding: '6px 14px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
              ✅ {nuevos.length} nuevo{nuevos.length !== 1 ? 's' : ''}
            </span>
            <span style={{ padding: '6px 14px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
              ⏭ {yaExisten.length} ya registrado{yaExisten.length !== 1 ? 's' : ''}
            </span>
            {conErrores.length > 0 && (
              <span style={{ padding: '6px 14px', background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>
                ❌ {conErrores.length} con error{conErrores.length !== 1 ? 'es' : ''}
              </span>
            )}
          </div>

          {/* Tabs — se deslizan de lado si no caben (teléfono) en vez de salirse. */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--at-line)', marginBottom: '16px', gap: '4px', overflowX: 'auto' }}>
            <button style={tabStyle(activeTab === 'nuevos')} onClick={() => setActiveTab('nuevos')}>
              Nuevos ({nuevos.length})
            </button>
            <button style={tabStyle(activeTab === 'yaExisten')} onClick={() => setActiveTab('yaExisten')}>
              Ya registrados ({yaExisten.length})
            </button>
            <button style={tabStyle(activeTab === 'conErrores')} onClick={() => setActiveTab('conErrores')}>
              Con errores ({conErrores.length})
            </button>
          </div>

          {/* Tab: Nuevos */}
          {activeTab === 'nuevos' && (
            <div>
              {nuevos.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 0', fontSize: '14px' }}>
                  No hay clientes nuevos para agregar.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: '13px', color: 'var(--at-success-strong)', background: 'var(--at-success-tint)', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', border: '1px solid var(--at-success-border)' }}>
                    ✅ Estos {nuevos.length} cliente{nuevos.length !== 1 ? 's' : ''} serán agregados a tu empresa al confirmar.
                  </p>
                  <div className="table-scroll-wrapper" style={{ border: '1px solid var(--at-line)', borderRadius: '8px' }}>
                    {/* En el teléfono cada fila se lee como tarjeta (data-label por
                        celda) en vez de arrastrar la tabla de lado. */}
                    <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: 'var(--at-surface-2)' }}>
                          {['Fila', 'Nombre', 'Código', 'Email', 'Teléfono'].map(h => (
                            <th scope="col" key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {nuevos.map(row => (
                          <tr key={row.index} style={{ background: 'var(--at-success-tint)', borderBottom: '1px solid var(--at-line)' }}>
                            <td data-label="Fila" style={{ padding: '9px 14px', color: 'var(--at-ink-3)' }}>{row.index}</td>
                            <td data-label="Nombre" style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--at-ink)' }}>{row.data.nombre ?? '—'}</td>
                            <td data-label="Código" style={{ padding: '9px 14px', color: 'var(--at-ink-2)' }}>{row.data.codigo ?? '—'}</td>
                            <td data-label="Email" style={{ padding: '9px 14px', color: 'var(--at-ink-3)' }}>{row.data.email ?? '—'}</td>
                            <td data-label="Teléfono" style={{ padding: '9px 14px', color: 'var(--at-ink-3)' }}>{row.data.telefono ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab: Ya registrados */}
          {activeTab === 'yaExisten' && (
            <div>
              {yaExisten.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 0', fontSize: '14px' }}>
                  Ningún cliente del archivo está ya registrado.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: '13px', color: 'var(--at-primary-hover)', background: 'var(--at-primary-tint)', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', border: '1px solid var(--at-primary-soft-2)' }}>
                    ⏭ Estos clientes ya están registrados y no se importan. Si alguno está en la plataforma pero
                    no aparece en tu lista, vincúlalo con «Solicitar Cliente» (CUI/DUI, fecha de nacimiento y correo).
                  </p>
                  <div className="table-scroll-wrapper" style={{ border: '1px solid var(--at-line)', borderRadius: '8px' }}>
                    <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: 'var(--at-surface-2)' }}>
                          {['Fila', 'Nombre', 'Código', 'Motivo'].map(h => (
                            <th scope="col" key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {yaExisten.map(row => (
                          <tr key={row.index} style={{ background: 'var(--at-primary-tint)', borderBottom: '1px solid var(--at-line)' }}>
                            <td data-label="Fila" style={{ padding: '9px 14px', color: 'var(--at-ink-3)' }}>{row.index}</td>
                            <td data-label="Nombre" style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--at-ink)' }}>{row.data.nombre ?? '—'}</td>
                            <td data-label="Código" style={{ padding: '9px 14px', color: 'var(--at-ink-2)' }}>{row.data.codigo ?? '—'}</td>
                            <td data-label="Motivo" style={{ padding: '9px 14px', color: 'var(--at-primary-hover)', fontSize: '12px' }}>{row.duplicateReason}</td>
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
                <p style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 0', fontSize: '14px' }}>
                  No se encontraron filas con errores. ¡Excelente!
                </p>
              ) : (
                <>
                  <p style={{ fontSize: '13px', color: 'var(--at-warning-strong)', background: 'var(--at-warning-tint)', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', border: '1px solid var(--at-warning-border)' }}>
                    ⚠️ Estas {conErrores.length} fila{conErrores.length !== 1 ? 's' : ''} contienen errores y no serán importadas. Descárgalas para revisarlas y corregirlas.
                  </p>
                  <div className="table-scroll-wrapper" style={{ border: '1px solid var(--at-line)', borderRadius: '8px' }}>
                    <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: 'var(--at-surface-2)' }}>
                          {['Fila', 'Nombre', 'Código', 'Error'].map(h => (
                            <th scope="col" key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {conErrores.map(row => (
                          <tr key={row.index} style={{ background: 'var(--at-danger-tint)', borderBottom: '1px solid var(--at-line)' }}>
                            <td data-label="Fila" style={{ padding: '9px 14px', color: 'var(--at-ink-3)' }}>{row.index}</td>
                            <td data-label="Nombre" style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--at-ink)' }}>{row.rawData['nombre'] || '—'}</td>
                            <td data-label="Código" style={{ padding: '9px 14px', color: 'var(--at-ink-2)' }}>{row.rawData['codigo'] || '—'}</td>
                            <td data-label="Error" style={{ padding: '9px 14px' }}>
                              <span title={row.errors.join('\n')} style={{ color: 'var(--at-danger)', cursor: 'help' }}>
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
          <div style={{ fontWeight: 600, color: 'var(--at-ink-2)', fontSize: '16px' }}>Importando clientes...</div>
          <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '6px' }}>Por favor espera, no cierres esta ventana.</div>
        </div>
      )}

      {/* Step: done — antes nunca se llegaba a ver: la sección cerraba la
          ventana en cuanto terminaba la importación. */}
      {step === 'done' && (
        <div style={{ padding: '24px 0' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '52px', marginBottom: '12px' }}>{errorFatal ? '⚠️' : importados > 0 ? '✅' : 'ℹ️'}</div>
            <div style={{ fontWeight: 700, color: importados > 0 ? 'var(--at-success-strong)' : 'var(--at-ink-2)', fontSize: '20px', marginBottom: '12px' }}>
              {importados > 0
                ? `${importados} cliente${importados !== 1 ? 's' : ''} importado${importados !== 1 ? 's' : ''} correctamente`
                : 'No se importó ningún cliente'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '12px', fontSize: '14px' }}>
              {analyzed.yaExisten.length > 0 && (
                <span style={{ padding: '6px 14px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', borderRadius: '20px', fontWeight: 600 }}>
                  ⏭ {analyzed.yaExisten.length} ya registrado{analyzed.yaExisten.length !== 1 ? 's' : ''} (sin cambios)
                </span>
              )}
              {rechazados.length > 0 && (
                <span style={{ padding: '6px 14px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontWeight: 600 }}>
                  ⚠️ {rechazados.length} rechazado{rechazados.length !== 1 ? 's' : ''}
                </span>
              )}
              {analyzed.conErrores.length > 0 && (
                <span style={{ padding: '6px 14px', background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', borderRadius: '20px', fontWeight: 600 }}>
                  ❌ {analyzed.conErrores.length} con errores
                </span>
              )}
            </div>
          </div>

          {errorFatal && (
            <p role="alert" style={{ fontSize: '13px', color: 'var(--at-danger-strong)', background: 'var(--at-danger-tint)', padding: '10px 14px', borderRadius: '8px', margin: '20px 0 0', border: '1px solid var(--at-danger-border)' }}>
              La importación se detuvo: {errorFatal}
              {importados > 0 && ` Los ${importados} cliente${importados !== 1 ? 's' : ''} anteriores sí se grabaron.`}
            </p>
          )}

          {rechazados.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <p style={{ fontSize: '13px', color: 'var(--at-warning-strong)', background: 'var(--at-warning-tint)', padding: '10px 14px', borderRadius: '8px', margin: '0 0 12px', border: '1px solid var(--at-warning-border)' }}>
                ⚠️ Su código o CUI/DUI ya está en uso en la plataforma. Se incluyen en «Descargar errores».
              </p>
              <div className="table-scroll-wrapper" style={{ border: '1px solid var(--at-line)', borderRadius: '8px' }}>
                <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: 'var(--at-surface-2)' }}>
                      {['Fila', 'Nombre', 'Código', 'Motivo'].map(h => (
                        <th scope="col" key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rechazados.map(({ row, motivo }) => (
                      <tr key={row.index} style={{ borderBottom: '1px solid var(--at-line)' }}>
                        <td data-label="Fila" style={{ padding: '9px 14px', color: 'var(--at-ink-3)' }}>{row.index}</td>
                        <td data-label="Nombre" style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--at-ink)' }}>{row.data.nombre ?? '—'}</td>
                        <td data-label="Código" style={{ padding: '9px 14px', color: 'var(--at-ink-2)' }}>{row.data.codigo ?? '—'}</td>
                        <td data-label="Motivo" style={{ padding: '9px 14px', color: 'var(--at-warning-strong)', fontSize: '12px' }}>{motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </EditModal>
  )
}

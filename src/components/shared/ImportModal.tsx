import { useState, useRef, type ReactNode, type CSSProperties, type ChangeEvent, type DragEvent } from 'react'
import { notify } from '../shared/Dialog'
import { parseXlsxToObjects, writeXlsx } from '../../lib/xlsx'
import { ModalPortal } from './ModalPortal'

// ── Tipos públicos ────────────────────────────────────────────────────────

/**
 * Definición de una columna del archivo XLSX importable.
 * Se usa para:
 *   - generar la plantilla descargable (.xlsx con headers + ejemplos)
 *   - generar la columna correspondiente en el archivo de errores
 */
export interface ImportColumn {
  /** Header en el archivo XLSX y key en las filas parseadas. */
  key: string
  /** Ancho aproximado de columna en la plantilla (caracteres). */
  width?: number
  /** Valores de ejemplo opcionales (uno por fila de ejemplo en la plantilla). */
  exampleValues?: (string | number | boolean | null | undefined)[]
}

/** Resultado de validateRow del caller. */
export type RowValidationResult<T> =
  | { ok: true;  data: T }
  | { ok: false; errors: string[]; data?: Partial<T> }

export interface ImportModalProps<T> {
  /** Etiqueta singular ("cliente", "contacto de emergencia"). */
  entityLabel: string
  /** Etiqueta plural; default `${entityLabel}s`. */
  entityLabelPlural?: string

  /** Columnas para plantilla y archivo de errores. */
  columns: ImportColumn[]
  /** Nombre del sheet en la plantilla. Default: capitalize(entityLabelPlural). */
  sheetName?: string
  /** Nombre del archivo de plantilla (sin .xlsx). Default: `plantilla_${plural}`. */
  templateFilename?: string

  /**
   * Validación + transformación de una fila parseada.
   * El caller decide qué hacer con cada celda y devuelve la fila lista
   * para insertar (`ok: true`) o una lista de errores (`ok: false`).
   * El index empieza en 2 (fila 1 es el header del XLSX).
   */
  validateRow: (row: Record<string, unknown>, rowNumber: number) => RowValidationResult<T>

  /**
   * Insertar un lote ya validado en la BD.
   * Devuelve la cantidad efectivamente insertada y opcionalmente un error.
   * En caso de error, el modal se queda en el step preview para reintentar.
   */
  onInsertBatch: (batch: T[]) => Promise<{ ok: number; error?: string }>

  /** Batch size para llamar onInsertBatch. Default 100. */
  batchSize?: number

  /** Se llama al cerrar el modal. */
  onClose: () => void
  /** Se llama tras importación exitosa con la cantidad total importada. */
  onImportado: (count: number) => void

  /**
   * Sub-componente opcional para mostrar el preview de UNA fila inválida.
   * Si no se pasa, se muestra "fila X — errores: ...".
   */
  renderErrorRow?: (row: Record<string, unknown>, errors: string[]) => ReactNode

  /**
   * Panel de configuración de la importación (destino, modo, etc.). Se muestra
   * en los pasos de subida y de preview, porque la decisión sigue siendo
   * editable hasta el momento de importar.
   */
  optionsPanel?: ReactNode
  /** Bloquea el botón "Importar" (p. ej. falta elegir destino). */
  importDisabled?: boolean
  /** Motivo mostrado junto al botón cuando `importDisabled`. */
  importDisabledReason?: string
}

// ── Estado interno ────────────────────────────────────────────────────────

interface InternalRow<T> {
  index: number  // número de fila en el XLSX original (1-based desde header)
  raw: Record<string, unknown>
  data?: T
  errors: string[]
  valid: boolean
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

// ── Componente ────────────────────────────────────────────────────────────

export function ImportModal<T>({
  entityLabel,
  entityLabelPlural,
  columns,
  sheetName,
  templateFilename,
  validateRow,
  onInsertBatch,
  batchSize = 100,
  onClose,
  onImportado,
  renderErrorRow,
  optionsPanel,
  importDisabled = false,
  importDisabledReason,
}: ImportModalProps<T>) {
  const plural = entityLabelPlural ?? `${entityLabel}s`
  const sheetN = sheetName ?? plural.charAt(0).toUpperCase() + plural.slice(1)
  const tplName = templateFilename ?? `plantilla_${plural.replace(/\s+/g, '_').toLowerCase()}`

  const [step, setStep] = useState<Step>('upload')
  const [rows, setRows] = useState<InternalRow<T>[]>([])
  const [importedCount, setImportedCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validCount = rows.filter(r => r.valid).length
  const invalidCount = rows.length - validCount

  // ── Descarga de plantilla ───────────────────────────────────────────────
  function descargarPlantilla() {
    const headers = columns.map(c => c.key)
    const maxExamples = Math.max(0, ...columns.map(c => c.exampleValues?.length ?? 0))
    const exampleRows: (string | number | boolean | null | undefined)[][] = []
    for (let i = 0; i < maxExamples; i++) {
      exampleRows.push(columns.map(c => c.exampleValues?.[i] ?? ''))
    }
    void writeXlsx(tplName, [{
      name: sheetN,
      rows: [headers, ...exampleRows],
      colWidths: columns.map(c => c.width ?? 14),
    }]).catch(err =>
      notify({ variant: 'error', title: 'Error', text: err?.message ?? 'No se pudo generar la plantilla' })
    )
  }

  // ── Descarga de errores ─────────────────────────────────────────────────
  function descargarErrores() {
    const conErrores = rows.filter(r => !r.valid)
    if (conErrores.length === 0) return
    const headers = [...columns.map(c => c.key), 'motivo_error']
    const dataRows = conErrores.map(r => [
      ...columns.map(c => normalizeCell(r.raw[c.key])),
      r.errors.join('; '),
    ])
    void writeXlsx(`${plural.replace(/\s+/g, '_').toLowerCase()}_con_errores`, [{
      name: 'Errores',
      rows: [headers, ...dataRows],
      colWidths: [...columns.map(c => c.width ?? 14), 50],
    }]).catch(err =>
      notify({ variant: 'error', title: 'Error', text: err?.message ?? 'No se pudo exportar' })
    )
  }

  // ── Procesamiento de archivo subido ─────────────────────────────────────
  function processFile(file: File) {
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
        const parsed: InternalRow<T>[] = raw.map((row, i) => {
          const rowNumber = i + 2 // header = fila 1
          const r = validateRow(row, rowNumber)
          return {
            index: rowNumber,
            raw: row,
            data: r.ok ? r.data : (r.data as T | undefined),
            errors: r.ok ? [] : r.errors,
            valid: r.ok,
          }
        })
        setRows(parsed)
        setStep('preview')
      } catch {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo leer el archivo. Verifique que sea un Excel válido.' })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) processFile(f)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) processFile(f)
  }

  // ── Importar lotes ──────────────────────────────────────────────────────
  async function handleImportar() {
    setStep('importing')
    const validRows = rows.filter(r => r.valid).map(r => r.data!) as T[]
    let total = 0
    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize)
      const { ok, error } = await onInsertBatch(batch)
      if (error) {
        notify({ variant: 'error', title: 'Error en inserción', text: error })
        setStep('preview')
        return
      }
      total += ok
    }
    setImportedCount(total)
    setStep('done')
    onImportado(total)
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <ModalPortal>
    <div data-testid="import-modal-overlay" style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>
              Importar {plural} desde Excel
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
              {step === 'upload' && 'Descarga la plantilla, complétala y sube el archivo.'}
              {step === 'preview' && `${rows.length} fila${rows.length !== 1 ? 's' : ''} — ${validCount} válida${validCount !== 1 ? 's' : ''}, ${invalidCount} con error${invalidCount !== 1 ? 'es' : ''}`}
              {step === 'importing' && `Guardando ${plural} en la base de datos…`}
              {step === 'done' && `${importedCount} ${importedCount === 1 ? entityLabel : plural} importado${importedCount === 1 ? '' : 's'} exitosamente.`}
            </p>
          </div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Cerrar">✕</button>
        </div>

        <div style={bodyStyle}>
          {optionsPanel && (step === 'upload' || step === 'preview') && (
            <div style={{ marginBottom: '20px' }}>{optionsPanel}</div>
          )}

          {step === 'upload' && (
            <UploadStep
              onPlantilla={descargarPlantilla}
              onDrop={handleDrop}
              onClickFile={() => fileInputRef.current?.click()}
              dragOver={dragOver}
              setDragOver={setDragOver}
            />
          )}

          {step === 'preview' && (
            <PreviewStep
              rows={rows}
              entityLabel={entityLabel}
              entityLabelPlural={plural}
              renderErrorRow={renderErrorRow}
              onErrores={descargarErrores}
            />
          )}

          {step === 'importing' && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div>
              <p>Guardando {validCount} {plural} en la base de datos…</p>
            </div>
          )}

          {step === 'done' && (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--at-success)' }}>
                {importedCount} {importedCount === 1 ? entityLabel : plural} importado{importedCount === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>

        <div style={footerStyle}>
          {step === 'preview' && validCount > 0 && importDisabled && importDisabledReason && (
            <span style={{ fontSize: '12px', color: 'var(--at-danger-strong)', alignSelf: 'center', marginRight: 'auto' }}>
              {importDisabledReason}
            </span>
          )}
          {step === 'preview' && validCount > 0 && (
            <button
              onClick={() => void handleImportar()}
              disabled={importDisabled}
              style={importDisabled ? { ...btnPrimary, opacity: 0.5, cursor: 'not-allowed' } : btnPrimary}
            >
              Importar {validCount} {validCount === 1 ? entityLabel : plural}
            </button>
          )}
          {step === 'done' && (
            <button onClick={onClose} style={btnPrimary}>Cerrar</button>
          )}
          {(step === 'upload' || step === 'preview') && (
            <button onClick={onClose} style={btnSecondary}>Cancelar</button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </div>
    </div>
    </ModalPortal>
  )
}

// ── Sub-componentes (memoizables si interesa) ─────────────────────────────

function UploadStep({
  onPlantilla,
  onDrop,
  onClickFile,
  dragOver,
  setDragOver,
}: {
  onPlantilla: () => void
  onDrop: (e: DragEvent) => void
  onClickFile: () => void
  dragOver: boolean
  setDragOver: (v: boolean) => void
}) {
  return (
    <div>
      <div style={uploadBannerStyle}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--at-primary-hover)', fontSize: '14px' }}>Paso 1 — Descarga la plantilla</div>
          <div style={{ fontSize: '13px', color: 'var(--at-primary)', marginTop: '2px' }}>
            Incluye encabezados y ejemplos de filas válidas.
          </div>
        </div>
        <button onClick={onPlantilla} style={btnSecondary}>📥 Descargar plantilla</button>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={onClickFile}
        style={dropZoneStyle(dragOver)}
      >
        <div style={{ fontSize: '32px', marginBottom: '10px' }}>📤</div>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--at-ink-2)' }}>
          Arrastra el archivo aquí o haz clic para seleccionar
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--at-ink-3)' }}>
          .xlsx, .xls o .csv
        </p>
      </div>
    </div>
  )
}

function PreviewStep<T>({
  rows,
  entityLabel,
  entityLabelPlural,
  renderErrorRow,
  onErrores,
}: {
  rows: InternalRow<T>[]
  entityLabel: string
  entityLabelPlural: string
  renderErrorRow?: (row: Record<string, unknown>, errors: string[]) => ReactNode
  onErrores: () => void
}) {
  const validCount = rows.filter(r => r.valid).length
  const invalidCount = rows.length - validCount
  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <div style={statBox('var(--at-success-tint)', 'var(--at-success-strong)')}>
          ✅ {validCount} {validCount === 1 ? entityLabel : entityLabelPlural} válido{validCount === 1 ? '' : 's'}
        </div>
        {invalidCount > 0 && (
          <div style={statBox('var(--at-danger-tint)', 'var(--at-danger-strong)')}>
            ❌ {invalidCount} con error{invalidCount === 1 ? '' : 'es'}
          </div>
        )}
        {invalidCount > 0 && (
          <button onClick={onErrores} style={{ ...btnSecondary, marginLeft: 'auto' }}>
            📥 Descargar errores
          </button>
        )}
      </div>

      {invalidCount > 0 && (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Filas con error:
          </div>
          <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid var(--at-danger-border)', borderRadius: '8px' }}>
            {rows.filter(r => !r.valid).slice(0, 100).map(r => (
              <div key={r.index} style={errorRowStyle}>
                {renderErrorRow
                  ? renderErrorRow(r.raw, r.errors)
                  : (
                    <>
                      <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--at-danger-strong)' }}>
                        Fila {r.index}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--at-danger-strong)' }}>
                        {r.errors.join(' · ')}
                      </div>
                    </>
                  )}
              </div>
            ))}
            {invalidCount > 100 && (
              <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--at-ink-3)' }}>
                +{invalidCount - 100} más — descarga el archivo de errores para ver todas
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizeCell(v: unknown): string | number | boolean | null | undefined {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return String(v)
}

// ── Styles ────────────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: '16px',
}
const modalStyle: CSSProperties = {
  background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '780px',
  maxHeight: '90vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
}
const headerStyle: CSSProperties = {
  padding: '24px 28px 20px', borderBottom: '1px solid var(--at-line)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const bodyStyle: CSSProperties = { padding: '24px 28px', overflowY: 'auto', flex: 1 }
const footerStyle: CSSProperties = {
  padding: '16px 28px', borderTop: '1px solid var(--at-line)',
  display: 'flex', justifyContent: 'flex-end', gap: '10px',
}
const btnPrimary: CSSProperties = {
  padding: '10px 22px', background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
  color: 'white', border: 'none', borderRadius: '8px',
  fontWeight: 600, fontSize: '14px', cursor: 'pointer',
}
const btnSecondary: CSSProperties = {
  padding: '10px 22px', background: 'var(--at-chip)', color: 'var(--at-ink-2)',
  border: '1px solid var(--at-line)', borderRadius: '8px',
  fontWeight: 600, fontSize: '14px', cursor: 'pointer',
}
const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--at-ink-3)', fontSize: '22px', lineHeight: 1, padding: '4px',
}
const uploadBannerStyle: CSSProperties = {
  marginBottom: '24px', padding: '16px 20px',
  background: 'var(--at-surface-2)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '10px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: '12px', flexWrap: 'wrap',
}
function dropZoneStyle(dragOver: boolean): CSSProperties {
  return {
    border: `2.5px dashed ${dragOver ? 'var(--at-primary)' : 'var(--at-line-strong)'}`,
    borderRadius: '12px', padding: '40px 20px', textAlign: 'center',
    cursor: 'pointer', background: dragOver ? 'var(--at-surface-2)' : 'var(--at-surface-2)',
    transition: 'all 0.15s',
  }
}
function statBox(bg: string, color: string): CSSProperties {
  return {
    padding: '10px 16px', background: bg, color, borderRadius: '8px',
    fontSize: '13px', fontWeight: 600,
  }
}
const errorRowStyle: CSSProperties = {
  padding: '10px 14px', borderBottom: '1px solid var(--at-danger-border)', background: 'var(--at-danger-tint)',
}

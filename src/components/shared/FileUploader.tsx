import { useRef, useState, type DragEvent } from 'react'
import { uploadCondominiosMedia, removeCondominiosMedia } from '../../domain/shared/storage'
import { validateFileMagic, buildUploadPath, resolveUploadContentType } from '../../lib/fileValidation'
import { useSignedUrl } from '../../lib/storageUrls'
import { SecureFileLink } from './SecureFileLink'
import { useMediaScope } from './MediaScopeContext'

const ACCEPT = 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp'
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Nombre legible de un path de storage: último segmento, sin query y sin el
 * prefijo `<timestamp>-<random>-` que `buildUploadPath` antepone para evitar
 * colisiones. Al usuario le interesa "contrato.pdf", no
 * "1785540000000-a3f9x2-contrato.pdf". Si el nombre no trae ese prefijo (subidas
 * viejas), se devuelve tal cual.
 */
export function nombreDeArchivo(path: string): string {
  const ultimo = decodeURIComponent(path.split('?')[0].split('/').pop() ?? 'archivo')
  return ultimo.replace(/^\d{10,}-[a-z0-9]{1,8}-/, '') || ultimo
}

export function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext ?? '')) return '📝'
  if (['xls', 'xlsx'].includes(ext ?? '')) return '📊'
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext ?? '')) return '🖼️'
  return '📎'
}

interface Props {
  value: string | null
  onChange: (url: string | null) => void
  folder: string
  label?: string
  accept?: string
}

export function FileUploader({ value, onChange, folder, label = 'Adjuntar documento', accept = ACCEPT }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const projectId = useMediaScope()

  // The DB value may be a legacy publicUrl (full https://...) or a bare path
  // after the S6 migration. useSignedUrl handles both transparently.
  const signedUrl = useSignedUrl(value, 'condominios-media')
  // Display name: extract from the stored value (last path segment, query-stripped).
  const fileName = value
    ? nombreDeArchivo(value)
    : null

  async function uploadFile(file: File) {
    setError(null)
    // infra:I14 — uploads must be scoped by project_id (first path segment) so
    // storage RLS isolates tenants; an unscoped path would be rejected anyway.
    if (!projectId) { setError('No se pudo determinar el proyecto. Recargá la página e intentá de nuevo.'); return }
    if (file.size > MAX_BYTES) { setError(`El archivo excede el límite de 20 MB.`); return }

    // Verify the file's actual content matches a supported document/image type.
    // Defends against renamed payloads (e.g. evil.html → evil.pdf) that the
    // HTML `accept` attribute would let through.
    setProgress(5)
    const magicCheck = await validateFileMagic(file, 'document')
    if (!magicCheck.ok) { setError(magicCheck.reason); return }

    setUploading(true)
    setProgress(10)

    const path = buildUploadPath(`${projectId}/${folder}`, file.name)

    setProgress(30)
    const { data, error: upErr } = await uploadCondominiosMedia(path, file, {
      // Magic-detected type (ignores client-spoofed file.type), refined from the
      // generic office container (zip/cfb) to the precise mime via extension so
      // it matches the bucket's allowed_mime_types.
      contentType: resolveUploadContentType(magicCheck.detected, file.name),
      upsert: false,
    })
    setProgress(80)

    if (upErr || !data) {
      setError('Error al subir el archivo.')
      setUploading(false)
      setProgress(0)
      return
    }

    // S6 phase 2: store the bare path (not the public URL). SecureImage /
    // useSignedUrl reads back via createSignedUrl on render. Legacy rows
    // with full URLs continue to work because extractBucketPath normalizes
    // either form.
    setProgress(100)
    setUploading(false)
    onChange(data.path)
    setTimeout(() => setProgress(0), 600)
  }

  async function removeFile() {
    if (!value) return
    // value may be a bare path (new) or a legacy publicUrl (old) — handle both.
    const path = value.startsWith('http') ? value.match(/condominios-media\/(.+)$/)?.[1] : value
    if (path) await removeCondominiosMedia([path])
    onChange(null)
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    uploadFile(files[0])
  }

  return (
    <div>
      {label && <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '6px', display: 'block' }}>{label}</label>}

      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--at-success-tint)', border: '1.5px solid var(--at-success-border)', borderRadius: '8px' }}>
          <span style={{ fontSize: '22px' }}>{fileIcon(fileName ?? '')}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-success-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-success)' }}>Subido</div>
          </div>
          {signedUrl && (
            <a href={signedUrl} target="_blank" rel="noreferrer"
              style={{ padding: '4px 10px', background: 'var(--at-success)', color: 'var(--at-on-status)', borderRadius: '6px', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>
              Ver
            </a>
          )}
          <button onClick={removeFile}
            style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', color: 'var(--at-danger)', cursor: 'pointer', fontSize: '13px' }}>
            ✕
          </button>
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          onClick={() => !uploading && ref.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--at-primary)' : 'var(--at-line-strong)'}`,
            borderRadius: '8px',
            padding: '16px',
            textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragging ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
            transition: 'all 0.15s',
          }}>
          {uploading ? (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '8px' }}>Subiendo…</div>
              <div style={{ height: '6px', background: 'var(--at-line)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--at-primary)', width: `${progress}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>📎</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)' }}>Arrastra o haz clic para adjuntar</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>PDF, Word, Excel · Máx. 20 MB</div>
            </>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: '11px', color: 'var(--at-danger)', marginTop: '4px' }}>{error}</div>}

      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)} />
    </div>
  )
}

// ── Múltiple ─────────────────────────────────────────────────────────────────
// Versión multi-archivo de FileUploader, para los hilos de conversación del
// portal (un mensaje puede llevar varios adjuntos). Misma validación por magic
// bytes que la versión simple: el `accept` del <input> es solo una comodidad de
// la UI y un usuario autenticado puede saltárselo llamando a Storage directo.
//
// El tope es 10 MB —no los 20 de la versión simple— porque es el
// `file_size_limit` real del bucket (20260729000400). Avisar antes de subir da
// mejor error que el 413 opaco de Storage.
const MAX_BYTES_MULTI = 10 * 1024 * 1024

interface MultiProps {
  values: string[]
  onChange: (paths: string[]) => void
  folder: string
  label?: string
  maxFiles?: number
  accept?: string
}

export function MultiFileUploader({
  values, onChange, folder, label = 'Adjuntar documentos', maxFiles = 4, accept = ACCEPT,
}: MultiProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const projectId = useMediaScope()

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    // infra:I14 — el path va scopeado por project_id o la policy de storage lo
    // rechaza; fallar acá da un mensaje entendible.
    if (!projectId) { setError('No se pudo determinar el proyecto. Recargue la página e intente de nuevo.'); return }
    const aSubir = Array.from(files).slice(0, maxFiles - values.length)
    if (aSubir.length === 0) { setError(`Máximo ${maxFiles} archivos`); return }

    setUploading(true)
    try {
      const nuevos: string[] = []
      for (const file of aSubir) {
        if (file.size > MAX_BYTES_MULTI) { setError(`"${file.name}" excede el límite de 10 MB.`); break }
        const magic = await validateFileMagic(file, 'document')
        if (!magic.ok) { setError(`"${file.name}": ${magic.reason}`); break }
        const path = buildUploadPath(`${projectId}/${folder}`, file.name)
        const { data, error: upErr } = await uploadCondominiosMedia(path, file, {
          contentType: resolveUploadContentType(magic.detected, file.name),
          upsert: false,
        })
        if (upErr || !data) { setError(`No se pudo subir "${file.name}".`); break }
        nuevos.push(data.path)
      }
      if (nuevos.length > 0) onChange([...values, ...nuevos])
    } finally {
      setUploading(false)
    }
  }

  async function quitar(path: string) {
    const real = path.startsWith('http') ? path.match(/condominios-media\/(.+)$/)?.[1] : path
    if (real) await removeCondominiosMedia([real])
    onChange(values.filter(p => p !== path))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragging(false)
    void handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 6 }}>
        {label} <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>({values.length}/{maxFiles})</span>
      </label>

      {values.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {values.map(path => {
            const nombre = nombreDeArchivo(path)
            return (
              <div key={path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 8 }}>
                <span style={{ fontSize: 17 }}>{fileIcon(nombre)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--at-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</span>
                <button onClick={() => quitar(path)} aria-label={`Quitar ${nombre}`}
                  style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 6, color: 'var(--at-danger)', cursor: 'pointer', fontSize: 12 }}>
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      {values.length < maxFiles && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && ref.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--at-primary)' : 'var(--at-line-strong)'}`,
            borderRadius: 8, padding: '12px', textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragging ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
          }}>
          {uploading ? (
            <div style={{ fontSize: 12, color: 'var(--at-primary)' }}>Subiendo…</div>
          ) : (
            <>
              <span style={{ fontSize: 18 }}>📎</span>
              <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>PDF, Word o Excel · Máx. 10 MB</div>
            </>
          )}
        </div>
      )}

      <input ref={ref} type="file" accept={accept} multiple style={{ display: 'none' }}
        onChange={e => { void handleFiles(e.target.files); e.target.value = '' }} />

      {error && <div style={{ fontSize: 11, color: 'var(--at-danger)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Lista de adjuntos ya guardados, como chips que abren el archivo firmado.
 * Es a los documentos lo que <ImageGallery> es a las fotos.
 */
export function ListaAdjuntos({ paths }: { paths: string[] }) {
  if (!paths || paths.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {paths.map(path => {
        const nombre = nombreDeArchivo(path)
        return (
          <SecureFileLink key={path} src={path}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 8, textDecoration: 'none', color: 'var(--at-ink-2)' }}>
            <span style={{ fontSize: 16 }}>{fileIcon(nombre)}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</span>
            <span style={{ fontSize: 11, color: 'var(--at-primary)', fontWeight: 700, flexShrink: 0 }}>Abrir</span>
          </SecureFileLink>
        )
      })}
    </div>
  )
}

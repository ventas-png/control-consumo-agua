import { useRef, useState } from 'react'
import { uploadCondominiosMedia, removeCondominiosMedia } from '../../domain/shared/storage'
import { validateFileMagic, buildUploadPath, resolveUploadContentType } from '../../lib/fileValidation'
import { useSignedUrl } from '../../lib/storageUrls'
import { useMediaScope } from './MediaScopeContext'

const ACCEPT = 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/webp'
const MAX_BYTES = 20 * 1024 * 1024

function fileIcon(name: string) {
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
    ? decodeURIComponent(value.split('?')[0].split('/').pop() ?? 'archivo')
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

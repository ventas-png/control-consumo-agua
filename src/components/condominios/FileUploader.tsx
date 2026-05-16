import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { validateFileMagic, buildUploadPath } from '../../lib/fileValidation'
import { useSignedUrl } from '../../lib/storageUrls'

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

  // The DB value may be a legacy publicUrl (full https://...) or a bare path
  // after the S6 migration. useSignedUrl handles both transparently.
  const signedUrl = useSignedUrl(value, 'condominios-media')
  // Display name: extract from the stored value (last path segment, query-stripped).
  const fileName = value
    ? decodeURIComponent(value.split('?')[0].split('/').pop() ?? 'archivo')
    : null

  async function uploadFile(file: File) {
    setError(null)
    if (file.size > MAX_BYTES) { setError(`El archivo excede el límite de 20 MB.`); return }

    // Verify the file's actual content matches a supported document/image type.
    // Defends against renamed payloads (e.g. evil.html → evil.pdf) that the
    // HTML `accept` attribute would let through.
    setProgress(5)
    const magicCheck = await validateFileMagic(file, 'document')
    if (!magicCheck.ok) { setError(magicCheck.reason); return }

    setUploading(true)
    setProgress(10)

    const path = buildUploadPath(folder, file.name)

    setProgress(30)
    const { data, error: upErr } = await supabase.storage
      .from('condominios-media')
      .upload(path, file, {
        // Use the magic-detected type — ignores any client-spoofed file.type
        contentType: magicCheck.detected,
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
    if (path) await supabase.storage.from('condominios-media').remove([path])
    onChange(null)
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    uploadFile(files[0])
  }

  return (
    <div>
      {label && <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px', display: 'block' }}>{label}</label>}

      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '8px' }}>
          <span style={{ fontSize: '22px' }}>{fileIcon(fileName ?? '')}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#166534', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
            <div style={{ fontSize: '11px', color: '#4ade80' }}>Subido</div>
          </div>
          {signedUrl && (
            <a href={signedUrl} target="_blank" rel="noreferrer"
              style={{ padding: '4px 10px', background: '#16a34a', color: '#fff', borderRadius: '6px', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>
              Ver
            </a>
          )}
          <button onClick={removeFile}
            style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', color: '#dc2626', cursor: 'pointer', fontSize: '13px' }}>
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
            border: `2px dashed ${dragging ? '#0ea5e9' : '#cbd5e1'}`,
            borderRadius: '8px',
            padding: '16px',
            textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragging ? '#f0f9ff' : '#f8fafc',
            transition: 'all 0.15s',
          }}>
          {uploading ? (
            <div>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>Subiendo…</div>
              <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#0ea5e9', width: `${progress}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>📎</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Arrastra o haz clic para adjuntar</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>PDF, Word, Excel · Máx. 20 MB</div>
            </>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>{error}</div>}

      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)} />
    </div>
  )
}

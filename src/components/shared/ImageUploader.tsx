import { useRef, useState, type DragEvent} from 'react'
import { uploadCondominiosMedia, removeCondominiosMedia } from '../../domain/shared/storage'
import { validateFileMagic, buildUploadPath } from '../../lib/fileValidation'
import { SecureImage } from './SecureImage'
import { useMediaScope } from './MediaScopeContext'

const MAX_DIMENSION = 1280
const QUALITY = 0.82

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compresión fallida')), 'image/jpeg', QUALITY)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
    img.src = url
  })
}

// ── Single ────────────────────────────────────────────────────────────────────

interface SingleProps {
  value: string | null
  onChange: (url: string | null) => void
  folder: string
  label?: string
  maxSizeMB?: number
  capture?: boolean
}

export function ImageUploader({ value, onChange, folder, label = 'Foto', maxSizeMB = 5, capture = false }: SingleProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const sessionUploadsRef = useRef<Set<string>>(new Set())
  const projectId = useMediaScope()

  async function handleFile(file: File) {
    setError(null)
    // infra:I14 — uploads must be scoped by project_id (first path segment) so
    // storage RLS isolates tenants. Without it the path would be unscoped and
    // the storage policy would reject the insert; fail loudly here instead.
    if (!projectId) { setError('No se pudo determinar el proyecto. Recargá la página e intentá de nuevo.'); return }
    if (file.size > maxSizeMB * 1024 * 1024) { setError(`Máximo ${maxSizeMB} MB`); return }
    // Magic-byte validation defends against payloads renamed to .png/.jpg.
    const magicCheck = await validateFileMagic(file, 'image')
    if (!magicCheck.ok) { setError(magicCheck.reason); return }
    setUploading(true)
    try {
      const blob = await compressImage(file)
      // We always re-encode to JPEG via canvas (compressImage), so forcing
      // .jpg + image/jpeg is safe regardless of input format.
      const path = buildUploadPath(`${projectId}/${folder}`, file.name, 'jpg')
      const { error: upErr } = await uploadCondominiosMedia(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (upErr) { setError(upErr); return }
      // S6 phase 2: persist the bare path; SecureImage signs at render time.
      // Delete previous photo only if it was uploaded in this same session.
      if (value && sessionUploadsRef.current.has(value)) {
        const prevPath = value.startsWith('http') ? value.match(/condominios-media\/(.+)$/)?.[1] : value
        if (prevPath) await removeCondominiosMedia([prevPath])
      }
      sessionUploadsRef.current.add(path)
      onChange(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir')
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleRemove() {
    if (!value) return
    const path = value.startsWith('http') ? value.match(/condominios-media\/(.+)$/)?.[1] : value
    if (path) await removeCondominiosMedia([path])
    sessionUploadsRef.current.delete(value)
    onChange(null)
  }

  return (
    <div style={{ width: '100%' }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 6 }}>{label}</label>
      {value ? (
        <div style={{ position: 'relative', width: '100%', paddingBottom: '75%' }}>
          <SecureImage src={value} alt="preview"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10, border: '2px solid var(--at-line)', display: 'block' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <button
            onClick={handleRemove}
            style={{ position: 'absolute', top: -8, right: -8, zIndex: 1, width: 24, height: 24, borderRadius: '50%', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
            ×
          </button>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          style={{ width: '100%', paddingBottom: '75%', position: 'relative', border: `2px dashed ${dragOver ? 'var(--at-primary)' : 'var(--at-line-strong)'}`, borderRadius: 10, cursor: 'pointer', background: dragOver ? 'var(--at-primary-tint)' : 'var(--at-surface-2)', transition: 'all 0.15s' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {uploading
              ? <div style={{ fontSize: 11, color: 'var(--at-primary)' }}>Subiendo…</div>
              : <>
                  <span style={{ fontSize: 24 }}>📷</span>
                  <span style={{ fontSize: 10, color: 'var(--at-ink-3)', textAlign: 'center', lineHeight: 1.3 }}>
                    {capture ? 'Tomar foto' : 'Clic o arrastra imagen'}
                  </span>
                </>}
          </div>
        </div>
      )}
      <input ref={inputRef} type="file" style={{ display: 'none' }}
        accept={capture ? 'image/*;capture=camera' : 'image/*'}
        {...(capture ? { capture: 'environment' } : {})}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
      {error && <div style={{ fontSize: 11, color: 'var(--at-danger)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

// ── Multiple ──────────────────────────────────────────────────────────────────

interface MultiProps {
  values: string[]
  onChange: (urls: string[]) => void
  folder: string
  label?: string
  maxFiles?: number
  maxSizeMB?: number
  capture?: boolean
}

export function MultiImageUploader({ values, onChange, folder, label = 'Fotos', maxFiles = 10, maxSizeMB = 5, capture = false }: MultiProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const projectId = useMediaScope()

  async function handleFiles(files: FileList) {
    setError(null)
    // infra:I14 — scope uploads by project_id (see ImageUploader.handleFile).
    if (!projectId) { setError('No se pudo determinar el proyecto. Recargá la página e intentá de nuevo.'); return }
    const toUpload = Array.from(files).slice(0, maxFiles - values.length)
    if (toUpload.length === 0) { setError(`Máximo ${maxFiles} fotos`); return }
    for (const file of toUpload) {
      if (file.size > maxSizeMB * 1024 * 1024) { setError(`Máximo ${maxSizeMB} MB por archivo`); return }
      const magicCheck = await validateFileMagic(file, 'image')
      if (!magicCheck.ok) { setError(magicCheck.reason); return }
    }
    setUploading(true)
    try {
      const newUrls: string[] = []
      for (const file of toUpload) {
        const blob = await compressImage(file)
        const path = buildUploadPath(`${projectId}/${folder}`, file.name, 'jpg')
        const { error: upErr } = await uploadCondominiosMedia(path, blob, { contentType: 'image/jpeg' })
        if (upErr) { setError(upErr); break }
        // S6 phase 2: persist the bare path; SecureImage signs at render time.
        newUrls.push(path)
      }
      if (newUrls.length > 0) onChange([...values, ...newUrls])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(url: string) {
    const path = url.startsWith('http') ? url.match(/condominios-media\/(.+)$/)?.[1] : url
    if (path) await removeCondominiosMedia([path])
    onChange(values.filter(u => u !== url))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 6 }}>
        {label} <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>({values.length}/{maxFiles})</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
        {values.map(url => (
          <div key={url} style={{ position: 'relative', paddingBottom: '75%' }}>
            <SecureImage src={url} alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1.5px solid var(--at-line)', display: 'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <button
              onClick={() => handleRemove(url)}
              style={{ position: 'absolute', top: -7, right: -7, zIndex: 1, width: 20, height: 20, borderRadius: '50%', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ×
            </button>
          </div>
        ))}
        {values.length < maxFiles && (
          <div
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => inputRef.current?.click()}
            style={{ paddingBottom: '75%', position: 'relative', border: `2px dashed ${dragOver ? 'var(--at-primary)' : 'var(--at-line-strong)'}`, borderRadius: 8, cursor: 'pointer', background: dragOver ? 'var(--at-primary-tint)' : 'var(--at-surface-2)' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {uploading
                ? <span style={{ fontSize: 10, color: 'var(--at-primary)' }}>…</span>
                : <>
                    <span style={{ fontSize: 20 }}>{capture ? '📷' : '+'}</span>
                    {capture && <span style={{ fontSize: 9, color: 'var(--at-ink-3)', marginTop: 2 }}>Cámara</span>}
                  </>}
            </div>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" style={{ display: 'none' }}
        accept={capture ? 'image/*;capture=camera' : 'image/*'}
        {...(capture ? { capture: 'environment' } : { multiple: true })}
        onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }} />
      {error && <div style={{ fontSize: 11, color: 'var(--at-danger)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

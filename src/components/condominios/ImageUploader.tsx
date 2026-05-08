import { useRef, useState, type DragEvent} from 'react'
import { supabase } from '../../lib/supabase'

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

  async function handleFile(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) { setError('Solo se aceptan imágenes'); return }
    if (file.size > maxSizeMB * 1024 * 1024) { setError(`Máximo ${maxSizeMB} MB`); return }
    setUploading(true)
    try {
      const blob = await compressImage(file)
      const ext = 'jpg'
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('condominios-media').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (upErr) { setError(upErr.message); return }
      const { data } = supabase.storage.from('condominios-media').getPublicUrl(path)
      // Delete previous photo only if it was uploaded in this same session (not a pre-existing record)
      if (value && sessionUploadsRef.current.has(value)) {
        const match = value.match(/condominios-media\/(.+)$/)
        if (match) await supabase.storage.from('condominios-media').remove([match[1]])
      }
      sessionUploadsRef.current.add(data.publicUrl)
      onChange(data.publicUrl)
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
    const match = value.match(/condominios-media\/(.+)$/)
    if (match) await supabase.storage.from('condominios-media').remove([match[1]])
    sessionUploadsRef.current.delete(value)
    onChange(null)
  }

  return (
    <div style={{ width: '100%' }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>{label}</label>
      {value ? (
        <div style={{ position: 'relative', width: '100%', paddingBottom: '75%' }}>
          <img src={value} alt="preview"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10, border: '2px solid #e2e8f0', display: 'block' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <button
            onClick={handleRemove}
            style={{ position: 'absolute', top: -8, right: -8, zIndex: 1, width: 24, height: 24, borderRadius: '50%', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
            ×
          </button>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          style={{ width: '100%', paddingBottom: '75%', position: 'relative', border: `2px dashed ${dragOver ? '#0ea5e9' : '#d1d5db'}`, borderRadius: 10, cursor: 'pointer', background: dragOver ? '#f0f9ff' : '#f8fafc', transition: 'all 0.15s' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {uploading
              ? <div style={{ fontSize: 11, color: '#0ea5e9' }}>Subiendo…</div>
              : <>
                  <span style={{ fontSize: 24 }}>📷</span>
                  <span style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', lineHeight: 1.3 }}>
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
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
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

  async function handleFiles(files: FileList) {
    setError(null)
    const toUpload = Array.from(files).slice(0, maxFiles - values.length)
    if (toUpload.length === 0) { setError(`Máximo ${maxFiles} fotos`); return }
    for (const file of toUpload) {
      if (!file.type.startsWith('image/')) { setError('Solo se aceptan imágenes'); return }
      if (file.size > maxSizeMB * 1024 * 1024) { setError(`Máximo ${maxSizeMB} MB por archivo`); return }
    }
    setUploading(true)
    try {
      const newUrls: string[] = []
      for (const file of toUpload) {
        const blob = await compressImage(file)
        const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        const { error: upErr } = await supabase.storage.from('condominios-media').upload(path, blob, { contentType: 'image/jpeg' })
        if (upErr) { setError(upErr.message); break }
        const { data } = supabase.storage.from('condominios-media').getPublicUrl(path)
        newUrls.push(data.publicUrl)
      }
      if (newUrls.length > 0) onChange([...values, ...newUrls])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(url: string) {
    const match = url.match(/condominios-media\/(.+)$/)
    if (match) await supabase.storage.from('condominios-media').remove([match[1]])
    onChange(values.filter(u => u !== url))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
        {label} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({values.length}/{maxFiles})</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
        {values.map(url => (
          <div key={url} style={{ position: 'relative', paddingBottom: '75%' }}>
            <img src={url} alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1.5px solid #e2e8f0', display: 'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <button
              onClick={() => handleRemove(url)}
              style={{ position: 'absolute', top: -7, right: -7, zIndex: 1, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            style={{ paddingBottom: '75%', position: 'relative', border: `2px dashed ${dragOver ? '#0ea5e9' : '#d1d5db'}`, borderRadius: 8, cursor: 'pointer', background: dragOver ? '#f0f9ff' : '#f8fafc' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {uploading
                ? <span style={{ fontSize: 10, color: '#0ea5e9' }}>…</span>
                : <>
                    <span style={{ fontSize: 20 }}>{capture ? '📷' : '+'}</span>
                    {capture && <span style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>Cámara</span>}
                  </>}
            </div>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" style={{ display: 'none' }}
        accept={capture ? 'image/*;capture=camera' : 'image/*'}
        {...(capture ? { capture: 'environment' } : { multiple: true })}
        onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }} />
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

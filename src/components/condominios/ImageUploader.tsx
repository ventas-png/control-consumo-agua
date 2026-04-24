import { useRef, useState } from 'react'
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
}

export function ImageUploader({ value, onChange, folder, label = 'Foto', maxSizeMB = 5 }: SingleProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

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
      onChange(data.publicUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir')
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleRemove() {
    if (!value) return
    // Extract path from public URL
    const match = value.match(/condominios-media\/(.+)$/)
    if (match) await supabase.storage.from('condominios-media').remove([match[1]])
    onChange(null)
  }

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>{label}</label>
      {value ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img src={value} alt="preview" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, border: '2px solid #e2e8f0', display: 'block' }} />
          <button
            onClick={handleRemove}
            style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
            ×
          </button>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          style={{ width: 120, height: 90, border: `2px dashed ${dragOver ? '#0ea5e9' : '#d1d5db'}`, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: dragOver ? '#f0f9ff' : '#f8fafc', transition: 'all 0.15s' }}>
          {uploading
            ? <div style={{ fontSize: 11, color: '#0ea5e9' }}>Subiendo…</div>
            : <>
                <span style={{ fontSize: 22, marginBottom: 2 }}>📷</span>
                <span style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', lineHeight: 1.3 }}>Clic o arrastra<br />imagen aquí</span>
              </>}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
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
}

export function MultiImageUploader({ values, onChange, folder, label = 'Fotos', maxFiles = 6, maxSizeMB = 5 }: MultiProps) {
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

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
        {label} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({values.length}/{maxFiles})</span>
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {values.map(url => (
          <div key={url} style={{ position: 'relative' }}>
            <img src={url} alt="" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8, border: '1.5px solid #e2e8f0', display: 'block' }} />
            <button
              onClick={() => handleRemove(url)}
              style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            style={{ width: 80, height: 60, border: `2px dashed ${dragOver ? '#0ea5e9' : '#d1d5db'}`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: dragOver ? '#f0f9ff' : '#f8fafc', flexShrink: 0 }}>
            {uploading
              ? <span style={{ fontSize: 10, color: '#0ea5e9' }}>…</span>
              : <span style={{ fontSize: 20 }}>+</span>}
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }} />
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

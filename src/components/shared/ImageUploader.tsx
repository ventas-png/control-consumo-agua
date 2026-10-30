import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { isNative } from '../../lib/platform'
import { uploadCondominiosMedia, removeCondominiosMedia, uploadMedia, removeMedia } from '../../domain/shared/storage'
import { BUCKET_MEDIA } from '../../domain/shared/buckets'
import { validateFileMagic, buildUploadPath } from '../../lib/fileValidation'
import { SecureImage } from './SecureImage'
import { useMediaScope } from './MediaScopeContext'
// El pipeline de compresión lo comparte la captura del marcaje de turno, que no
// usa este uploader pero tiene que producir el mismo JPEG. Ver lib/imageCompress.
import { compressImage } from '../../lib/imageCompress'

// ── Single ────────────────────────────────────────────────────────────────────

interface SingleProps {
  value: string | null
  onChange: (url: string | null) => void
  folder: string
  label?: string
  maxSizeMB?: number
  capture?: boolean
  /**
   * Por defecto, quitar la foto la borra del bucket al instante. Con `false`
   * sólo la saca del valor y el que llama decide al guardar o cancelar (una
   * fila guardada nunca debe apuntar a un archivo ya borrado).
   */
  borrarAlQuitar?: boolean
  /** Avisa cuándo empieza y termina una subida, para no guardar ni cerrar a mitad. */
  onSubiendo?: (subiendo: boolean) => void
}

export function ImageUploader({ value, onChange, folder, label = 'Foto', maxSizeMB = 5, capture = false, borrarAlQuitar = true, onSubiendo }: SingleProps) {
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
    onSubiendo?.(true)
    try {
      const blob = await compressImage(file)
      // We always re-encode to JPEG via canvas (compressImage), so forcing
      // .jpg + image/jpeg is safe regardless of input format.
      const path = buildUploadPath(`${projectId}/${folder}`, file.name, 'jpg')
      const { error: upErr } = await uploadCondominiosMedia(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (upErr) { setError(upErr); return }
      // S6 phase 2: persist the bare path; SecureImage signs at render time.
      // Delete previous photo only if it was uploaded in this same session.
      if (value && borrarAlQuitar && sessionUploadsRef.current.has(value)) {
        const prevPath = value.startsWith('http') ? value.match(/condominios-media\/(.+)$/)?.[1] : value
        if (prevPath) await removeCondominiosMedia([prevPath])
      }
      sessionUploadsRef.current.add(path)
      onChange(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir')
    } finally {
      setUploading(false)
      onSubiendo?.(false)
    }
  }

  // En nativo abrimos la cámara/galería del sistema (@capacitor/camera) y reusamos
  // handleFile; en web seguimos con el <input type="file"> (que ya soporta captura).
  async function openPicker() {
    if (!isNative()) { inputRef.current?.click(); return }
    const { takeNativePhoto } = await import('../../lib/nativeCamera')
    const file = await takeNativePhoto(capture)
    if (file) handleFile(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleRemove() {
    if (!value) return
    const path = value.startsWith('http') ? value.match(/condominios-media\/(.+)$/)?.[1] : value
    sessionUploadsRef.current.delete(value)
    onChange(null)
    if (path && borrarAlQuitar) await removeCondominiosMedia([path])
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
            type="button"
            aria-label="Quitar foto"
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
          onClick={openPicker}
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
  /**
   * Bucket destino. Por defecto `condominios-media`, que autoriza por proyecto.
   * Las evidencias de recepción pasan `recepcion-evidencias`, cuyo aislamiento
   * es por pieza/unidad (20260831000000).
   */
  bucket?: string
  /**
   * Por defecto, quitar una foto la borra del bucket al instante. Con `false`
   * sólo la saca de la lista y el que llama decide al guardar o cancelar (las
   * minutas: una fila guardada nunca debe apuntar a un archivo ya borrado).
   */
  borrarAlQuitar?: boolean
  /** Avisa cuándo empieza y termina una subida, para no guardar ni cerrar a mitad. */
  onSubiendo?: (subiendo: boolean) => void
}

export function MultiImageUploader({ values, onChange, folder, label = 'Fotos', maxFiles = 10, maxSizeMB = 5, capture = false, bucket = BUCKET_MEDIA, borrarAlQuitar = true, onSubiendo }: MultiProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const projectId = useMediaScope()
  // La lista vigente, no la del render en que empezó la subida o se tocó la ✕:
  // con dos acciones seguidas, la segunda pisaba a la primera con una lista vieja.
  const valuesRef = useRef(values)
  valuesRef.current = values
  // Una subida a la vez: soltar otra encima pisaba la lista y apagaba
  // `onSubiendo` antes de tiempo. Ref, no estado: el render todavía no se enteró.
  const subiendoRef = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const enfocarRef = useRef<number | null>(null)
  const ultimoQuitarRef = useRef(-Infinity)
  useEffect(() => {
    const i = enfocarRef.current
    if (i === null || !gridRef.current) return
    enfocarRef.current = null
    // Tras quitar con el teclado (o llenar el cupo desde «agregar»), el foco va
    // a la ✕ que ocupó su lugar, a la anterior o a «agregar»; nunca a <body>.
    const quitar = gridRef.current.querySelectorAll<HTMLElement>('.at-foto-quitar')
    const destino = quitar[Math.min(i, quitar.length - 1)] ?? gridRef.current.querySelector<HTMLElement>('.at-foto-agregar')
    destino?.focus()
  }, [values])

  async function handleFiles(files: FileList) {
    if (subiendoRef.current) { setError('Espera a que termine la subida en curso.'); return }
    setError(null)
    // infra:I14 — scope uploads by project_id (see ImageUploader.handleFile).
    if (!projectId) { setError('No se pudo determinar el proyecto. Recargá la página e intentá de nuevo.'); return }
    const toUpload = Array.from(files).slice(0, maxFiles - valuesRef.current.length)
    if (toUpload.length === 0) { setError(`Máximo ${maxFiles} fotos`); return }
    subiendoRef.current = true
    setUploading(true)
    onSubiendo?.(true)
    try {
      for (const file of toUpload) {
        if (file.size > maxSizeMB * 1024 * 1024) { setError(`Máximo ${maxSizeMB} MB por archivo`); return }
        const magicCheck = await validateFileMagic(file, 'image')
        if (!magicCheck.ok) { setError(magicCheck.reason); return }
      }
      const newUrls: string[] = []
      for (const file of toUpload) {
        const blob = await compressImage(file)
        const path = buildUploadPath(`${projectId}/${folder}`, file.name, 'jpg')
        // upsert:false explícito: en `recepcion-evidencias` no hay policy de
        // UPDATE (sustituir una prueba no es una operación que exista), así que
        // un upsert fallaría en vez de sobrescribir.
        const { error: upErr } = await uploadMedia(bucket, path, blob, { contentType: 'image/jpeg', upsert: false })
        if (upErr) { setError(upErr); break }
        // S6 phase 2: persist the bare path; SecureImage signs at render time.
        newUrls.push(path)
      }
      if (newUrls.length > 0) {
        const lista = [...valuesRef.current, ...newUrls]
        // Con el cupo lleno «agregar» desaparece: si tenía el foco, pasa a la última ✕.
        if (lista.length >= maxFiles && gridRef.current?.querySelector('.at-foto-agregar') === document.activeElement) enfocarRef.current = lista.length - 1
        onChange(lista)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir')
    } finally {
      subiendoRef.current = false
      setUploading(false)
      onSubiendo?.(false)
    }
  }

  async function handleRemove(url: string, e: MouseEvent<HTMLButtonElement>) {
    // El segundo clic de un doble clic (o doble toque) cae sobre la ✕ de la foto
    // que acaba de ocupar el lugar, y la borraba también. Sólo con puntero: con
    // el teclado (detail 0) se quitan seguidas a propósito.
    if (e.detail > 0 && e.timeStamp - ultimoQuitarRef.current < 500) return
    ultimoQuitarRef.current = e.timeStamp
    const lista = valuesRef.current
    if (e.currentTarget === document.activeElement) enfocarRef.current = Math.max(0, lista.indexOf(url))
    // Primero sale de la lista y después se borra: al revés, un «Guardar» en el
    // medio guardaba la ruta de un archivo que se borraba un instante después.
    onChange(lista.filter(u => u !== url))
    const path = url.startsWith('http') ? url.match(/condominios-media\/(.+)$/)?.[1] : url
    if (path && borrarAlQuitar) await removeMedia(bucket, [path])
  }

  // Nativo: una foto por toque desde la cámara/galería del sistema, envuelta en un
  // FileList para reusar handleFiles sin duplicar validación/subida.
  async function openPicker() {
    if (subiendoRef.current) return
    if (!isNative()) { inputRef.current?.click(); return }
    const { takeNativePhoto } = await import('../../lib/nativeCamera')
    const file = await takeNativePhoto(capture)
    if (!file) return
    const dt = new DataTransfer()
    dt.items.add(file)
    handleFiles(dt.files)
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
      <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
        {values.map((url, i) => (
          <div key={url} style={{ position: 'relative', paddingBottom: '75%' }}>
            <SecureImage src={url} bucket={bucket} alt={`Foto ${i + 1}`}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1.5px solid var(--at-line)', display: 'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <button
              type="button"
              className="at-foto-quitar"
              aria-label={`Quitar foto ${i + 1} de ${values.length}`}
              onClick={e => void handleRemove(url, e)}
              style={{ position: 'absolute', top: -7, right: -7, zIndex: 1, width: 20, height: 20, borderRadius: '50%', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ×
            </button>
          </div>
        ))}
        {values.length < maxFiles && (
          <div
            role="button"
            tabIndex={0}
            className="at-foto-agregar"
            aria-label={`${label}: agregar${capture ? ' con la cámara' : ''} (${values.length} de ${maxFiles})`}
            aria-disabled={uploading || undefined}
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={openPicker}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openPicker() } }}
            style={{ paddingBottom: '75%', position: 'relative', border: `2px dashed ${dragOver ? 'var(--at-primary)' : 'var(--at-line-strong)'}`, borderRadius: 8, cursor: uploading ? 'default' : 'pointer', background: dragOver ? 'var(--at-primary-tint)' : 'var(--at-surface-2)' }}>
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
      {/* El «…» de la casilla no le dice nada a un lector de pantalla. */}
      <span role="status" style={srOnly}>{uploading ? 'Subiendo foto…' : ''}</span>
      <input ref={inputRef} type="file" style={{ display: 'none' }}
        accept={capture ? 'image/*;capture=camera' : 'image/*'}
        {...(capture ? { capture: 'environment' } : { multiple: true })}
        onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }} />
      {error && <div role="alert" style={{ fontSize: 11, color: 'var(--at-danger)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { SecureImage } from './SecureImage'
import { ModalPortal } from './ModalPortal'

interface Props {
  urls: string[]
  maxVisible?: number
}

export function ImageGallery({ urls, maxVisible = 4 }: Props) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Quién abrió la foto, para devolverle el foco al cerrarla.
  const origenRef = useRef<HTMLElement | null>(null)
  const abierto = lightbox !== null
  useEffect(() => {
    if (abierto) { dialogRef.current?.focus(); return }
    origenRef.current?.focus()
    origenRef.current = null
  }, [abierto])

  if (!urls || urls.length === 0) return null

  const visible = urls.slice(0, maxVisible)
  const extra = urls.length - maxVisible

  function prev() { setLightbox(i => (i! > 0 ? i! - 1 : urls.length - 1)) }
  function next() { setLightbox(i => (i! < urls.length - 1 ? i! + 1 : 0)) }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
    else if (e.key === 'Escape') {
      // Escape cierra sólo la foto: el modal que contiene la galería escucha
      // Escape en `document` e ignora los eventos ya atendidos.
      e.preventDefault()
      e.stopPropagation()
      setLightbox(null)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {visible.map((url, i) => (
          <button key={url} type="button" className="at-galeria-miniatura"
            aria-label={`Ver foto ${i + 1} de ${urls.length}${i === maxVisible - 1 && extra > 0 ? ` (y ${extra} más)` : ''}`}
            onClick={e => { origenRef.current = e.currentTarget; setLightbox(i) }}
            style={{ position: 'relative', cursor: 'zoom-in', flexShrink: 0, padding: 0, border: 'none', background: 'none', borderRadius: 7, display: 'block' }}>
            <SecureImage
              src={url}
              alt=""
              style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 7, border: '1.5px solid var(--at-line)', display: 'block' }}
            />
            {i === maxVisible - 1 && extra > 0 && (
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'white', fontWeight: 700, fontSize: 13 }}>+{extra}</span>
              </div>
            )}
          </button>
        ))}
      </div>

      {lightbox !== null && (
        <ModalPortal>
        <div
          ref={dialogRef}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}
          onClick={() => setLightbox(null)}
          onKeyDown={onKeyDown}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Foto ${lightbox + 1} de ${urls.length}`}>
          {/* Close */}
          <button
            type="button"
            aria-label="Cerrar foto"
            onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 10, right: 12, minWidth: 44, minHeight: 44, background: 'none', border: 'none', color: 'white', fontSize: 28, cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>

          {/* Prev */}
          {urls.length > 1 && (
            <button
              type="button"
              aria-label="Foto anterior"
              onClick={e => { e.stopPropagation(); prev() }}
              style={{ position: 'absolute', left: 12, minWidth: 44, minHeight: 44, background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', fontSize: 22, borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>
              ‹
            </button>
          )}

          {/* Image */}
          <SecureImage
            src={urls[lightbox]}
            alt={`foto ${lightbox + 1}`}
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '88vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
          />

          {/* Next */}
          {urls.length > 1 && (
            <button
              type="button"
              aria-label="Foto siguiente"
              onClick={e => { e.stopPropagation(); next() }}
              style={{ position: 'absolute', right: 12, minWidth: 44, minHeight: 44, background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', fontSize: 22, borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>
              ›
            </button>
          )}

          {/* Counter */}
          <div aria-hidden="true" style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
            {lightbox + 1} / {urls.length}
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  )
}

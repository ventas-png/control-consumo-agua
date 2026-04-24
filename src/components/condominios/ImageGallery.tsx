import { useState } from 'react'

interface Props {
  urls: string[]
  maxVisible?: number
}

export function ImageGallery({ urls, maxVisible = 4 }: Props) {
  const [lightbox, setLightbox] = useState<number | null>(null)

  if (!urls || urls.length === 0) return null

  const visible = urls.slice(0, maxVisible)
  const extra = urls.length - maxVisible

  function prev() { setLightbox(i => (i! > 0 ? i! - 1 : urls.length - 1)) }
  function next() { setLightbox(i => (i! < urls.length - 1 ? i! + 1 : 0)) }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
    else if (e.key === 'Escape') setLightbox(null)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {visible.map((url, i) => (
          <div key={url} onClick={() => setLightbox(i)} style={{ position: 'relative', cursor: 'zoom-in', flexShrink: 0 }}>
            <img
              src={url}
              alt={`foto ${i + 1}`}
              style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 7, border: '1.5px solid #e2e8f0', display: 'block' }}
            />
            {i === maxVisible - 1 && extra > 0 && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>+{extra}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {lightbox !== null && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setLightbox(null)}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="dialog"
          aria-modal="true">
          {/* Close */}
          <button
            onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 18, right: 22, background: 'none', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', lineHeight: 1 }}>
            ×
          </button>

          {/* Prev */}
          {urls.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); prev() }}
              style={{ position: 'absolute', left: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 22, borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>
              ‹
            </button>
          )}

          {/* Image */}
          <img
            src={urls[lightbox]}
            alt={`foto ${lightbox + 1}`}
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '88vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
          />

          {/* Next */}
          {urls.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); next() }}
              style={{ position: 'absolute', right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 22, borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>
              ›
            </button>
          )}

          {/* Counter */}
          <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
            {lightbox + 1} / {urls.length}
          </div>
        </div>
      )}
    </>
  )
}

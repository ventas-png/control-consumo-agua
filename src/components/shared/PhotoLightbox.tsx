// Lightbox que baja la foto de un registro de lectura bajo demanda (por id) y la
// firma con useSignedUrl. Se extrae como componente compartido para que tanto el
// portal del residente como el Historial de lecturas (admin) reutilicen el mismo
// visor. Los hooks se pueden llamar de forma condicional (solo cuando hay un
// modal abierto) porque el padre monta este componente únicamente en ese caso.
//
// La foto NO viaja en el listado de lecturas: es base64 de hasta ~15 MB por fila
// (ver domain/agua/queries.ts → REGISTROS_LIST_COLS). Por eso se baja por id solo
// al abrir el visor. Un data-URI base64 pasa tal cual por useSignedUrl; un path
// de Storage se firma con TTL de 1h.
import { useState, useEffect } from 'react'
import { fetchRegistroFoto } from '../../domain/agua/queries'
import { useSignedUrl } from '../../lib/storageUrls'
import { ModalPortal } from './ModalPortal'

export function PhotoLightbox({ registroId, label, onClose }: {
  registroId: string; label: string; onClose: () => void
}) {
  const [fotoValue, setFotoValue] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFotoValue(null)
    setFailed(false)
    fetchRegistroFoto(registroId)
      .then(v => { if (!cancelled) { setFotoValue(v); if (!v) setFailed(true) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [registroId])

  // Cerrar con Escape — es un overlay modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Versión mediana (ancho 1400, q80): nítida para ver en pantalla pero mucho más
  // liviana que el original (~1.5 MB) — la carga del visor es casi inmediata.
  const signedUrl = useSignedUrl(fotoValue, 'registro-fotos', 3600, { width: 1400, quality: 80 })

  return (
    <ModalPortal>
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Foto de la lectura: ${label}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, cursor: 'pointer', flexDirection: 'column', gap: '14px', padding: '24px',
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12.5px', textAlign: 'center', maxWidth: '80vw' }}>
        {label}
      </div>
      {!failed && signedUrl && (
        <img
          src={signedUrl}
          alt={label}
          onError={() => setFailed(true)}
          style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: '12px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', objectFit: 'contain' }}
        />
      )}
      {!failed && !signedUrl && (
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>Cargando foto…</div>
      )}
      {failed && (
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', textAlign: 'center', maxWidth: '80vw' }}>
          No se pudo cargar la foto.
        </div>
      )}
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11.5px' }}>Toque o clic para cerrar</div>
    </div>
    </ModalPortal>
  )
}

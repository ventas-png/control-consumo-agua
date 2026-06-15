// Miniatura de foto de un registro de lectura para el portal del residente.
//
// La foto NO viaja en el listado de lecturas (es base64 de hasta ~15 MB por
// fila; ver domain/portal/queries.ts). Este componente la baja bajo demanda por
// `registroId` y solo cuando va a renderizarse, y firma el valor con useSignedUrl
// (un data-URI base64 pasa tal cual; un path de Storage se firma). Si la imagen
// no existe o el navegador no puede decodificarla (las base64 gigantes fallan en
// móviles), muestra un placeholder en vez de un ícono de imagen rota.
import { useEffect, useState } from 'react'
import { fetchRegistroFoto } from '../../../domain/portal/queries'
import { useSignedUrl } from '../../../lib/storageUrls'

const BOX_BASE = {
  width: '100%', aspectRatio: '1', borderRadius: '7px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexDirection: 'column' as const, gap: '3px',
  color: 'var(--at-ink-3)', fontSize: '10px',
}

function PlaceholderBox({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ ...BOX_BASE, background: 'var(--at-chip)', border: '1.5px dashed var(--at-line-strong)' }}>
      <span style={{ fontSize: '18px' }}>{icon}</span>
      <span>{text}</span>
    </div>
  )
}

export function RegistroFotoThumb({ registroId, label, onClick }: { registroId: string; label: string; onClick: () => void }) {
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

  const url = useSignedUrl(fotoValue, 'registro-fotos')

  if (failed) return <PlaceholderBox icon="🚫" text="No disponible" />
  if (!url) return <PlaceholderBox icon="⏳" text="Cargando…" />
  return (
    <img
      src={url}
      alt={label}
      loading="lazy"
      onClick={onClick}
      onError={() => setFailed(true)}
      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '7px', border: '1.5px solid var(--at-line)', cursor: 'zoom-in' }}
    />
  )
}

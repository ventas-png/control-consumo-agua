import { SecureImage } from '../shared/SecureImage'
import { useSignedUrl } from '../../lib/storageUrls'
import { formatBytes } from './conversationConstants'

// Sub-componentes para adjuntos del chat (bucket conv-attachments es privado tras
// S6 follow-up → se firman las URLs). Extraídos de ComunicacionSection (com:N6).

// Link a un adjunto no-imagen del chat.
export function AttachmentLink({ src, name, type, size, getIcon, body }: {
  src: string
  name?: string | null
  type?: string | null
  /** Bytes del archivo; si llega se muestra bajo el nombre. */
  size?: number | null
  getIcon: (mime?: string | null) => string
  body?: string | null
}) {
  const signed = useSignedUrl(src, 'conv-attachments')
  if (!signed) return null
  return (
    <a
      href={signed}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        marginTop: body ? '6px' : 0,
        background: 'rgba(0,0,0,0.08)', borderRadius: '8px',
        padding: '8px 10px', color: 'inherit', textDecoration: 'none',
      }}
    >
      <span style={{ fontSize: '20px' }}>{getIcon(type)}</span>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        {size ? <div style={{ fontSize: '10px', opacity: 0.7 }}>{formatBytes(size)}</div> : null}
      </div>
    </a>
  )
}

// Imagen adjunta: SecureImage envuelta en link firmado.
export function AttachmentImage({ src, name, body }: { src: string; name?: string | null; body?: string | null }) {
  const signed = useSignedUrl(src, 'conv-attachments')
  if (!signed) return null
  return (
    <a href={signed} target="_blank" rel="noopener noreferrer">
      <SecureImage
        bucket="conv-attachments"
        src={src}
        alt={name ?? 'imagen'}
        style={{ maxWidth: '220px', maxHeight: '200px', borderRadius: '8px', marginTop: body ? '6px' : 0, display: 'block' }}
      />
    </a>
  )
}

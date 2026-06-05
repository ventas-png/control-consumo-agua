import { notify } from '../shared/Dialog'
import { getFileIcon, formatBytes } from './conversationConstants'

// Compositor de mensaje del detalle de conversación. Extraído de
// ComunicacionSection (com:N6) sin cambiar comportamiento.
interface Props {
  isInternalConversation: boolean
  isInternalNote: boolean
  onToggleInternalNote: (v: boolean) => void
  pendingFile: File | null
  onPickFile: (file: File | null) => void
  messageText: string
  onChangeMessage: (v: string) => void
  sending: boolean
  onSend: () => void
}

export function MessageComposer({
  isInternalConversation, isInternalNote, onToggleInternalNote,
  pendingFile, onPickFile, messageText, onChangeMessage, sending, onSend,
}: Props) {
  return (
    <div style={{ borderTop: '1px solid var(--at-chip)', padding: '12px 14px' }}>
      {/* Toggle nota interna — solo para conversaciones con clientes */}
      {!isInternalConversation && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer', marginBottom: '8px', userSelect: 'none' }}>
          <input type="checkbox" checked={isInternalNote} onChange={e => onToggleInternalNote(e.target.checked)}
            style={{ width: '13px', height: '13px', accentColor: 'var(--at-warning)' }} />
          Nota interna (solo visible para el equipo)
        </label>
      )}
      {/* Preview archivo pendiente */}
      {pendingFile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '7px 10px', marginBottom: '7px',
          background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)',
          borderRadius: '8px',
        }}>
          {pendingFile.type.startsWith('image/') ? (
            <img
              src={URL.createObjectURL(pendingFile)}
              alt="preview"
              style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
            />
          ) : (
            <span style={{ fontSize: '22px', flexShrink: 0 }}>{getFileIcon(pendingFile.type)}</span>
          )}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--at-primary-hover)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pendingFile.name}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{formatBytes(pendingFile.size)}</div>
          </div>
          <button
            onClick={() => onPickFile(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '16px', lineHeight: 1, padding: '2px', flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          value={messageText}
          onChange={e => onChangeMessage(e.target.value)}
          placeholder={isInternalNote ? 'Escribe una nota interna…' : 'Escribe una respuesta al cliente…'}
          rows={3}
          style={{
            flex: 1,
            padding: '10px 12px',
            border: `1px solid ${isInternalNote ? 'var(--at-warning-border)' : 'var(--at-line)'}`,
            borderRadius: '10px',
            fontSize: '13px',
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            background: isInternalNote ? 'var(--at-warning-tint)' : 'var(--at-surface)',
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend()
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label title="Adjuntar archivo" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', border: '1px solid var(--at-line)', borderRadius: '10px', background: 'var(--at-surface)', fontSize: '18px' }}>
            📎
            <input
              type="file"
              accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.csv"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                if (file.size > 10 * 1024 * 1024) {
                  notify({ variant: 'warning', title: 'Archivo muy grande', text: 'El archivo no puede superar los 10 MB.' })
                  return
                }
                onPickFile(file)
              }}
            />
          </label>
          <button
            onClick={onSend}
            disabled={sending || (!messageText.trim() && !pendingFile)}
            style={{
              padding: '10px 16px',
              background: (sending || (!messageText.trim() && !pendingFile)) ? 'var(--at-ink-3)' : 'var(--at-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: (sending || (!messageText.trim() && !pendingFile)) ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.14s',
            }}
          >
            {sending ? '…' : 'Enviar'}
          </button>
        </div>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '5px' }}>
        Ctrl+Enter para enviar · Max 10 MB por adjunto
      </div>
    </div>
  )
}

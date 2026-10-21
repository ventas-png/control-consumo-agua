import { useEffect, useMemo } from 'react'
import { notify } from '../shared/Dialog'
import { getFileIcon, formatBytes } from './conversationConstants'

// Compositor de mensaje de una conversación. Vive en el footer de la ventana
// (ConversationDetailModal del equipo, CustomerConversationModal del portal),
// que ya pone el borde y el padding.
interface Props {
  /** Ofrece "Nota interna": solo el equipo, y no en discusiones internas. */
  allowInternalNote: boolean
  isInternalNote: boolean
  onToggleInternalNote: (v: boolean) => void
  pendingFile: File | null
  onPickFile: (file: File | null) => void
  messageText: string
  onChangeMessage: (v: string) => void
  sending: boolean
  onSend: () => void
  /** Texto guía de la caja (por defecto, el del equipo). */
  placeholder?: string
}

const MAX_BYTES = 10 * 1024 * 1024

export function MessageComposer({
  allowInternalNote, isInternalNote, onToggleInternalNote,
  pendingFile, onPickFile, messageText, onChangeMessage, sending, onSend,
  placeholder = 'Escribe una respuesta…',
}: Props) {
  const canSend = !sending && (!!messageText.trim() || !!pendingFile)

  // Una sola URL por archivo y liberada al cambiarlo: crearla en cada render
  // (como antes) dejaba un blob huérfano por pulsación de tecla.
  const previewUrl = useMemo(
    () => (pendingFile?.type.startsWith('image/') ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  )
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Respuesta vs nota interna. Un control segmentado deja claro a quién
          le llega el mensaje antes de escribirlo; la casilla de antes pasaba
          desapercibida. */}
      {allowInternalNote && (
        <div role="radiogroup" aria-label="Tipo de mensaje" style={{
          display: 'inline-flex', alignSelf: 'flex-start', padding: '3px', gap: '2px',
          background: 'var(--at-chip)', borderRadius: '10px',
        }}>
          {([
            [false, '💬 Responder al cliente'],
            [true, '🔒 Nota interna'],
          ] as const).map(([value, label]) => {
            const active = isInternalNote === value
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onToggleInternalNote(value)}
                style={{
                  padding: '6px 12px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                  fontSize: '12.5px', fontWeight: active ? 700 : 500, whiteSpace: 'nowrap',
                  background: active ? (value ? 'var(--at-warning-tint)' : 'var(--at-surface)') : 'transparent',
                  color: active ? (value ? 'var(--at-warning-strong)' : 'var(--at-ink)') : 'var(--at-ink-3)',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'background 0.12s ease',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Preview archivo pendiente */}
      {pendingFile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 10px',
          background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)',
          borderRadius: '10px',
        }}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Vista previa del adjunto"
              style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }}
            />
          ) : (
            <span style={{ fontSize: '24px', flexShrink: 0 }}>{getFileIcon(pendingFile.type)}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-primary-hover)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pendingFile.name}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{formatBytes(pendingFile.size)}</div>
          </div>
          <button
            type="button"
            onClick={() => onPickFile(null)}
            aria-label="Quitar adjunto"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '20px', lineHeight: 1, width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          value={messageText}
          onChange={e => onChangeMessage(e.target.value)}
          placeholder={isInternalNote ? 'Escribe una nota para el equipo…' : placeholder}
          aria-label="Mensaje"
          rows={2}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '10px 12px',
            border: `1.5px solid ${isInternalNote ? 'var(--at-warning-border)' : 'var(--at-line)'}`,
            borderRadius: '12px',
            fontSize: '14px',
            lineHeight: 1.45,
            resize: 'none',
            maxHeight: '140px',
            fontFamily: 'inherit',
            color: 'var(--at-ink)',
            background: isInternalNote ? 'var(--at-warning-tint)' : 'var(--at-surface-2)',
            boxSizing: 'border-box',
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) onSend()
          }}
        />
        <label
          title="Adjuntar archivo"
          aria-label="Adjuntar archivo"
          style={{
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '44px', height: '44px', flexShrink: 0,
            border: '1px solid var(--at-line)', borderRadius: '12px',
            background: 'var(--at-surface)', color: 'var(--at-ink-2)',
          }}
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          <input
            type="file"
            accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.csv"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              if (file.size > MAX_BYTES) {
                notify({ variant: 'warning', title: 'Archivo muy grande', text: 'El archivo no puede superar los 10 MB.' })
                return
              }
              onPickFile(file)
            }}
          />
        </label>
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={isInternalNote ? 'Guardar nota interna' : 'Enviar mensaje'}
          style={{
            height: '44px',
            padding: '0 16px',
            display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
            background: !canSend
              ? 'var(--at-chip)'
              : isInternalNote ? 'var(--at-warning)' : 'var(--at-primary)',
            color: canSend ? 'var(--at-on-status)' : 'var(--at-ink-3)',
            border: 'none',
            borderRadius: '12px',
            fontWeight: 700,
            fontSize: '13.5px',
            cursor: canSend ? 'pointer' : 'not-allowed',
            transition: 'background 0.14s',
          }}
        >
          {sending ? 'Enviando…' : (
            <>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <span className="conv-send-label">{isInternalNote ? 'Guardar' : 'Enviar'}</span>
            </>
          )}
        </button>
      </div>
      <div className="conv-composer-hint" style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
        {isInternalNote
          ? 'Solo el equipo verá esta nota · Ctrl+Enter para guardar'
          : 'Ctrl+Enter para enviar · Máx. 10 MB por adjunto'}
      </div>
    </div>
  )
}

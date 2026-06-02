import { useState } from 'react'
import { notify } from '../shared/Dialog'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { sanitizeInput } from '../../lib/validation'
import { AGUA_CATEGORIES, CONDOMINIOS_CATEGORIES } from '../../types'
import { CATEGORY_LABELS } from './conversationConstants'
import type { ConversationCategory, ConversationServiceType } from '../../types'

interface Props {
  onClose: () => void
  onConfirm: (data: { subject: string; category: ConversationCategory; firstMessage: string }) => Promise<void>
  sending: boolean
  serviceType?: ConversationServiceType
}

export function NuevaDiscusionInternaModal({ onClose, onConfirm, sending, serviceType = 'agua' }: Props) {
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<ConversationCategory>('general')
  const [firstMessage, setFirstMessage] = useState('')

  async function handleSubmit() {
    if (!subject.trim() || !firstMessage.trim()) {
      notify({ variant: 'warning', title: 'Campos requeridos', text: 'Escribe un asunto y el primer mensaje.' })
      return
    }
    await onConfirm({
      subject: sanitizeInput(subject.trim()),
      category,
      firstMessage: sanitizeInput(firstMessage.trim()),
    })
  }

  return (
    <EditModal
      title="Nueva discusión de equipo"
      subtitle="Solo visible para el equipo interno"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!subject.trim() || !firstMessage.trim()}
            loading={sending}
            loadingText="Creando…"
          >
            Crear discusión
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label htmlFor="discusion-asunto" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>Asunto *</label>
          <input id="discusion-asunto" type="text" value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Ej: Revisión de procedimientos, Aviso de mantenimiento…"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label htmlFor="discusion-categoria" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>Categoría</label>
          <select id="discusion-categoria" value={category} onChange={e => setCategory(e.target.value as ConversationCategory)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
            {(serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES).map(k => (
              <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="discusion-mensaje" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>Mensaje inicial *</label>
          <textarea id="discusion-mensaje" value={firstMessage} onChange={e => setFirstMessage(e.target.value)}
            placeholder="Escribe el mensaje de apertura…" rows={4}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
      </div>
    </EditModal>
  )
}

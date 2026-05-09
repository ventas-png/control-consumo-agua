import { useState } from 'react'
import Swal from 'sweetalert2'
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
      Swal.fire({ icon: 'warning', title: 'Campos requeridos', text: 'Escribe un asunto y el primer mensaje.' })
      return
    }
    await onConfirm({
      subject: sanitizeInput(subject.trim()),
      category,
      firstMessage: sanitizeInput(firstMessage.trim()),
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: 'white', borderRadius: '14px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#111827' }}>Nueva discusión de equipo</h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b7280' }}>Solo visible para el equipo interno</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '20px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>Asunto *</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Ej: Revisión de procedimientos, Aviso de mantenimiento…"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>Categoría</label>
            <select value={category} onChange={e => setCategory(e.target.value as ConversationCategory)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
              {(serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES).map(k => (
                <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>Mensaje inicial *</label>
            <textarea value={firstMessage} onChange={e => setFirstMessage(e.target.value)}
              placeholder="Escribe el mensaje de apertura…" rows={4}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={sending}
            style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '8px', background: 'white', color: '#374151', fontSize: '13px', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={sending || !subject.trim() || !firstMessage.trim()}
            style={{ padding: '8px 18px', border: 'none', borderRadius: '8px', background: (!subject.trim() || !firstMessage.trim()) ? '#9ca3af' : '#7c3aed', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {sending ? 'Creando…' : 'Crear discusión'}
          </button>
        </div>
      </div>
    </div>
  )
}

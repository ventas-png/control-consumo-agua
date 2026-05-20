import { useState } from 'react'
import Swal from 'sweetalert2'
import { sanitizeInput } from '../../lib/validation'
import { AGUA_CATEGORIES, CONDOMINIOS_CATEGORIES } from '../../types'
import { CATEGORY_LABELS } from './conversationConstants'
import type { Cliente, ConversationCategory, ConversationPriority, ConversationServiceType } from '../../types'

interface Props {
  clientes: Cliente[]
  onClose: () => void
  onConfirm: (data: {
    clienteId: string
    clienteNombre: string
    subject: string
    category: ConversationCategory
    priority: ConversationPriority
    firstMessage: string
  }) => Promise<void>
  sending: boolean
  serviceType?: ConversationServiceType
}

export function NuevaConversacionModal({ clientes, onClose, onConfirm, sending, serviceType = 'agua' }: Props) {
  const [clienteId, setClienteId] = useState('')
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<ConversationCategory>('general')
  const [priority, setPriority] = useState<ConversationPriority>('media')
  const [firstMessage, setFirstMessage] = useState('')

  const filtered = clientes.filter(c => {
    const q = search.toLowerCase()
    return (
      c.nombre.toLowerCase().includes(q) ||
      c.codigo.toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    )
  }).slice(0, 30)

  const selectedCliente = clientes.find(c => c.id === clienteId)

  async function handleSubmit() {
    if (!clienteId || !subject.trim() || !firstMessage.trim()) {
      Swal.fire({ icon: 'warning', title: 'Campos requeridos', text: 'Selecciona un cliente, escribe el asunto y el mensaje inicial.' })
      return
    }
    await onConfirm({
      clienteId,
      clienteNombre: selectedCliente?.nombre ?? '',
      subject: sanitizeInput(subject.trim()),
      category,
      priority,
      firstMessage: sanitizeInput(firstMessage.trim()),
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div style={{
        background: 'white', borderRadius: '14px', width: '100%', maxWidth: '520px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--at-chip)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#15291F' }}>Nueva Conversación</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7E9389', fontSize: '20px', lineHeight: 1, padding: '2px' }}>×</button>
        </div>

        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#3E5A4C', marginBottom: '5px' }}>
              Cliente *
            </label>
            <input
              type="text"
              placeholder="Buscar por nombre, código o email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setClienteId('') }}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
            {search && !selectedCliente && (
              <div style={{ border: '1px solid var(--at-line)', borderRadius: '8px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto', background: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: '12px', fontSize: '12.5px', color: '#7E9389', textAlign: 'center' }}>Sin resultados</div>
                ) : filtered.map(c => (
                  <button key={c.id} onClick={() => { setClienteId(c.id); setSearch(c.nombre) }}
                    style={{ width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--at-chip)', background: 'white', cursor: 'pointer', fontSize: '13px' }}>
                    <span style={{ fontWeight: 600, color: '#15291F' }}>{c.nombre}</span>
                    <span style={{ color: '#7E9389', fontSize: '11.5px', marginLeft: '8px' }}>#{c.codigo}</span>
                    {c.email && <span style={{ color: '#7E9389', fontSize: '11.5px', marginLeft: '6px' }}>· {c.email}</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedCliente && (
              <div style={{ marginTop: '5px', padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', fontSize: '12.5px', color: '#166534', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>✓ {selectedCliente.nombre} <span style={{ opacity: 0.7 }}>#{selectedCliente.codigo}</span></span>
                <button onClick={() => { setClienteId(''); setSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7E9389', fontSize: '14px' }}>×</button>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#3E5A4C', marginBottom: '5px' }}>Asunto *</label>
            <input
              type="text"
              placeholder="Ej: Revisión de medidor, Acuerdo de pago…"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#3E5A4C', marginBottom: '5px' }}>Categoría</label>
              <select value={category} onChange={e => setCategory(e.target.value as ConversationCategory)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
                {(serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES).map(k => (
                  <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#3E5A4C', marginBottom: '5px' }}>Prioridad</label>
              <select value={priority} onChange={e => setPriority(e.target.value as ConversationPriority)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#3E5A4C', marginBottom: '5px' }}>Mensaje inicial *</label>
            <textarea
              value={firstMessage}
              onChange={e => setFirstMessage(e.target.value)}
              placeholder="Escribe el primer mensaje para el cliente…"
              rows={4}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--at-chip)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={sending}
            style={{ padding: '8px 16px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', background: 'white', color: '#3E5A4C', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}>
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={sending || !clienteId || !subject.trim() || !firstMessage.trim()}
            style={{ padding: '8px 18px', border: 'none', borderRadius: '8px', background: (!clienteId || !subject.trim() || !firstMessage.trim()) ? '#7E9389' : '#1B3B36', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.14s' }}>
            {sending ? 'Enviando…' : 'Iniciar conversación'}
          </button>
        </div>
      </div>
    </div>
  )
}

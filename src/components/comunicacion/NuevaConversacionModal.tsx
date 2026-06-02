import { useState } from 'react'
import { notify } from '../shared/Dialog'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
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
      notify({ variant: 'warning', title: 'Campos requeridos', text: 'Selecciona un cliente, escribe el asunto y el mensaje inicial.' })
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
    <EditModal
      title="Nueva Conversación"
      size="sm"
      maxWidth="520px"
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
            disabled={!clienteId || !subject.trim() || !firstMessage.trim()}
            loading={sending}
            loadingText="Enviando…"
          >
            Iniciar conversación
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label htmlFor="nueva-conv-cliente" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
            Cliente *
          </label>
          <input
            id="nueva-conv-cliente"
            type="text"
            placeholder="Buscar por nombre, código o email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setClienteId('') }}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
          />
          {search && !selectedCliente && (
            <div style={{ border: '1px solid var(--at-line)', borderRadius: '8px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto', background: 'var(--at-surface)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
              {filtered.length === 0 ? (
                <div style={{ padding: '12px', fontSize: '12.5px', color: 'var(--at-ink-3)', textAlign: 'center' }}>Sin resultados</div>
              ) : filtered.map(c => (
                <button key={c.id} onClick={() => { setClienteId(c.id); setSearch(c.nombre) }}
                  style={{ width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--at-chip)', background: 'var(--at-surface)', cursor: 'pointer', fontSize: '13px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{c.nombre}</span>
                  <span style={{ color: 'var(--at-ink-3)', fontSize: '11.5px', marginLeft: '8px' }}>#{c.codigo}</span>
                  {c.email && <span style={{ color: 'var(--at-ink-3)', fontSize: '11.5px', marginLeft: '6px' }}>· {c.email}</span>}
                </button>
              ))}
            </div>
          )}
          {selectedCliente && (
            <div style={{ marginTop: '5px', padding: '6px 10px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '7px', fontSize: '12.5px', color: 'var(--at-success-strong)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>✓ {selectedCliente.nombre} <span style={{ opacity: 0.7 }}>#{selectedCliente.codigo}</span></span>
              <button onClick={() => { setClienteId(''); setSearch('') }} aria-label="Limpiar selección" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '14px' }}>×</button>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="nueva-conv-asunto" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>Asunto *</label>
          <input
            id="nueva-conv-asunto"
            type="text"
            placeholder="Ej: Revisión de medidor, Acuerdo de pago…"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label htmlFor="nueva-conv-categoria" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>Categoría</label>
            <select id="nueva-conv-categoria" value={category} onChange={e => setCategory(e.target.value as ConversationCategory)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
              {(serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES).map(k => (
                <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nueva-conv-prioridad" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>Prioridad</label>
            <select id="nueva-conv-prioridad" value={priority} onChange={e => setPriority(e.target.value as ConversationPriority)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="nueva-conv-mensaje" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>Mensaje inicial *</label>
          <textarea
            id="nueva-conv-mensaje"
            value={firstMessage}
            onChange={e => setFirstMessage(e.target.value)}
            placeholder="Escribe el primer mensaje para el cliente…"
            rows={4}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', fontSize: '13px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </EditModal>
  )
}

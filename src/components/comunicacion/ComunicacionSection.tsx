import { useEffect, useState } from 'react'
import Swal from 'sweetalert2'
import { useConversations } from '../../hooks/useConversations'
import { sanitizeInput } from '../../lib/validation'
import type {
  UserSession,
  Cliente,
  Conversation,
  ConversationCategory,
  ConversationPriority,
  ConversationStatus,
  ConversationAccessRule,
} from '../../types'

interface Props {
  currentUser: UserSession
  clientes: Cliente[]
  canCreate: boolean
  canEdit: boolean
}

// ── Modal: Nueva Conversación (empresa → cliente) ────────────────────────────
function NuevaConversacionModal({
  clientes,
  onClose,
  onConfirm,
  sending,
}: {
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
}) {
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
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#111827' }}>Nueva Conversación</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '20px', lineHeight: 1, padding: '2px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Buscar cliente */}
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
              Cliente *
            </label>
            <input
              type="text"
              placeholder="Buscar por nombre, código o email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setClienteId('') }}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
            {search && !selectedCliente && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto', background: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: '12px', fontSize: '12.5px', color: '#9ca3af', textAlign: 'center' }}>Sin resultados</div>
                ) : filtered.map(c => (
                  <button key={c.id} onClick={() => { setClienteId(c.id); setSearch(c.nombre) }}
                    style={{ width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid #f3f4f6', background: 'white', cursor: 'pointer', fontSize: '13px' }}>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{c.nombre}</span>
                    <span style={{ color: '#9ca3af', fontSize: '11.5px', marginLeft: '8px' }}>#{c.codigo}</span>
                    {c.email && <span style={{ color: '#9ca3af', fontSize: '11.5px', marginLeft: '6px' }}>· {c.email}</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedCliente && (
              <div style={{ marginTop: '5px', padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', fontSize: '12.5px', color: '#166534', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>✓ {selectedCliente.nombre} <span style={{ opacity: 0.7 }}>#{selectedCliente.codigo}</span></span>
                <button onClick={() => { setClienteId(''); setSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '14px' }}>×</button>
              </div>
            )}
          </div>

          {/* Asunto */}
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>Asunto *</label>
            <input
              type="text"
              placeholder="Ej: Revisión de medidor, Acuerdo de pago…"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Categoría y Prioridad */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>Categoría</label>
              <select value={category} onChange={e => setCategory(e.target.value as ConversationCategory)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
                <option value="general">General</option>
                <option value="pagos">Pagos</option>
                <option value="tecnico">Técnico</option>
                <option value="calidad">Calidad Agua</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>Prioridad</label>
              <select value={priority} onChange={e => setPriority(e.target.value as ConversationPriority)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>

          {/* Mensaje inicial */}
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>Mensaje inicial *</label>
            <textarea
              value={firstMessage}
              onChange={e => setFirstMessage(e.target.value)}
              placeholder="Escribe el primer mensaje para el cliente…"
              rows={4}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={sending}
            style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '8px', background: 'white', color: '#374151', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}>
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={sending || !clienteId || !subject.trim() || !firstMessage.trim()}
            style={{ padding: '8px 18px', border: 'none', borderRadius: '8px', background: (!clienteId || !subject.trim() || !firstMessage.trim()) ? '#9ca3af' : '#0ea5e9', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.14s' }}>
            {sending ? 'Enviando…' : 'Iniciar conversación'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CATEGORY_LABELS: Record<ConversationCategory, string> = {
  general: 'General',
  pagos: 'Pagos',
  tecnico: 'Técnico',
  calidad: 'Calidad Agua',
}

const PRIORITY_LABELS: Record<ConversationPriority, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

const PRIORITY_COLORS: Record<ConversationPriority, string> = {
  baja: '#10b981',
  media: '#f59e0b',
  alta: '#ef4444',
  urgente: '#7c3aed',
}

const STATUS_LABELS: Record<ConversationStatus, string> = {
  abierta: 'Abierta',
  en_progreso: 'En Progreso',
  esperando_cliente: 'Esperando Cliente',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  abierta: '#3b82f6',
  en_progreso: '#f59e0b',
  esperando_cliente: '#8b5cf6',
  resuelta: '#10b981',
  cerrada: '#6b7280',
}

function getFileIcon(mimeType?: string | null): string {
  if (!mimeType) return '📎'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝'
  if (mimeType.startsWith('image/')) return '🖼️'
  return '📎'
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Ahora'
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `Hace ${diffH}h`
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })
}

// ── Modal: Nueva Discusión Interna (equipo) ──────────────────────────────────
function NuevaDiscusionInternaModal({
  onClose,
  onConfirm,
  sending,
}: {
  onClose: () => void
  onConfirm: (data: { subject: string; category: ConversationCategory; firstMessage: string }) => Promise<void>
  sending: boolean
}) {
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
              <option value="general">General</option>
              <option value="pagos">Finanzas / Cobros</option>
              <option value="tecnico">Técnico / Operaciones</option>
              <option value="calidad">Calidad del Servicio</option>
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

// ── Sub-componente: Lista de conversaciones ──────────────────────────────────
function ConversationList({
  conversations,
  activeId,
  onSelect,
  filter,
}: {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  filter: string
}) {
  const filtered = conversations.filter(c => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      c.subject.toLowerCase().includes(q) ||
      (c.cliente_nombre ?? '').toLowerCase().includes(q)
    )
  })

  if (filtered.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9ca3af' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>💬</div>
        <div style={{ fontSize: '13px' }}>No hay conversaciones</div>
      </div>
    )
  }

  return (
    <div>
      {filtered.map(conv => {
        const isActive = conv.id === activeId
        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '12px 14px',
              border: 'none',
              borderBottom: '1px solid #f1f5f9',
              background: isActive ? '#eff6ff' : 'white',
              cursor: 'pointer',
              transition: 'background 0.12s',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{
                fontSize: '13px',
                fontWeight: 600,
                color: isActive ? '#1d4ed8' : '#111827',
                lineHeight: '1.3',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {conv.subject}
              </span>
              <span style={{ fontSize: '11px', color: '#9ca3af', flexShrink: 0 }}>
                {formatDate(conv.updated_at)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '11px',
                color: '#6b7280',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {conv.cliente_nombre ?? 'Cliente'}
              </span>
              <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '999px',
                background: STATUS_COLORS[conv.status] + '18',
                color: STATUS_COLORS[conv.status],
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {STATUS_LABELS[conv.status]}
              </span>
              <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '999px',
                background: PRIORITY_COLORS[conv.priority] + '18',
                color: PRIORITY_COLORS[conv.priority],
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {PRIORITY_LABELS[conv.priority]}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: '#9ca3af' }}>
              {CATEGORY_LABELS[conv.category]}
              {conv.assigned_name && ` · Asignado: ${conv.assigned_name}`}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Sub-componente: Panel de configuración de acceso ────────────────────────
function AccessRulesPanel({
  companyId,
  accessRules,
  onSave,
  canEdit,
}: {
  companyId: string
  accessRules: ConversationAccessRule[]
  onSave: (rule: Omit<ConversationAccessRule, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
  canEdit: boolean
}) {
  const roles = ['admin', 'operator', 'collector', 'viewer'] as const
  const allCategories = ['general', 'pagos', 'tecnico', 'calidad']

  const getRuleForRole = (role: string): ConversationAccessRule | undefined =>
    accessRules.find(r => r.role === role)

  const [saving, setSaving] = useState<string | null>(null)

  async function handleToggle(role: string, field: 'can_view_all' | 'can_respond' | 'can_assign', current: boolean) {
    setSaving(role + field)
    try {
      const existing = getRuleForRole(role)
      await onSave({
        company_id: companyId,
        role,
        can_view_all: field === 'can_view_all' ? !current : (existing?.can_view_all ?? false),
        can_respond: field === 'can_respond' ? !current : (existing?.can_respond ?? false),
        can_assign: field === 'can_assign' ? !current : (existing?.can_assign ?? false),
        categories: existing?.categories ?? null,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error al guardar', text: 'No se pudo actualizar el permiso. Verifique sus permisos de acceso.' })
    } finally {
      setSaving(null)
    }
  }

  async function handleCategoryToggle(role: string, cat: string) {
    setSaving(role + cat)
    try {
      const existing = getRuleForRole(role)
      const current = existing?.categories ?? null
      let next: string[] | null
      if (current === null) {
        next = allCategories.filter(c => c !== cat)
      } else if (current.includes(cat)) {
        next = current.filter(c => c !== cat)
        if (next.length === allCategories.length) next = null
      } else {
        next = [...current, cat]
        if (next.length === allCategories.length) next = null
      }
      await onSave({
        company_id: companyId,
        role,
        can_view_all: existing?.can_view_all ?? false,
        can_respond: existing?.can_respond ?? false,
        can_assign: existing?.can_assign ?? false,
        categories: next,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error al guardar', text: 'No se pudo actualizar la categoría. Verifique sus permisos de acceso.' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Configure qué roles pueden ver y responder conversaciones, y en qué categorías.
      </div>
      {!canEdit && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a',
          borderRadius: '8px', padding: '10px 14px',
          color: '#92400e', fontSize: '12.5px', marginBottom: '14px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>⚠️</span>
          Solo el <strong>Admin Empresa (company_owner)</strong> puede modificar estas reglas. Vista de solo lectura.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {roles.map(role => {
          const rule = getRuleForRole(role)
          const categories = rule?.categories ?? null
          const isBusy = saving?.startsWith(role)
          const isDisabled = isBusy || !canEdit
          return (
            <div key={role} style={{
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              padding: '14px 16px',
              background: 'white',
              opacity: isBusy ? 0.7 : 1,
            }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#374151', marginBottom: '10px', textTransform: 'capitalize' }}>
                {role === 'collector' ? 'Gestor de Cobros' : role === 'operator' ? 'Operador' : role === 'viewer' ? 'Visualizador' : 'Administrador'}
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {(['can_view_all', 'can_respond', 'can_assign'] as const).map(field => {
                  const val = rule ? rule[field] : false
                  const label = field === 'can_view_all' ? 'Ver todas' : field === 'can_respond' ? 'Responder' : 'Asignar'
                  return (
                    <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: isDisabled ? 'not-allowed' : 'pointer', fontSize: '12.5px', color: '#374151', opacity: !canEdit ? 0.6 : 1 }}>
                      <input
                        type="checkbox"
                        checked={val}
                        disabled={isDisabled}
                        onChange={() => !isDisabled && handleToggle(role, field, val)}
                        style={{ width: '14px', height: '14px', accentColor: '#0ea5e9' }}
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
              <div style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '6px' }}>
                Categorías visibles ({categories === null ? 'Todas' : `${categories.length}`}):
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {allCategories.map(cat => {
                  const active = categories === null || categories.includes(cat)
                  return (
                    <button
                      key={cat}
                      disabled={isDisabled}
                      onClick={() => !isDisabled && handleCategoryToggle(role, cat)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: '999px',
                        border: `1px solid ${active ? '#0ea5e9' : '#d1d5db'}`,
                        background: active ? '#e0f2fe' : 'white',
                        color: active ? '#0369a1' : '#6b7280',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {CATEGORY_LABELS[cat as ConversationCategory]}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
export function ComunicacionSection({ currentUser, clientes, canCreate, canEdit }: Props) {
  const {
    conversations,
    messages,
    accessRules,
    activeConversationId,
    loading,
    sending,
    loadConversations,
    loadMessages,
    loadAccessRules,
    createConversation,
    createInternalConversation,
    sendMessage,
    updateConversation,
    saveAccessRule,
  } = useConversations({
    companyId: currentUser.company_id,
    userId: currentUser.user_id,
    isCliente: false,
  })

  const [view, setView] = useState<'list' | 'detail' | 'config'>('list')
  const [convTab, setConvTab] = useState<'clientes' | 'equipo'>('clientes')
  const [filterText, setFilterText] = useState('')
  const [filterStatus, setFilterStatus] = useState<ConversationStatus | 'todas'>('todas')
  const [filterCategory, setFilterCategory] = useState<ConversationCategory | 'todas'>('todas')
  const [messageText, setMessageText] = useState('')
  const [isInternalNote, setIsInternalNote] = useState(false)
  const [showNuevaModal, setShowNuevaModal] = useState(false)
  const [showNuevaInternaModal, setShowNuevaInternaModal] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  // isAdmin: puede VER el panel de configuración
  const isAdmin = ['super_admin', 'company_owner', 'admin'].includes(currentUser.role)
  // canEditRules: puede GUARDAR cambios en conversation_access_rules (coincide con RLS)
  const canEditRules = ['super_admin', 'company_owner'].includes(currentUser.role)

  async function handleCrearConversacion(data: {
    clienteId: string
    clienteNombre: string
    subject: string
    category: ConversationCategory
    priority: ConversationPriority
    firstMessage: string
  }) {
    try {
      const conv = await createConversation({
        ...data,
        companyId: currentUser.company_id!,
        senderName: currentUser.name,
      })
      setShowNuevaModal(false)
      if (conv) {
        loadMessages(conv.id)
        setView('detail')
      }
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo crear la conversación.' })
    }
  }

  async function handleCrearDiscusionInterna(data: { subject: string; category: ConversationCategory; firstMessage: string }) {
    try {
      const conv = await createInternalConversation({
        ...data,
        companyId: currentUser.company_id!,
        senderName: currentUser.name,
      })
      setShowNuevaInternaModal(false)
      if (conv) {
        loadMessages(conv.id)
        setView('detail')
      }
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo crear la discusión.' })
    }
  }

  useEffect(() => {
    loadConversations()
    if (isAdmin) loadAccessRules()
  }, [loadConversations, loadAccessRules, isAdmin])

  const activeConversation = conversations.find(c => c.id === activeConversationId) ?? null

  function handleSelectConversation(id: string) {
    loadMessages(id)
    setView('detail')
    setMessageText('')
  }

  async function handleSendMessage() {
    if (!activeConversationId || (!messageText.trim() && !pendingFile)) return
    const clean = sanitizeInput(messageText.trim())

    try {
      await sendMessage({
        conversationId: activeConversationId,
        body: clean,
        senderName: currentUser.name,
        isInternalNote,
        attachment: pendingFile ?? undefined,
      })
      setMessageText('')
      setPendingFile(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Error desconocido'
      Swal.fire({ icon: 'error', title: 'Error al enviar', text: msg })
      return
    }

    // Actualizar estado conversación — separado para no confundir con error de envío
    if (!isInternalNote) {
      const st = activeConversation?.status
      if (st === 'esperando_cliente' || st === 'abierta') {
        updateConversation(activeConversationId, { status: 'en_progreso' }).catch(() => {})
      }
    }
  }

  async function handleAssignToMe() {
    if (!activeConversationId) return
    try {
      await updateConversation(activeConversationId, {
        assigned_to: currentUser.user_id,
        assigned_name: currentUser.name,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo asignar la conversación.' })
    }
  }

  async function handleUnassign() {
    if (!activeConversationId) return
    try {
      await updateConversation(activeConversationId, {
        assigned_to: null,
        assigned_name: null,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo desasignar.' })
    }
  }

  async function handleChangeStatus(status: ConversationStatus) {
    if (!activeConversationId) return
    try {
      const patch: Partial<Conversation> = { status }
      if (status === 'cerrada' || status === 'resuelta') {
        patch.closed_at = new Date().toISOString()
      }
      await updateConversation(activeConversationId, patch)
      Swal.fire({ icon: 'success', title: 'Estado actualizado', timer: 1200, showConfirmButton: false })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    }
  }

  // Filtros aplicados
  const clientConvs = conversations.filter(c => !c.is_internal)
  const teamConvs = conversations.filter(c => c.is_internal)
  const tabConvs = convTab === 'clientes' ? clientConvs : teamConvs

  const visibleConversations = tabConvs.filter(c => {
    if (filterStatus !== 'todas' && c.status !== filterStatus) return false
    if (filterCategory !== 'todas' && c.category !== filterCategory) return false
    return true
  })

  const stats = {
    abiertas: clientConvs.filter(c => c.status === 'abierta').length,
    en_progreso: clientConvs.filter(c => c.status === 'en_progreso').length,
    esperando: clientConvs.filter(c => c.status === 'esperando_cliente').length,
    resueltas: clientConvs.filter(c => c.status === 'resuelta').length,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' }}>Centro de Comunicación</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
            Gestión de conversaciones con clientes
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && convTab === 'clientes' && (
            <button
              onClick={() => setShowNuevaModal(true)}
              style={{ padding: '8px 14px', border: 'none', borderRadius: '8px', background: '#0ea5e9', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              + Nueva conversación
            </button>
          )}
          {canCreate && convTab === 'equipo' && (
            <button
              onClick={() => setShowNuevaInternaModal(true)}
              style={{ padding: '8px 14px', border: 'none', borderRadius: '8px', background: '#7c3aed', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              + Nueva discusión
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setView(view === 'config' ? 'list' : 'config')}
              style={{
                padding: '8px 14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                background: view === 'config' ? '#f0f9ff' : 'white',
                color: '#374151',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              ⚙️ Configurar accesos
            </button>
          )}
        </div>
      </div>

      {/* ── Stats rápidas ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
        {[
          { label: 'Abiertas', value: stats.abiertas, color: '#3b82f6' },
          { label: 'En Progreso', value: stats.en_progreso, color: '#f59e0b' },
          { label: 'Esperando', value: stats.esperando, color: '#8b5cf6' },
          { label: 'Resueltas', value: stats.resueltas, color: '#10b981' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            padding: '12px 14px',
            borderTop: `3px solid ${s.color}`,
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Vista Configuración ── */}
      {view === 'config' && isAdmin && (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
            Reglas de Acceso por Rol
          </h3>
          <AccessRulesPanel
            companyId={currentUser.company_id!}
            accessRules={accessRules}
            onSave={saveAccessRule}
            canEdit={canEditRules}
          />
        </div>
      )}

      {/* ── Vista Lista + Detalle ── */}
      {view !== 'config' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: view === 'detail' ? '320px 1fr' : '1fr',
          gap: '16px',
          alignItems: 'start',
          minHeight: '500px',
        }}>
          {/* Lista */}
          <div style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Tabs: Clientes / Equipo */}
            <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9' }}>
              {([['clientes', '👥 Clientes', clientConvs.length], ['equipo', '🏢 Equipo', teamConvs.length]] as const).map(([tab, label, count]) => (
                <button key={tab} onClick={() => { setConvTab(tab); setView('list') }}
                  style={{
                    flex: 1, padding: '10px 8px', border: 'none', borderBottom: `2px solid ${convTab === tab ? (tab === 'equipo' ? '#7c3aed' : '#0ea5e9') : 'transparent'}`,
                    background: 'white', cursor: 'pointer', fontSize: '12.5px', fontWeight: convTab === tab ? 700 : 400,
                    color: convTab === tab ? (tab === 'equipo' ? '#7c3aed' : '#0ea5e9') : '#6b7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                  }}>
                  {label}
                  <span style={{ background: convTab === tab ? (tab === 'equipo' ? '#ede9fe' : '#e0f2fe') : '#f3f4f6', color: convTab === tab ? (tab === 'equipo' ? '#7c3aed' : '#0369a1') : '#9ca3af', borderRadius: '999px', padding: '1px 6px', fontSize: '11px', fontWeight: 600 }}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* Filtros */}
            <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f1f5f9' }}>
              <input
                type="text"
                placeholder="Buscar conversación..."
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: '8px',
                }}
              />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value as ConversationStatus | 'todas')}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '11.5px', outline: 'none' }}
                >
                  <option value="todas">Todos los estados</option>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value as ConversationCategory | 'todas')}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '11.5px', outline: 'none' }}
                >
                  <option value="todas">Todas las categorías</option>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Lista de conversaciones */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '600px' }}>
              {loading ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                  Cargando…
                </div>
              ) : (
                <ConversationList
                  conversations={visibleConversations}
                  activeId={activeConversationId}
                  onSelect={handleSelectConversation}
                  filter={filterText}
                />
              )}
            </div>
          </div>

          {/* Detalle */}
          {view === 'detail' && activeConversation && (
            <div style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: '500px',
            }}>
              {/* Header conversación */}
              <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px',
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setView('list')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '18px', padding: '0', lineHeight: 1 }}
                    >
                      ←
                    </button>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: '#111827' }}>{activeConversation.subject}</span>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
                      background: STATUS_COLORS[activeConversation.status] + '18',
                      color: STATUS_COLORS[activeConversation.status], fontWeight: 600,
                    }}>
                      {STATUS_LABELS[activeConversation.status]}
                    </span>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
                      background: PRIORITY_COLORS[activeConversation.priority] + '18',
                      color: PRIORITY_COLORS[activeConversation.priority], fontWeight: 600,
                    }}>
                      {PRIORITY_LABELS[activeConversation.priority]}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', marginLeft: '26px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {activeConversation.is_internal ? (
                      <span style={{ background: '#ede9fe', color: '#7c3aed', borderRadius: '999px', padding: '1px 8px', fontSize: '11px', fontWeight: 600 }}>
                        🏢 Discusión interna de equipo
                      </span>
                    ) : (
                      <span>{activeConversation.cliente_nombre} ·</span>
                    )}
                    <span>{CATEGORY_LABELS[activeConversation.category]}</span>
                    {activeConversation.assigned_name && <span>· Agente: {activeConversation.assigned_name}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                    <select
                      value={activeConversation.status}
                      onChange={e => handleChangeStatus(e.target.value as ConversationStatus)}
                      style={{
                        padding: '6px 10px',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    {/* Asignación */}
                    {activeConversation.assigned_name ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11.5px', color: '#6b7280' }}>
                          👤 {activeConversation.assigned_name}
                        </span>
                        <button
                          onClick={handleUnassign}
                          style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '11px', color: '#6b7280', cursor: 'pointer', padding: '2px 8px' }}
                        >
                          Desasignar
                        </button>
                        {activeConversation.assigned_to !== currentUser.user_id && (
                          <button
                            onClick={handleAssignToMe}
                            style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '11px', color: '#1d4ed8', cursor: 'pointer', padding: '2px 8px', fontWeight: 600 }}
                          >
                            Asignarme
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={handleAssignToMe}
                        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '11.5px', color: '#1d4ed8', cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}
                      >
                        + Asignarme
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Mensajes */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px' }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '13px', marginTop: '40px' }}>
                    No hay mensajes aún
                  </div>
                ) : (
                  messages.map(msg => {
                    const isAgent = msg.sender_type === 'agent'
                    const isNote = msg.is_internal_note
                    return (
                      <div key={msg.id} style={{
                        display: 'flex',
                        justifyContent: isAgent ? 'flex-end' : 'flex-start',
                      }}>
                        <div style={{
                          maxWidth: '72%',
                          padding: '10px 13px',
                          borderRadius: isAgent ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                          background: isNote
                            ? '#fffbeb'
                            : isAgent
                            ? '#0ea5e9'
                            : '#f1f5f9',
                          color: isNote ? '#78350f' : isAgent ? 'white' : '#111827',
                          border: isNote ? '1px solid #fde68a' : 'none',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                        }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', opacity: 0.7 }}>
                            {isNote ? '📝 Nota interna · ' : ''}{msg.sender_name ?? 'Usuario'}
                          </div>
                          {msg.body && (
                            <div style={{ fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {msg.body}
                            </div>
                          )}
                          {msg.attachment_url && msg.attachment_type?.startsWith('image/') && (
                            <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.attachment_url}
                                alt={msg.attachment_name ?? 'imagen'}
                                style={{ maxWidth: '220px', maxHeight: '200px', borderRadius: '8px', marginTop: msg.body ? '6px' : 0, display: 'block' }}
                              />
                            </a>
                          )}
                          {msg.attachment_url && !msg.attachment_type?.startsWith('image/') && (
                            <a
                              href={msg.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                marginTop: msg.body ? '6px' : 0,
                                background: 'rgba(0,0,0,0.08)', borderRadius: '8px',
                                padding: '8px 10px', color: 'inherit', textDecoration: 'none',
                              }}
                            >
                              <span style={{ fontSize: '20px' }}>{getFileIcon(msg.attachment_type)}</span>
                              <div style={{ overflow: 'hidden' }}>
                                <div style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {msg.attachment_name}
                                </div>
                                {msg.attachment_size && (
                                  <div style={{ fontSize: '10px', opacity: 0.7 }}>{formatBytes(msg.attachment_size)}</div>
                                )}
                              </div>
                            </a>
                          )}
                          <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '5px', textAlign: 'right' }}>
                            {new Date(msg.created_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Compositor de mensaje */}
              {canCreate && activeConversation.status !== 'cerrada' && (
                <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 14px' }}>
                  {/* Toggle nota interna — solo para conversaciones con clientes */}
                  {!activeConversation.is_internal && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6b7280', cursor: 'pointer', marginBottom: '8px', userSelect: 'none' }}>
                      <input type="checkbox" checked={isInternalNote} onChange={e => setIsInternalNote(e.target.checked)}
                        style={{ width: '13px', height: '13px', accentColor: '#f59e0b' }} />
                      Nota interna (solo visible para el equipo)
                    </label>
                  )}
                  {/* Preview archivo pendiente */}
                  {pendingFile && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '7px 10px', marginBottom: '7px',
                      background: '#f0f9ff', border: '1px solid #bae6fd',
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
                        <div style={{ fontSize: '12px', fontWeight: 500, color: '#0369a1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pendingFile.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>{formatBytes(pendingFile.size)}</div>
                      </div>
                      <button
                        onClick={() => setPendingFile(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '16px', lineHeight: 1, padding: '2px', flexShrink: 0 }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <textarea
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      placeholder={isInternalNote ? 'Escribe una nota interna…' : 'Escribe una respuesta al cliente…'}
                      rows={3}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        border: `1px solid ${isInternalNote ? '#fde68a' : '#e5e7eb'}`,
                        borderRadius: '10px',
                        fontSize: '13px',
                        resize: 'none',
                        outline: 'none',
                        fontFamily: 'inherit',
                        background: isInternalNote ? '#fffbeb' : 'white',
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendMessage()
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label title="Adjuntar archivo" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', border: '1px solid #e5e7eb', borderRadius: '10px', background: 'white', fontSize: '18px' }}>
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
                              Swal.fire({ icon: 'warning', title: 'Archivo muy grande', text: 'El archivo no puede superar los 10 MB.' })
                              return
                            }
                            setPendingFile(file)
                          }}
                        />
                      </label>
                      <button
                        onClick={handleSendMessage}
                        disabled={sending || (!messageText.trim() && !pendingFile)}
                        style={{
                          padding: '10px 16px',
                          background: (sending || (!messageText.trim() && !pendingFile)) ? '#9ca3af' : '#0ea5e9',
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
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '5px' }}>
                    Ctrl+Enter para enviar · Max 10 MB por adjunto
                  </div>
                </div>
              )}

              {activeConversation.status === 'cerrada' && (
                <div style={{
                  borderTop: '1px solid #f1f5f9', padding: '12px 14px',
                  background: '#f9fafb', textAlign: 'center',
                  fontSize: '12.5px', color: '#6b7280',
                }}>
                  Esta conversación está cerrada.
                  {canEdit && (
                    <button
                      onClick={() => handleChangeStatus('abierta')}
                      style={{ marginLeft: '10px', color: '#0ea5e9', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
                    >
                      Reabrir
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Placeholder si no hay conversación seleccionada */}
          {view === 'list' && conversations.length > 0 && (
            <div style={{
              display: 'none', // solo en mobile ya que ocultamos el detalle
            }} />
          )}
        </div>
      )}

      {/* ── Modal Nueva Conversación (cliente) ── */}
      {showNuevaModal && (
        <NuevaConversacionModal
          clientes={clientes}
          sending={sending}
          onClose={() => setShowNuevaModal(false)}
          onConfirm={handleCrearConversacion}
        />
      )}

      {/* ── Modal Nueva Discusión Interna (equipo) ── */}
      {showNuevaInternaModal && (
        <NuevaDiscusionInternaModal
          sending={sending}
          onClose={() => setShowNuevaInternaModal(false)}
          onConfirm={handleCrearDiscusionInterna}
        />
      )}
    </div>
  )
}

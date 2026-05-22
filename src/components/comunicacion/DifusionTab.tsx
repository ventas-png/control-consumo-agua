import { useState, useEffect, type CSSProperties} from 'react'
import type { Broadcast, BroadcastTargetType, Cliente, Proyecto, Unidad, UserSession } from '../../types'
import { useBroadcasts } from '../../hooks/useBroadcasts'
import Swal from 'sweetalert2'

interface Props {
  currentUser: UserSession
  clientes: Cliente[]
  proyectos: Proyecto[]
  unidades: Unidad[]
  canCreate: boolean
}

interface FormState {
  title: string
  body: string
  target_type: BroadcastTargetType
  selected_proyecto_ids: string[]
  selected_unidad_ids: string[]
  selected_cliente_ids: string[]
  send_email: boolean
}

const INITIAL_FORM: FormState = {
  title: '',
  body: '',
  target_type: 'todos',
  selected_proyecto_ids: [],
  selected_unidad_ids: [],
  selected_cliente_ids: [],
  send_email: false,
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function resolveEstimatedCount(
  form: FormState,
  clientes: Cliente[],
  unidades: Unidad[]
): number {
  if (form.target_type === 'todos') return clientes.length
  if (form.target_type === 'clientes') return form.selected_cliente_ids.length
  if (form.target_type === 'proyecto') {
    const ids = new Set<string>()
    unidades
      .filter(u => form.selected_proyecto_ids.includes(u.project_id) && u.cliente_id)
      .forEach(u => ids.add(u.cliente_id!))
    return ids.size
  }
  if (form.target_type === 'unidades') {
    const ids = new Set<string>()
    unidades
      .filter(u => form.selected_unidad_ids.includes(u.id) && u.cliente_id)
      .forEach(u => ids.add(u.cliente_id!))
    return ids.size
  }
  return 0
}

// ── Modal ──────────────────────────────────────────────────────────────────────

function NuevoComunicadoModal({
  clientes, proyectos, unidades, currentUser, onClose, onSent,
}: {
  clientes: Cliente[]
  proyectos: Proyecto[]
  unidades: Unidad[]
  currentUser: UserSession
  onClose: () => void
  onSent: () => void
}) {
  const { createBroadcast } = useBroadcasts()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [sending, setSending] = useState(false)
  const [clienteSearch, setClienteSearch] = useState('')

  const estimated = resolveEstimatedCount(form, clientes, unidades)

  const targetIds = (): string[] => {
    if (form.target_type === 'proyecto') return form.selected_proyecto_ids
    if (form.target_type === 'unidades') return form.selected_unidad_ids
    if (form.target_type === 'clientes') return form.selected_cliente_ids
    return []
  }

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  const filteredClientes = clientes.filter(c =>
    c.nombre.toLowerCase().includes(clienteSearch.toLowerCase()) ||
    c.codigo.toLowerCase().includes(clienteSearch.toLowerCase())
  )

  const handleSend = async () => {
    if (!form.title.trim()) {
      Swal.fire('Campo requerido', 'El título del comunicado es obligatorio.', 'warning')
      return
    }
    if (!form.body.trim()) {
      Swal.fire('Campo requerido', 'El mensaje del comunicado es obligatorio.', 'warning')
      return
    }
    if (estimated === 0) {
      Swal.fire('Sin destinatarios', 'Selecciona al menos un destinatario.', 'warning')
      return
    }

    const confirm = await Swal.fire({
      title: '¿Enviar comunicado?',
      html: `Se enviará a <b>${estimated}</b> cliente${estimated !== 1 ? 's' : ''}${form.send_email ? ' (con email)' : ''}.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, enviar',
      cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return

    setSending(true)
    const result = await createBroadcast({
      title: form.title,
      body: form.body,
      target_type: form.target_type,
      target_ids: targetIds(),
      send_email: form.send_email,
      currentUser,
      allClientes: clientes,
      allUnidades: unidades,
    })
    setSending(false)

    if (!result.success) {
      Swal.fire('Error', result.error ?? 'No se pudo enviar el comunicado.', 'error')
      return
    }

    const emailInfo = form.send_email
      ? ` · ${result.emailsSent} emails enviados${result.emailErrors > 0 ? `, ${result.emailErrors} fallidos` : ''}`
      : ''

    Swal.fire({
      icon: 'success',
      title: 'Comunicado enviado',
      text: `${result.recipientCount} destinatarios${emailInfo}`,
      timer: 3000,
      showConfirmButton: false,
    })
    onSent()
    onClose()
  }

  const labelStyle: CSSProperties = {
    display: 'block', fontWeight: 600, fontSize: '13px',
    color: 'var(--at-ink-2)', marginBottom: '4px',
  }
  const inputStyle: CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid var(--at-line-strong)',
    borderRadius: '8px', fontSize: '13.5px', boxSizing: 'border-box',
    outline: 'none', color: 'var(--at-ink)',
  }
  const chipStyle = (active: boolean): CSSProperties => ({
    padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px',
    fontWeight: 600, cursor: 'pointer', border: 'none',
    background: active ? 'var(--at-primary)' : 'var(--at-chip)',
    color: active ? 'white' : 'var(--at-ink-2)',
    transition: 'all 0.13s ease',
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nuevo comunicado"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '12px',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--at-surface)', borderRadius: '16px', width: '100%',
        maxWidth: 'min(600px, 95vw)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 14px', borderBottom: '1px solid var(--at-line)', flexShrink: 0,
        }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
            Nuevo comunicado
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', color: 'var(--at-ink-3)', padding: '4px 8px', borderRadius: '6px' }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Título */}
          <div>
            <label style={labelStyle}>Título *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ej: Corte de agua programado"
              style={inputStyle}
              maxLength={120}
            />
          </div>

          {/* Mensaje */}
          <div>
            <label style={labelStyle}>Mensaje *</label>
            <textarea
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Escribe el contenido del comunicado..."
              rows={5}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: '1.5' }}
            />
          </div>

          {/* Audiencia */}
          <div>
            <label style={labelStyle}>Audiencia</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {(['todos', 'proyecto', 'unidades', 'clientes'] as BroadcastTargetType[]).map(t => (
                <button key={t} style={chipStyle(form.target_type === t)}
                  onClick={() => setForm(f => ({
                    ...f, target_type: t,
                    selected_proyecto_ids: [], selected_unidad_ids: [], selected_cliente_ids: [],
                  }))}>
                  {t === 'todos' ? 'Todos los clientes'
                    : t === 'proyecto' ? 'Por proyecto'
                    : t === 'unidades' ? 'Por unidades'
                    : 'Clientes específicos'}
                </button>
              ))}
            </div>

            {/* Selector dinámico */}
            {form.target_type === 'proyecto' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                {proyectos.length === 0 && <p style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>No hay proyectos.</p>}
                {proyectos.map(p => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13.5px', color: 'var(--at-ink-2)' }}>
                    <input
                      type="checkbox"
                      checked={form.selected_proyecto_ids.includes(p.id)}
                      onChange={() => setForm(f => ({ ...f, selected_proyecto_ids: toggleId(f.selected_proyecto_ids, p.id) }))}
                    />
                    {p.nombre}
                  </label>
                ))}
              </div>
            )}

            {form.target_type === 'unidades' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                {unidades.length === 0 && <p style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>No hay unidades.</p>}
                {unidades.filter(u => u.cliente_id).map(u => (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13.5px', color: 'var(--at-ink-2)' }}>
                    <input
                      type="checkbox"
                      checked={form.selected_unidad_ids.includes(u.id)}
                      onChange={() => setForm(f => ({ ...f, selected_unidad_ids: toggleId(f.selected_unidad_ids, u.id) }))}
                    />
                    {u.nombre}
                    {u.propietario_nombre && <span style={{ color: 'var(--at-ink-3)', fontSize: '12px' }}> — {u.propietario_nombre}</span>}
                  </label>
                ))}
              </div>
            )}

            {form.target_type === 'clientes' && (
              <div>
                <input
                  type="text"
                  placeholder="Buscar cliente..."
                  value={clienteSearch}
                  onChange={e => setClienteSearch(e.target.value)}
                  style={{ ...inputStyle, marginBottom: '8px' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                  {filteredClientes.length === 0 && <p style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>Sin resultados.</p>}
                  {filteredClientes.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13.5px', color: 'var(--at-ink-2)' }}>
                      <input
                        type="checkbox"
                        checked={form.selected_cliente_ids.includes(c.id)}
                        onChange={() => setForm(f => ({ ...f, selected_cliente_ids: toggleId(f.selected_cliente_ids, c.id) }))}
                      />
                      <span>{c.nombre}</span>
                      <span style={{ color: 'var(--at-ink-3)', fontSize: '12px' }}>#{c.codigo}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Email checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.send_email}
              onChange={e => setForm(f => ({ ...f, send_email: e.target.checked }))}
              style={{ width: '16px', height: '16px', accentColor: 'var(--at-primary)' }}
            />
            <span style={{ fontSize: '13.5px', color: 'var(--at-ink-2)' }}>
              Enviar también por <strong>email</strong> a los clientes que tengan correo registrado
            </span>
          </label>

          {/* Preview */}
          <div style={{
            background: estimated > 0 ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
            border: `1px solid ${estimated > 0 ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
            borderRadius: '10px', padding: '12px 16px',
            fontSize: '13.5px', color: estimated > 0 ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
            fontWeight: 500,
          }}>
            {estimated === 0
              ? 'Ningún destinatario seleccionado.'
              : `Se enviará a ${estimated} cliente${estimated !== 1 ? 's' : ''}${form.send_email ? ' (+ email a quienes tengan correo)' : ''}.`}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--at-line)',
          display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 20px', border: '1px solid var(--at-line)', borderRadius: '9px',
              background: 'var(--at-surface)', color: 'var(--at-ink-2)', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            style={{
              padding: '9px 22px', border: 'none', borderRadius: '9px',
              background: sending ? 'var(--at-primary-mint)' : 'var(--at-primary)', color: 'white',
              fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', fontSize: '13.5px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}
          >
            {sending && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                style={{ animation: 'spin 1s linear infinite' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {sending ? 'Enviando...' : 'Enviar comunicado'}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Broadcast card ─────────────────────────────────────────────────────────────

function BroadcastCard({ broadcast }: { broadcast: Broadcast }) {
  const [expanded, setExpanded] = useState(false)

  const targetLabel = {
    todos: 'Todos los clientes',
    proyecto: 'Por proyecto',
    unidades: 'Por unidades',
    clientes: 'Clientes específicos',
  }[broadcast.target_type]

  const pct = broadcast.recipient_count > 0
    ? Math.round(((broadcast.read_count ?? 0) / broadcast.recipient_count) * 100)
    : 0

  return (
    <div style={{
      background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '12px',
      overflow: 'hidden', transition: 'box-shadow 0.15s ease',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '14px 18px', textAlign: 'left', display: 'flex',
          alignItems: 'flex-start', gap: '12px',
        }}
      >
        {/* Megaphone icon */}
        <div style={{
          width: '36px', height: '36px', borderRadius: '9px',
          background: 'linear-gradient(135deg, var(--at-primary-soft), var(--at-primary-soft))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, color: 'var(--at-primary)',
        }}>
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{broadcast.title}</span>
            <span style={{
              padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
              background: 'var(--at-chip)', color: 'var(--at-ink-3)',
            }}>{targetLabel}</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px' }}>
            {formatDate(broadcast.created_at)} · {broadcast.sent_by_name}
          </div>

          {/* Stats bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
              <strong style={{ color: 'var(--at-ink)' }}>{broadcast.recipient_count}</strong> destinatarios
            </span>
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
              <strong style={{ color: 'var(--at-success-strong)' }}>{broadcast.read_count ?? 0}</strong> leídos ({pct}%)
            </span>
            {broadcast.send_email && (
              <span style={{
                padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)',
              }}>📧 Email</span>
            )}
          </div>
        </div>

        <svg
          width="16" height="16" fill="none" stroke="var(--at-ink-3)" viewBox="0 0 24 24"
          style={{ flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div style={{
          padding: '0 18px 16px 66px',
          borderTop: '1px solid var(--at-chip)', paddingTop: '12px',
        }}>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
            {broadcast.body}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export default function DifusionTab({ currentUser, clientes, proyectos, unidades, canCreate }: Props) {
  const { broadcasts, loading, loadBroadcasts } = useBroadcasts()
  const [showModal, setShowModal] = useState(false)

  useEffect(() => { loadBroadcasts() }, [loadBroadcasts])

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '4px 0 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>Difusión</h2>
          <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Comunicados masivos enviados a grupos de clientes
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '9px 18px', background: 'var(--at-primary)', color: 'white',
              border: 'none', borderRadius: '10px', fontWeight: 700,
              fontSize: '13.5px', cursor: 'pointer',
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo comunicado
          </button>
        )}
      </div>

      {/* List */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)', fontSize: '14px' }}>
          Cargando comunicados...
        </div>
      )}

      {!loading && broadcasts.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '56px 24px',
          background: 'var(--at-surface)', border: '1px dashed var(--at-line)', borderRadius: '16px',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📣</div>
          <p style={{ margin: 0, color: 'var(--at-ink-3)', fontWeight: 600, fontSize: '14px' }}>
            No hay comunicados enviados todavía
          </p>
          {canCreate && (
            <p style={{ margin: '6px 0 0', color: 'var(--at-ink-3)', fontSize: '13px' }}>
              Crea el primero con el botón de arriba
            </p>
          )}
        </div>
      )}

      {!loading && broadcasts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {broadcasts.map(b => <BroadcastCard key={b.id} broadcast={b} />)}
        </div>
      )}

      {showModal && (
        <NuevoComunicadoModal
          clientes={clientes}
          proyectos={proyectos}
          unidades={unidades}
          currentUser={currentUser}
          onClose={() => setShowModal(false)}
          onSent={loadBroadcasts}
        />
      )}
    </div>
  )
}

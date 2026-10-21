import { useState, type CSSProperties, type ReactNode } from 'react'
import type { BroadcastTargetType, Cliente, Proyecto, Unidad } from '../../types'
import { useBroadcasts } from '../../hooks/useBroadcasts'
import { confirm, notify } from '../shared/Dialog'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'

// Alta de un comunicado de Difusión. Antes era un overlay hecho a mano (sin
// Escape, sin bloqueo de scroll ni foco atrapado); ahora es un EditModal, a
// pantalla completa en el teléfono, con la audiencia elegida en tarjetas y
// listas con buscador y "seleccionar todos".

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

export const TARGET_LABELS: Record<BroadcastTargetType, string> = {
  todos: 'Todos los clientes',
  proyecto: 'Por proyecto',
  unidades: 'Por unidades',
  clientes: 'Clientes específicos',
}

const TARGET_ICONS: Record<BroadcastTargetType, string> = {
  todos: '👥',
  proyecto: '🏘️',
  unidades: '🏠',
  clientes: '👤',
}

export function resolveEstimatedCount(
  form: Pick<FormState, 'target_type' | 'selected_proyecto_ids' | 'selected_unidad_ids' | 'selected_cliente_ids'>,
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

const labelStyle: CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '13px',
  color: 'var(--at-ink-2)', marginBottom: '6px',
}
const inputStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--at-line-strong)',
  borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box',
  color: 'var(--at-ink)', background: 'var(--at-surface)', fontFamily: 'inherit',
}

interface Props {
  clientes: Cliente[]
  proyectos: Proyecto[]
  unidades: Unidad[]
  onClose: () => void
  onSent: () => void
}

export function NuevoComunicadoModal({ clientes, proyectos, unidades, onClose, onSent }: Props) {
  const { createBroadcast } = useBroadcasts()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [sending, setSending] = useState(false)

  const estimated = resolveEstimatedCount(form, clientes, unidades)

  const targetIds = (): string[] => {
    if (form.target_type === 'proyecto') return form.selected_proyecto_ids
    if (form.target_type === 'unidades') return form.selected_unidad_ids
    if (form.target_type === 'clientes') return form.selected_cliente_ids
    return []
  }

  const handleSend = async () => {
    if (!form.title.trim()) {
      notify({ variant: 'warning', title: 'Campo requerido', text: 'El título del comunicado es obligatorio.' })
      return
    }
    if (!form.body.trim()) {
      notify({ variant: 'warning', title: 'Campo requerido', text: 'El mensaje del comunicado es obligatorio.' })
      return
    }
    if (estimated === 0) {
      notify({ variant: 'warning', title: 'Sin destinatarios', text: 'Selecciona al menos un destinatario.' })
      return
    }

    const conf = await confirm({
      title: '¿Enviar comunicado?',
      text: `Se enviará a ${estimated} cliente${estimated !== 1 ? 's' : ''}${form.send_email ? ' (con email)' : ''}.`,
      icon: 'question',
      confirmText: 'Sí, enviar',
    })
    if (!conf.isConfirmed) return

    setSending(true)
    const result = await createBroadcast({
      title: form.title,
      body: form.body,
      target_type: form.target_type,
      target_ids: targetIds(),
      send_email: form.send_email,
    })
    setSending(false)

    if (!result.success) {
      notify({ variant: 'error', title: 'Error', text: result.error ?? 'No se pudo enviar el comunicado.' })
      return
    }

    const emailInfo = form.send_email
      ? ` · ${result.emailsQueued} emails en cola de envío`
      : ''

    notify({
      variant: 'success',
      title: 'Comunicado enviado',
      text: `${result.recipientCount} destinatarios${emailInfo}`,
      duration: 3000,
    })
    onSent()
    onClose()
  }

  function setTarget(t: BroadcastTargetType) {
    setForm(f => ({
      ...f, target_type: t,
      selected_proyecto_ids: [], selected_unidad_ids: [], selected_cliente_ids: [],
    }))
  }

  const footer = (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
      <span aria-live="polite" style={{
        fontSize: '13px', fontWeight: 600,
        color: estimated > 0 ? 'var(--at-primary)' : 'var(--at-ink-3)',
      }}>
        {estimated === 0
          ? 'Ningún destinatario seleccionado'
          : `📣 Llegará a ${estimated} cliente${estimated !== 1 ? 's' : ''}${form.send_email ? ' · + email' : ''}`}
      </span>
      <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
        <Button variant="secondary" onClick={onClose} disabled={sending}>Cancelar</Button>
        <Button variant="primary" onClick={handleSend} loading={sending} loadingText="Enviando…">
          Enviar comunicado
        </Button>
      </div>
    </div>
  )

  return (
    <EditModal
      title="Nuevo comunicado"
      subtitle="Un mensaje informativo para un grupo de clientes. Lo verán en su portal."
      maxWidth="640px"
      fullScreenOnMobile
      onClose={onClose}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div>
          <label htmlFor="comunicado-titulo" style={labelStyle}>Título *</label>
          <input
            id="comunicado-titulo"
            type="text"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Ej: Corte de agua programado"
            style={inputStyle}
            maxLength={120}
          />
        </div>

        <div>
          <label htmlFor="comunicado-mensaje" style={labelStyle}>Mensaje *</label>
          <textarea
            id="comunicado-mensaje"
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder="Escribe el contenido del comunicado…"
            rows={5}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Audiencia */}
        <div>
          <span style={labelStyle}>¿A quién va dirigido?</span>
          <div role="radiogroup" aria-label="Audiencia" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            {(['todos', 'proyecto', 'unidades', 'clientes'] as BroadcastTargetType[]).map(t => {
              const active = form.target_type === t
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTarget(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
                    padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                    border: `2px solid ${active ? 'var(--at-primary)' : 'var(--at-line)'}`,
                    background: active ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                    color: active ? 'var(--at-primary-hover)' : 'var(--at-ink-2)',
                    fontSize: '13.5px', fontWeight: active ? 700 : 500,
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: '18px', flexShrink: 0 }}>{TARGET_ICONS[t]}</span>
                  <span style={{ minWidth: 0, lineHeight: 1.25 }}>{TARGET_LABELS[t]}</span>
                </button>
              )
            })}
          </div>

          <div style={{ marginTop: '10px' }}>
            {form.target_type === 'todos' && (
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                Todos los clientes a los que tienes acceso ({clientes.length}).
              </p>
            )}
            {form.target_type === 'proyecto' && (
              <PickList
                items={proyectos}
                getId={p => p.id}
                getSearchText={p => p.nombre}
                renderLabel={p => p.nombre}
                selected={form.selected_proyecto_ids}
                onChange={ids => setForm(f => ({ ...f, selected_proyecto_ids: ids }))}
                emptyText="No hay proyectos."
                searchPlaceholder="Buscar proyecto…"
              />
            )}
            {form.target_type === 'unidades' && (
              <PickList
                items={unidades.filter(u => u.cliente_id)}
                getId={u => u.id}
                getSearchText={u => `${u.nombre} ${u.propietario_nombre ?? ''}`}
                renderLabel={u => (
                  <>
                    {u.nombre}
                    {u.propietario_nombre && <span style={{ color: 'var(--at-ink-3)', fontSize: '12px' }}> — {u.propietario_nombre}</span>}
                  </>
                )}
                selected={form.selected_unidad_ids}
                onChange={ids => setForm(f => ({ ...f, selected_unidad_ids: ids }))}
                emptyText="No hay unidades con cliente asignado."
                searchPlaceholder="Buscar unidad o propietario…"
              />
            )}
            {form.target_type === 'clientes' && (
              <PickList
                items={clientes}
                getId={c => c.id}
                getSearchText={c => `${c.nombre} ${c.codigo}`}
                renderLabel={c => (
                  <>
                    {c.nombre} <span style={{ color: 'var(--at-ink-3)', fontSize: '12px' }}>#{c.codigo}</span>
                  </>
                )}
                selected={form.selected_cliente_ids}
                onChange={ids => setForm(f => ({ ...f, selected_cliente_ids: ids }))}
                emptyText="No hay clientes."
                searchPlaceholder="Buscar por nombre o código…"
                alwaysSearch
              />
            )}
          </div>
        </div>

        {/* Email */}
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer',
          padding: '12px 14px', borderRadius: '12px',
          border: `1px solid ${form.send_email ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
          background: form.send_email ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
        }}>
          <input
            type="checkbox"
            checked={form.send_email}
            onChange={e => setForm(f => ({ ...f, send_email: e.target.checked }))}
            style={{ width: '18px', height: '18px', marginTop: '1px', accentColor: 'var(--at-primary)', flexShrink: 0 }}
          />
          <span>
            <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>
              📧 Enviar también por email
            </span>
            <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              Solo a los clientes que tengan correo registrado. En el portal lo ven todos igual.
            </span>
          </span>
        </label>
      </div>
    </EditModal>
  )
}

// ── Lista seleccionable con buscador ─────────────────────────────────────────
// Un padrón de cientos de unidades en una lista de casillas sin filtro era
// inmanejable: ahora se busca, se marca todo lo filtrado de una vez y se ve
// cuántos van seleccionados.

function PickList<T>({
  items, getId, getSearchText, renderLabel, selected, onChange, emptyText, searchPlaceholder, alwaysSearch = false,
}: {
  items: T[]
  getId: (item: T) => string
  getSearchText: (item: T) => string
  renderLabel: (item: T) => ReactNode
  selected: string[]
  onChange: (ids: string[]) => void
  emptyText: string
  searchPlaceholder: string
  /** Mostrar el buscador aunque la lista sea corta. */
  alwaysSearch?: boolean
}) {
  const [q, setQ] = useState('')
  const showSearch = alwaysSearch || items.length > 6
  const query = q.trim().toLowerCase()
  const visible = query ? items.filter(i => getSearchText(i).toLowerCase().includes(query)) : items
  const selectedSet = new Set(selected)
  const allVisibleSelected = visible.length > 0 && visible.every(i => selectedSet.has(getId(i)))

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  function toggleAllVisible() {
    const visibleIds = visible.map(getId)
    if (allVisibleSelected) {
      const drop = new Set(visibleIds)
      onChange(selected.filter(id => !drop.has(id)))
    } else {
      onChange([...new Set([...selected, ...visibleIds])])
    }
  }

  if (items.length === 0) {
    return <p style={{ margin: 0, color: 'var(--at-ink-3)', fontSize: '13px' }}>{emptyText}</p>
  }

  return (
    <div style={{ border: '1px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden' }}>
      {showSearch && (
        <div style={{ padding: '8px', borderBottom: '1px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            style={{ ...inputStyle, padding: '8px 10px', fontSize: '13.5px' }}
          />
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        padding: '6px 12px', borderBottom: '1px solid var(--at-line)', fontSize: '12.5px',
      }}>
        <span style={{ color: selected.length > 0 ? 'var(--at-primary)' : 'var(--at-ink-3)', fontWeight: 600 }}>
          {selected.length} seleccionado{selected.length !== 1 ? 's' : ''}
        </span>
        {visible.length > 0 && (
          <button
            type="button"
            onClick={toggleAllVisible}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-primary)', fontWeight: 700, fontSize: '12.5px', padding: '4px 0' }}
          >
            {allVisibleSelected ? 'Quitar todos' : query ? 'Seleccionar los filtrados' : 'Seleccionar todos'}
          </button>
        )}
      </div>
      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
        {visible.length === 0 && (
          <p style={{ margin: 0, padding: '12px', color: 'var(--at-ink-3)', fontSize: '13px' }}>Sin resultados.</p>
        )}
        {visible.map(item => {
          const id = getId(item)
          const checked = selectedSet.has(id)
          return (
            <label key={id} className="conv-row" style={{
              display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
              padding: '9px 12px', fontSize: '13.5px', color: 'var(--at-ink-2)',
              borderBottom: '1px solid var(--at-line)',
              background: checked ? 'var(--at-primary-tint)' : 'var(--at-surface)',
            }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(id)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--at-primary)', flexShrink: 0 }}
              />
              <span style={{ minWidth: 0 }}>{renderLabel(item)}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

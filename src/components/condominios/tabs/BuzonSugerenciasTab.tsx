import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { EmptyState } from '../../shared/EmptyState'
import { openPromptDialog } from '../../shared/PromptDialog'
import { SugerenciaCondominio, CategoriaSugerencia, EstadoSugerencia, Unidad } from '../../../types'

interface Props {
  sugerencias: SugerenciaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  autorNombre: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIA_CFG: Record<CategoriaSugerencia, { label: string; icon: string; color: string }> = {
  instalaciones: { label: 'Instalaciones', icon: '🔧', color: 'var(--at-warning)' },
  seguridad:     { label: 'Seguridad',     icon: '🛡️', color: 'var(--at-accent-hover)' },
  servicios:     { label: 'Servicios',     icon: '🧹', color: 'var(--at-primary-hover)' },
  convivencia:   { label: 'Convivencia',   icon: '🤝', color: 'var(--at-success)' },
  otro:          { label: 'Otro',          icon: '💬', color: 'var(--at-ink-3)' },
}
const ESTADO_CFG: Record<EstadoSugerencia, { label: string; bg: string; color: string; next?: EstadoSugerencia }> = {
  pendiente:   { label: 'Pendiente',   bg: 'var(--at-warning-tint)', color: 'var(--at-warning)', next: 'en_revision' },
  en_revision: { label: 'En revisión', bg: 'var(--at-primary-soft)', color: 'var(--at-primary)', next: 'respondida' },
  respondida:  { label: 'Respondida',  bg: 'var(--at-success-tint)', color: 'var(--at-success)', next: 'archivada' },
  archivada:   { label: 'Archivada',   bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

const BLANK = {
  unidad_id: '', categoria: 'otro' as CategoriaSugerencia,
  titulo: '', descripcion: '', anonima: false,
}

export default function BuzonSugerenciasTab({ sugerencias, unidades, proyectoId, companyId, autorNombre, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<SugerenciaCondominio | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoSugerencia | ''>('')
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaSugerencia | ''>('')
  const [form, setForm] = useState(BLANK)

  const lista = sugerencias.filter(s =>
    (!filtroEstado || s.estado === filtroEstado) &&
    (!filtroCategoria || s.categoria === filtroCategoria)
  )

  const pendientes = sugerencias.filter(s => s.estado === 'pendiente').length
  const enRevision = sugerencias.filter(s => s.estado === 'en_revision').length

  async function guardar() {
    if (!form.titulo.trim() || !form.descripcion.trim()) {
      notify({ variant: 'warning', title: 'Error', text: 'Título y descripción son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('sugerencias_condominio', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.anonima ? null : (form.unidad_id || null),
      categoria: form.categoria, titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim(), anonima: form.anonima,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function responder(s: SugerenciaCondominio) {
    // F3.4c: PromptDialog con textarea accesible (label + aria-required)
    const result = await openPromptDialog({
      title: 'Responder sugerencia',
      description: s.titulo,
      fields: [
        {
          name: 'respuesta',
          label: 'Respuesta',
          control: 'textarea',
          placeholder: 'Escribe la respuesta…',
          required: true,
          rows: 4,
          autoFocus: true,
        },
      ],
      submitText: 'Responder',
      validate: (data) => data.respuesta.trim() ? null : 'La respuesta no puede estar vacía',
    })
    if (!result) return
    const respuesta = result.respuesta.trim()
    await updateCondominioRow('sugerencias_condominio', s.id, {
      estado: 'respondida', respuesta, respondido_por: autorNombre,
      fecha_respuesta: new Date().toISOString(),
    })
    onRefresh()
  }

  async function cambiarEstado(s: SugerenciaCondominio, estado: EstadoSugerencia) {
    await updateCondominioRow('sugerencias_condominio', s.id, { estado })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Pendientes', val: pendientes, bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
          { label: 'En revisión', val: enRevision, bg: 'var(--at-primary-soft)', color: 'var(--at-primary)' },
          { label: 'Respondidas', val: sugerencias.filter(s => s.estado === 'respondida').length, bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'Total', val: sugerencias.length, bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoSugerencia | '')}
            style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADO_CFG) as EstadoSugerencia[]).map(e => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
          </select>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaSugerencia | '')}
            style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todas las categorías</option>
            {(Object.keys(CATEGORIA_CFG) as CategoriaSugerencia[]).map(c => <option key={c} value={c}>{CATEGORIA_CFG[c].icon} {CATEGORIA_CFG[c].label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva sugerencia'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-accent-soft)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nueva sugerencia / queja</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Categoría</label>
              <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaSugerencia }))}>
                {(Object.keys(CATEGORIA_CFG) as CategoriaSugerencia[]).map(c => <option key={c} value={c}>{CATEGORIA_CFG[c].icon} {CATEGORIA_CFG[c].label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Unidad (opcional si anónima)</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))} disabled={form.anonima}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Título *</label>
              <input style={inp} value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} placeholder="Resumen breve de la sugerencia" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Descripción *</label>
              <textarea style={{ ...inp, height: 80, resize: 'vertical' }} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Detalla la sugerencia o queja…" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="anonima" checked={form.anonima} onChange={e => setForm(p => ({ ...p, anonima: e.target.checked, unidad_id: e.target.checked ? '' : p.unidad_id }))} />
              <label htmlFor="anonima" style={{ fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Enviar de forma anónima</label>
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Enviar sugerencia'}
          </button>
        </div>
      )}

      {/* Lista + Detalle */}
      {lista.length === 0 ? (
        <EmptyState icon="💬" compact title="Sin sugerencias registradas" />
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lista.map(s => {
              const cat = CATEGORIA_CFG[s.categoria]
              const est = ESTADO_CFG[s.estado]
              const unidad = unidades.find(u => u.id === s.unidad_id)
              return (
                <div key={s.id} onClick={() => setSelected(s === selected ? null : s)}
                  style={{ background: selected?.id === s.id ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', border: `1.5px solid ${selected?.id === s.id ? 'var(--at-accent-light)' : 'var(--at-line)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15 }}>{cat.icon}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-ink)' }}>{s.titulo}</span>
                        <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                        {s.anonima && <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>Anónima</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                        {cat.label}
                        {!s.anonima && unidad && ` · ${unidad.nombre}`}
                        {` · ${new Date(s.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500 }}>
                        {s.descripcion}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ width: 280, flexShrink: 0, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{CATEGORIA_CFG[selected.categoria].icon}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{selected.titulo}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--at-ink-2)', background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, lineHeight: 1.5 }}>
                {selected.descripcion}
              </div>
              {[
                ['Categoría', CATEGORIA_CFG[selected.categoria].label],
                ['Estado', ESTADO_CFG[selected.estado].label],
                ['Unidad', selected.anonima ? 'Anónima' : (unidades.find(u => u.id === selected.unidad_id)?.nombre ?? '—')],
                ['Fecha', new Date(selected.created_at).toLocaleDateString('es')],
                ['Respondido por', selected.respondido_por ?? '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--at-chip)' }}>
                  <span style={{ color: 'var(--at-ink-3)' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>{v}</span>
                </div>
              ))}
              {selected.respuesta && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--at-success-tint)', borderRadius: 8, fontSize: 12, color: 'var(--at-success-strong)', lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>💬 Respuesta:</div>
                  {selected.respuesta}
                </div>
              )}
              {canEdit && selected.estado !== 'archivada' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                  {selected.estado === 'pendiente' && (
                    <button onClick={() => cambiarEstado(selected, 'en_revision')}
                      style={{ padding: '7px 0', background: 'var(--at-primary-soft)', color: 'var(--at-primary)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      🔍 Marcar en revisión
                    </button>
                  )}
                  {(selected.estado === 'pendiente' || selected.estado === 'en_revision') && (
                    <button onClick={() => responder(selected)}
                      style={{ padding: '7px 0', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      💬 Responder
                    </button>
                  )}
                  <button onClick={() => cambiarEstado(selected, 'archivada')}
                    style={{ padding: '7px 0', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    📁 Archivar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

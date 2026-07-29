import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { LibroNovedad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { printHtml, raw, escapeHtml } from '../../../lib/printHtml'

interface Props {
  novedades: LibroNovedad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface Incidente { hora: string; descripcion: string; tipo: string }

const BLANK_INCIDENTE: Incidente = { hora: '', descripcion: '', tipo: 'observacion' }

const BLANK = {
  fecha: hoyLocalISO(),
  turno: 'mañana', responsable: '', hora_inicio: '', hora_fin: '',
  novedades: '', incidentes: [] as Incidente[], firmado: false,
}

const TURNO_COLORS: Record<string, { bg: string; color: string; icon: string }> = {
  'mañana': { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', icon: '🌅' },
  tarde:    { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', icon: '☀️' },
  noche:    { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-darker)', icon: '🌙' },
}
const TIPO_INCIDENTE = ['observacion', 'incidente', 'emergencia', 'visita', 'reparacion', 'otro']

export function LibroNovedadesTab({ novedades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [filtroTurno, setFiltroTurno] = useState<'todos' | 'mañana' | 'tarde' | 'noche'>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function addIncidente() { setForm(f => ({ ...f, incidentes: [...f.incidentes, { ...BLANK_INCIDENTE }] })) }
  function removeIncidente(i: number) { setForm(f => ({ ...f, incidentes: f.incidentes.filter((_, j) => j !== i) })) }
  function setIncidente(i: number, field: keyof Incidente, val: string) {
    setForm(f => ({ ...f, incidentes: f.incidentes.map((inc, j) => j === i ? { ...inc, [field]: val } : inc) }))
  }

  async function handleSave() {
    if (!form.responsable.trim() || !form.novedades.trim())
      return notify({ variant: 'warning', title: 'Requerido', text: 'Responsable y novedades son obligatorios.' })
    setSaving(true)
    const { error } = await createCondominioRow('libro_novedades', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, turno: form.turno, responsable: form.responsable.trim(),
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      novedades: form.novedades.trim(),
      incidentes: form.incidentes.filter(i => i.descripcion.trim()),
      firmado: form.firmado,
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function toggleFirmado(id: string, firmado: boolean) {
    await updateCondominioRow('libro_novedades', id, { firmado: !firmado })
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar entrada?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('libro_novedades', id)
    onRefresh()
  }

  function handlePrint(n: LibroNovedad) {
    const tc = TURNO_COLORS[n.turno] ?? { icon: '📋' }
    const incidentes = n.incidentes as Incidente[]
    const incidentesHtml = incidentes.length > 0
      ? printHtml`<h2 style="font-size:14px">Incidentes</h2><table><tr><th>Hora</th><th>Tipo</th><th>Descripción</th></tr>${raw(incidentes.map(i => printHtml`<tr><td>${i.hora}</td><td>${i.tipo}</td><td>${i.descripcion}</td></tr>`).join(''))}</table>`
      : ''
    // novedades es texto libre: escapamos y SOLO entonces convertimos \n en <br>.
    const novedadesHtml = escapeHtml(n.novedades).replace(/\n/g, '<br>')
    const html = printHtml`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Novedad ${n.fecha}</title>
    <style>body{font-family:sans-serif;padding:32px;color:#15291F}h1{font-size:18px}p{font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:6px 8px;border:1px solid var(--at-line)}th{background:var(--at-surface-2)}</style>
    </head><body>
    <h1>${tc.icon} Libro de Novedades — ${n.fecha} (${n.turno})</h1>
    <p><b>Responsable:</b> ${n.responsable} &nbsp; <b>Horario:</b> ${n.hora_inicio ?? '—'} – ${n.hora_fin ?? '—'}</p>
    <h2 style="font-size:14px">Novedades del turno</h2><p>${raw(novedadesHtml)}</p>
    ${raw(incidentesHtml)}
    <p style="margin-top:40px;font-size:12px;color:var(--at-ink-3)">Firmado: ${n.firmado ? 'Sí' : 'No'}</p>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  const filtered = filtroTurno === 'todos' ? novedades : novedades.filter(n => n.turno === filtroTurno)
  const detail = selected ? novedades.find(n => n.id === selected) : null

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Libro de Novedades</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>Bitácora de turnos de seguridad y administración</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva entrada
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nueva entrada</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Turno</label>
              <select style={inputStyle} value={form.turno} onChange={e => setF('turno', e.target.value)}>
                <option value="mañana">🌅 Mañana</option>
                <option value="tarde">☀️ Tarde</option>
                <option value="noche">🌙 Noche</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Responsable *</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setF('responsable', e.target.value)} placeholder="Nombre del encargado" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Hora inicio</label>
              <input style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setF('hora_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Hora fin</label>
              <input style={inputStyle} type="time" value={form.hora_fin} onChange={e => setF('hora_fin', e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
              <input type="checkbox" id="firmado_form" checked={form.firmado} onChange={e => setF('firmado', e.target.checked)} />
              <label htmlFor="firmado_form" style={{ fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer' }}>Turno firmado</label>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Novedades del turno *</label>
              <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.novedades} onChange={e => setF('novedades', e.target.value)}
                placeholder="Describe las novedades generales del turno…" />
            </div>
          </div>

          {/* Incidentes */}
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)' }}>Incidentes del turno</label>
              <button onClick={addIncidente}
                style={{ padding: '3px 10px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>
                + Agregar
              </button>
            </div>
            {form.incidentes.map((inc, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 120px 1fr auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                <input style={inputStyle} type="time" value={inc.hora} onChange={e => setIncidente(i, 'hora', e.target.value)} placeholder="Hora" />
                <select style={inputStyle} value={inc.tipo} onChange={e => setIncidente(i, 'tipo', e.target.value)}>
                  {TIPO_INCIDENTE.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input style={inputStyle} value={inc.descripcion} onChange={e => setIncidente(i, 'descripcion', e.target.value)} placeholder="Descripción del incidente" />
                <button onClick={() => removeIncidente(i)} style={{ padding: '6px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {(['todos', 'mañana', 'tarde', 'noche'] as const).map(f => {
          const tc = TURNO_COLORS[f]
          return (
            <button key={f} onClick={() => setFiltroTurno(f)}
              style={{ padding: '5px 12px', border: '1.5px solid', borderRadius: '20px', fontSize: '12px', cursor: 'pointer', fontWeight: filtroTurno === f ? 700 : 500,
                borderColor: filtroTurno === f ? 'var(--at-primary)' : 'var(--at-line)',
                background: filtroTurno === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
                color: filtroTurno === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)' }}>
              {f === 'todos' ? 'Todos' : `${tc?.icon} ${f}`}
            </button>
          )
        })}
      </div>

      {/* Split view */}
      <div style={{ display: 'grid', gridTemplateColumns: detail ? '1fr 340px' : '1fr', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <EmptyState icon="📋" title="No hay entradas" />
          ) : (
            filtered.map(n => {
              const tc = TURNO_COLORS[n.turno] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', icon: '📋' }
              const incs = n.incidentes as Incidente[]
              return (
                <div key={n.id} onClick={() => setSelected(selected === n.id ? null : n.id)}
                  style={{ background: selected === n.id ? 'var(--at-primary-tint)' : 'var(--at-surface)', border: `1.5px solid ${selected === n.id ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '16px' }}>{tc.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: '13px' }}>{n.fecha}</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '1px 7px', borderRadius: '10px', background: tc.bg, color: tc.color }}>{n.turno}</span>
                        {n.firmado && <span style={{ fontSize: '10px', color: 'var(--at-success)', fontWeight: 700 }}>✓ Firmado</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                        {n.responsable}{n.hora_inicio ? ` · ${n.hora_inicio}–${n.hora_fin ?? '?'}` : ''}
                        {incs.length > 0 && <span style={{ marginLeft: '8px', color: 'var(--at-danger)', fontWeight: 600 }}>{incs.length} incidente(s)</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '500px' }}>
                        {n.novedades}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); handlePrint(n) }}
                        style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🖨️</button>
                      {canEdit && !n.firmado && (
                        <button onClick={e => { e.stopPropagation(); toggleFirmado(n.id, n.firmado) }}
                          style={{ padding: '3px 7px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Firmar</button>
                      )}
                      {canEdit && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(n.id) }}
                          style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Detail */}
        {detail && (
          <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', alignSelf: 'flex-start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
                {TURNO_COLORS[detail.turno]?.icon} {detail.fecha} — {detail.turno}
              </h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)' }}>✕</button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
              {detail.responsable}{detail.hora_inicio ? ` · ${detail.hora_inicio} – ${detail.hora_fin}` : ''}
              {detail.firmado && ' · ✓ Firmado'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.5, marginBottom: '12px', whiteSpace: 'pre-wrap' }}>{detail.novedades}</div>
            {(detail.incidentes as Incidente[]).length > 0 && (
              <>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '6px' }}>Incidentes</div>
                {(detail.incidentes as Incidente[]).map((inc, i) => (
                  <div key={i} style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', padding: '6px 8px', marginBottom: '4px', fontSize: '12px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--at-danger)' }}>{inc.hora}</span>
                    <span style={{ color: 'var(--at-ink-3)', marginLeft: '6px', fontSize: '11px' }}>[{inc.tipo}]</span>
                    <span style={{ marginLeft: '6px', color: 'var(--at-ink-2)' }}>{inc.descripcion}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

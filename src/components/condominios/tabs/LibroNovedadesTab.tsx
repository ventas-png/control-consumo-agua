import { hoyLocalISO } from '../../../lib/format'
import { useMemo, useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { etiquetaCargo } from '../../../domain/condominios/rrhhCatalogos'
import type { LibroNovedad, PersonalCondominio, CargoCatalogo } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { printHtml, raw, escapeHtml } from '../../../lib/printHtml'

interface Props {
  novedades: LibroNovedad[]
  /** Expediente del condominio: el responsable se elige de aquí, sólo los activos. */
  personal: PersonalCondominio[]
  cargos?: CargoCatalogo[]
  /** Usuario que registra: si tiene ficha de empleado, se propone como responsable. */
  userId?: string
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.libro_novedades.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

interface Incidente { hora: string; descripcion: string; tipo: string }

const BLANK_INCIDENTE: Incidente = { hora: '', descripcion: '', tipo: 'observacion' }

const BLANK = {
  fecha: hoyLocalISO(),
  turno: 'mañana', personal_id: '', responsable: '', hora_inicio: '', hora_fin: '',
  novedades: '', incidentes: [] as Incidente[], firmado: false,
}

const TURNO_COLORS: Record<string, { bg: string; color: string; icon: string }> = {
  'mañana': { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', icon: '🌅' },
  tarde:    { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', icon: '☀️' },
  noche:    { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-darker)', icon: '🌙' },
}
const TIPO_INCIDENTE = ['observacion', 'incidente', 'emergencia', 'visita', 'reparacion', 'otro']

export function LibroNovedadesTab({ novedades, personal, cargos = [], userId, proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [filtroTurno, setFiltroTurno] = useState<'todos' | 'mañana' | 'tarde' | 'noche'>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  // Mismo criterio que Capacitación y Tareas por turno: fuera sólo el inactivo.
  const personalActivo = useMemo(
    () => personal.filter(p => p.estado !== 'inactivo').sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [personal],
  )

  function elegirResponsable(id: string) {
    const p = personalActivo.find(x => x.id === id)
    setForm(f => ({ ...f, personal_id: p?.id ?? '', responsable: p?.nombre ?? '' }))
  }

  function abrirForm() {
    // Quien registra suele ser quien hizo el turno: si su usuario tiene ficha
    // de empleado se propone, sin pisar lo que ya se había elegido.
    const propio = userId ? personalActivo.find(p => p.user_id === userId) : undefined
    if (!form.personal_id && propio) elegirResponsable(propio.id)
    setShowForm(true)
  }

  function addIncidente() { setForm(f => ({ ...f, incidentes: [...f.incidentes, { ...BLANK_INCIDENTE }] })) }
  function removeIncidente(i: number) { setForm(f => ({ ...f, incidentes: f.incidentes.filter((_, j) => j !== i) })) }
  function setIncidente(i: number, field: keyof Incidente, val: string) {
    setForm(f => ({ ...f, incidentes: f.incidentes.map((inc, j) => j === i ? { ...inc, [field]: val } : inc) }))
  }

  async function handleSave() {
    if (!form.personal_id || !form.novedades.trim())
      return notify({ variant: 'warning', title: 'Requerido', text: 'Responsable y novedades son obligatorios.' })
    setSaving(true)
    const { error } = await createCondominioRow('libro_novedades', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, turno: form.turno,
      personal_id: form.personal_id, responsable: form.responsable.trim(),
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
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar entrada?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('libro_novedades', id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
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

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

  function cerrarForm() {
    if (saving) return
    setShowForm(false)
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Libro de Novedades</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>Bitácora de turnos de seguridad y administración</p>
        </div>
        {/* Sigue montado con la ventana abierta: al cerrarla, el foco vuelve aquí. */}
        {canCreate && (
          <button onClick={abrirForm}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva entrada
          </button>
        )}
      </div>

      {/* Form en ventana (antes se desplegaba arriba de la lista y en el
          teléfono empujaba todo hacia abajo). */}
      {showForm && (
        <EditModal
          title="Nueva entrada"
          maxWidth="680px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="lib-fecha" style={labelStyle}>Fecha</label>
              <input id="lib-fecha" style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label htmlFor="lib-turno" style={labelStyle}>Turno</label>
              <select id="lib-turno" style={inputStyle} value={form.turno} onChange={e => setF('turno', e.target.value)}>
                <option value="mañana">🌅 Mañana</option>
                <option value="tarde">☀️ Tarde</option>
                <option value="noche">🌙 Noche</option>
              </select>
            </div>
            <div>
              <label htmlFor="lib-responsable" style={labelStyle}>Responsable *</label>
              <select id="lib-responsable" style={inputStyle} value={form.personal_id} onChange={e => elegirResponsable(e.target.value)} autoFocus>
                <option value="">{personalActivo.length ? 'Elegí un empleado…' : 'Sin empleados activos — agregalos en Personal'}</option>
                {personalActivo.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.cargo ? ` — ${etiquetaCargo(p.cargo, cargos)}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="lib-hora-inicio" style={labelStyle}>Hora inicio</label>
              <input id="lib-hora-inicio" style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setF('hora_inicio', e.target.value)} />
            </div>
            <div>
              <label htmlFor="lib-hora-fin" style={labelStyle}>Hora fin</label>
              <input id="lib-hora-fin" style={inputStyle} type="time" value={form.hora_fin} onChange={e => setF('hora_fin', e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
              <input type="checkbox" id="firmado_form" checked={form.firmado} onChange={e => setF('firmado', e.target.checked)} />
              <label htmlFor="firmado_form" style={{ fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer' }}>Turno firmado</label>
            </div>
            {/* `1 / -1` y no `span 2`: con una sola columna (teléfono) el span
                creaba una columna implícita y el campo se salía de la ventana. */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="lib-novedades" style={labelStyle}>Novedades del turno *</label>
              <textarea id="lib-novedades" style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                value={form.novedades} onChange={e => setF('novedades', e.target.value)}
                placeholder="Describe las novedades generales del turno…" />
            </div>
          </div>

          {/* Incidentes */}
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)' }}>Incidentes del turno</span>
              <button onClick={addIncidente}
                style={{ padding: '3px 10px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>
                + Agregar
              </button>
            </div>
            {/* Fila que se parte en el teléfono: con columnas fijas de 90 + 120px
                a la descripción le quedaban unos pocos píxeles. */}
            {form.incidentes.map((inc, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                <input style={{ ...inputStyle, flex: '0 0 90px' }} type="time" value={inc.hora} onChange={e => setIncidente(i, 'hora', e.target.value)} placeholder="Hora" aria-label={`Hora del incidente ${i + 1}`} />
                <select style={{ ...inputStyle, flex: '0 0 120px' }} value={inc.tipo} onChange={e => setIncidente(i, 'tipo', e.target.value)} aria-label={`Tipo del incidente ${i + 1}`}>
                  {TIPO_INCIDENTE.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input style={{ ...inputStyle, flex: '1 1 180px', width: 'auto', minWidth: 0 }} value={inc.descripcion} onChange={e => setIncidente(i, 'descripcion', e.target.value)} placeholder="Descripción del incidente" aria-label={`Descripción del incidente ${i + 1}`} />
                <button onClick={() => removeIncidente(i)} aria-label={`Quitar incidente ${i + 1}`} style={{ padding: '6px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
          </div>
        </EditModal>
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

      {/* Lista — cada entrada se abre en ventana. Antes el detalle iba en una
          columna fija de 340px que en el teléfono dejaba la lista en una
          franja y el texto fuera de la pantalla. */}
      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="No hay entradas" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(n => {
            const tc = TURNO_COLORS[n.turno] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', icon: '📋' }
            const incs = n.incidentes as Incidente[]
            return (
              <div key={n.id}
                style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
                <button type="button" className="cond-row-main" onClick={() => setSelected(n.id)}
                  style={{ flex: '1 1 260px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
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
                </button>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                  <button onClick={() => handlePrint(n)} aria-label={`Imprimir entrada del ${n.fecha} (${n.turno})`}
                    style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🖨️</button>
                  {canEdit && !n.firmado && (
                    <button onClick={() => toggleFirmado(n.id, n.firmado)}
                      style={{ padding: '3px 7px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Firmar</button>
                  )}
                  {canDelete && (
                    <button onClick={() => handleDelete(n.id)} aria-label={`Eliminar entrada del ${n.fecha} (${n.turno})`}
                      style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {detail && (
        <EditModal
          title={`${TURNO_COLORS[detail.turno]?.icon ?? '📋'} ${detail.fecha} — ${detail.turno}`}
          subtitle={`${detail.responsable}${detail.hora_inicio ? ` · ${detail.hora_inicio} – ${detail.hora_fin}` : ''}${detail.firmado ? ' · ✓ Firmado' : ''}`}
          maxWidth="620px"
          fullScreenOnMobile
          onClose={() => setSelected(null)}
        >
          <div style={{ fontSize: '14px', color: 'var(--at-ink-2)', lineHeight: 1.55, marginBottom: '14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.novedades}</div>
          {(detail.incidentes as Incidente[]).length > 0 && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '6px' }}>Incidentes</div>
              {(detail.incidentes as Incidente[]).map((inc, i) => (
                <div key={i} style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', padding: '6px 8px', marginBottom: '4px', fontSize: '12.5px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--at-danger)' }}>{inc.hora}</span>
                  <span style={{ color: 'var(--at-ink-3)', marginLeft: '6px', fontSize: '11px' }}>[{inc.tipo}]</span>
                  <span style={{ marginLeft: '6px', color: 'var(--at-ink-2)' }}>{inc.descripcion}</span>
                </div>
              ))}
            </>
          )}
        </EditModal>
      )}
    </div>
  )
}

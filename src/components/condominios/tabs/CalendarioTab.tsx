import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { EventoCalendario, TipoEvento, Asamblea, AgendaItem } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  eventos: EventoCalendario[]
  asambleas: Asamblea[]
  agenda: AgendaItem[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface CalEvent {
  id: string
  date: string
  titulo: string
  tipo: string
  color: string
  hora?: string
  source: 'evento' | 'asamblea' | 'agenda'
}

const TIPO_COLOR: Record<string, string> = {
  evento:        'var(--at-primary)',
  mantenimiento: '#f59e0b',
  asamblea:      'var(--at-accent)',
  vencimiento:   '#ef4444',
  recordatorio:  '#10b981',
  agenda:        'var(--at-ink-3)',
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

function buildMonthGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)
  while (days.length % 7 !== 0) days.push(null)
  return days
}

function mergeAll(eventos: EventoCalendario[], asambleas: Asamblea[], agenda: AgendaItem[]): CalEvent[] {
  const result: CalEvent[] = []
  for (const e of eventos) result.push({ id: e.id, date: e.fecha_inicio, titulo: e.titulo, tipo: e.tipo, color: e.color, hora: e.hora_inicio ?? undefined, source: 'evento' })
  for (const a of asambleas) result.push({ id: a.id, date: a.fecha, titulo: a.titulo, tipo: 'asamblea', color: 'var(--at-accent)', hora: a.hora_inicio, source: 'asamblea' })
  for (const ag of agenda) result.push({ id: ag.id, date: ag.fecha, titulo: ag.titulo, tipo: 'agenda', color: TIPO_COLOR.agenda, hora: ag.hora_inicio ?? undefined, source: 'agenda' })
  return result
}

const BLANK_FORM = { titulo: '', tipo: 'evento' as TipoEvento, fecha_inicio: '', hora_inicio: '', fecha_fin: '', descripcion: '', color: 'var(--at-primary)', todo_el_dia: true }

export function CalendarioTab({ eventos, asambleas, agenda, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [saving, setSaving] = useState(false)

  const allEvents = mergeAll(eventos, asambleas, agenda)
  const todayStr = toDateStr(now.getFullYear(), now.getMonth(), now.getDate())
  const days = buildMonthGrid(viewYear, viewMonth)

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) } else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) } else setViewMonth(m => m + 1)
  }

  function eventsForDay(dateStr: string) {
    return allEvents.filter(e => e.date === dateStr)
  }

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSave() {
    if (!form.titulo.trim() || !form.fecha_inicio) return Swal.fire('Campos requeridos', 'Título y fecha de inicio son obligatorios.', 'warning')
    setSaving(true)
    const { error } = await supabase.from('eventos_calendario').insert({
      company_id: companyId,
      project_id: proyectoId,
      titulo: form.titulo.trim(),
      tipo: form.tipo,
      fecha_inicio: form.fecha_inicio,
      hora_inicio: form.todo_el_dia ? null : (form.hora_inicio || null),
      fecha_fin: form.fecha_fin || null,
      descripcion: form.descripcion || null,
      color: form.color,
      todo_el_dia: form.todo_el_dia,
      recurrente: false,
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false)
    setForm({ ...BLANK_FORM })
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar evento?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('eventos_calendario').delete().eq('id', id)
    onRefresh()
  }

  const selectedEvents = selectedDay ? eventsForDay(selectedDay) : []
  const inputStyle: CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Calendario Comunitario</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[['evento','Evento'],['mantenimiento','Mant.'],['asamblea','Asamblea'],['recordatorio','Recordatorio']].map(([tipo, label]) => (
              <span key={tipo} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--at-ink-3)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: TIPO_COLOR[tipo], display: 'inline-block' }} />{label}
              </span>
            ))}
          </div>
          {canCreate && (
            <button onClick={() => { setShowForm(v => !v); setSelectedDay(null) }}
              style={{ padding: '7px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Evento
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo evento</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Nombre del evento" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo *</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoEvento)}>
                {(['evento','mantenimiento','asamblea','vencimiento','recordatorio'] as TipoEvento[]).map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha inicio *</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio} onChange={e => setF('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>
                <input type="checkbox" checked={form.todo_el_dia} onChange={e => setF('todo_el_dia', e.target.checked)} style={{ marginRight: '4px' }} />
                Todo el día
              </label>
              {!form.todo_el_dia && <input style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setF('hora_inicio', e.target.value)} />}
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Color</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                {['var(--at-primary)','#10b981','#f59e0b','#ef4444','var(--at-accent)','#ec4899','var(--at-ink)'].map(c => (
                  <div key={c} onClick={() => setF('color', c)}
                    style={{ width: '20px', height: '20px', borderRadius: '50%', background: c, cursor: 'pointer', border: form.color === c ? '2px solid var(--at-ink)' : '2px solid transparent' }} />
                ))}
              </div>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Descripción</label>
              <input style={inputStyle} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Descripción opcional" />
            </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: selectedDay ? '1fr 280px' : '1fr', gap: '16px' }}>
        {/* Calendar grid */}
        <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden' }}>
          {/* Month nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)' }}>
            <button onClick={prevMonth} style={{ padding: '4px 10px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>‹</button>
            <span style={{ fontWeight: 800, fontSize: '15px', color: 'var(--at-ink)' }}>{MESES[viewMonth]} {viewYear}</span>
            <button onClick={nextMonth} style={{ padding: '4px 10px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>›</button>
          </div>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)' }}>
            {DIAS.map(d => (
              <div key={d} style={{ padding: '6px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)' }}>{d}</div>
            ))}
          </div>
          {/* Days */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {days.map((day, idx) => {
              const dateStr = day ? toDateStr(viewYear, viewMonth, day) : ''
              const dayEvents = day ? eventsForDay(dateStr) : []
              const isToday = dateStr === todayStr
              const isSelected = dateStr === selectedDay
              return (
                <div key={idx} onClick={() => day && setSelectedDay(isSelected ? null : dateStr)}
                  style={{
                    minHeight: '70px', padding: '6px', borderRight: (idx + 1) % 7 !== 0 ? '1px solid var(--at-chip)' : 'none',
                    borderBottom: '1px solid var(--at-chip)', cursor: day ? 'pointer' : 'default',
                    background: isSelected ? 'var(--at-primary-tint)' : isToday ? '#fefce8' : day ? 'white' : 'var(--at-surface-2)',
                  }}>
                  {day && (
                    <>
                      <div style={{ fontSize: '12px', fontWeight: isToday ? 800 : 500, marginBottom: '4px',
                        background: isToday ? 'var(--at-primary)' : 'transparent', color: isToday ? 'white' : 'var(--at-ink)',
                        width: isToday ? '22px' : 'auto', height: isToday ? '22px' : 'auto',
                        borderRadius: isToday ? '50%' : '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {day}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                        {dayEvents.slice(0, 3).map(e => (
                          <div key={e.id} style={{ fontSize: '10px', background: e.color, color: 'white', borderRadius: '3px', padding: '1px 4px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.titulo}
                          </div>
                        ))}
                        {dayEvents.length > 3 && <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>+{dayEvents.length - 3}</div>}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Selected day panel */}
        {selectedDay && (
          <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden', alignSelf: 'start' }}>
            <div style={{ padding: '12px 14px', background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{selectedDay}</span>
              <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '16px' }}>×</button>
            </div>
            {selectedEvents.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '12px' }}>Sin eventos este día.</div>
            ) : (
              <div style={{ padding: '8px' }}>
                {selectedEvents.map(e => (
                  <div key={e.id} style={{ padding: '8px 10px', marginBottom: '6px', background: 'var(--at-surface)', border: `1.5px solid ${e.color}30`, borderLeft: `4px solid ${e.color}`, borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink)' }}>{e.titulo}</div>
                      {canEdit && e.source === 'evento' && (
                        <button onClick={() => handleDelete(e.id)}
                          style={{ padding: '2px 6px', background: '#fee2e2', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', color: '#ef4444', flexShrink: 0, marginLeft: '6px' }}>🗑️</button>
                      )}
                    </div>
                    {e.hora && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>🕐 {e.hora}</div>}
                    <div style={{ fontSize: '10px', color: e.color, fontWeight: 600, marginTop: '2px', textTransform: 'capitalize' }}>{e.tipo}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

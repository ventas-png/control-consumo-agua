import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Amenidad, ReservaAmenidad, Unidad } from '../../../types'
import { ImageUploader } from '../ImageUploader'

interface Props {
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type Vista = 'amenidades' | 'reservas' | 'calendario'

const DIAS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function lunesDeSemana(ref: Date): Date {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - dow)
  return d
}

function diasDeSemana(lunes: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes)
    d.setDate(d.getDate() + i)
    return d
  })
}

const ESTADO_COLORS: Record<string, { bg: string; color: string }> = {
  confirmada: { bg: '#f0fdf4', color: '#16a34a' },
  pendiente:  { bg: '#eff6ff', color: '#2563eb' },
  cancelada:  { bg: '#f1f5f9', color: '#94a3b8' },
}

const RESERVA_CAL_COLORS = [
  { bg: '#dbeafe', border: '#93c5fd', color: '#1e40af' },
  { bg: '#d1fae5', border: '#6ee7b7', color: '#065f46' },
  { bg: '#ede9fe', border: '#c4b5fd', color: '#4c1d95' },
  { bg: '#fce7f3', border: '#f9a8d4', color: '#9d174d' },
  { bg: '#fef3c7', border: '#fcd34d', color: '#78350f' },
]

export function AmenidadesTab({ amenidades, reservas, unidades, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [vista, setVista] = useState<Vista>('amenidades')
  const [showAmenidadForm, setShowAmenidadForm] = useState(false)
  const [showReservaForm, setShowReservaForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [amenidadFotoUrl, setAmenidadFotoUrl] = useState<string | null>(null)
  const [amenidadForm, setAmenidadForm] = useState({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '' })
  const [reservaForm, setReservaForm] = useState({ amenidad_id: '', unidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: '0', notas: '' })
  const [semana, setSemana] = useState<Date>(() => lunesDeSemana(new Date()))
  const [selectedReserva, setSelectedReserva] = useState<ReservaAmenidad | null>(null)

  const hoy = new Date().toISOString().slice(0, 10)
  const amenidadesActivas = amenidades.filter(a => a.activo)
  const dias = diasDeSemana(semana)

  function abrirReservaDesdeCalendario(amenidadId: string, fecha: string) {
    setReservaForm(f => ({ ...f, amenidad_id: amenidadId, fecha }))
    setVista('reservas')
    setShowReservaForm(true)
  }

  async function guardarAmenidad() {
    if (!amenidadForm.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('amenidades').insert({
      company_id: companyId, project_id: proyectoId,
      nombre: amenidadForm.nombre.trim(),
      descripcion: amenidadForm.descripcion.trim() || null,
      capacidad_max: amenidadForm.capacidad_max ? Number(amenidadForm.capacidad_max) : null,
      horario_inicio: amenidadForm.horario_inicio || null,
      horario_fin: amenidadForm.horario_fin || null,
      requiere_deposito: amenidadForm.requiere_deposito,
      monto_deposito: amenidadForm.monto_deposito ? Number(amenidadForm.monto_deposito) : null,
      foto_url: amenidadFotoUrl,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setAmenidadForm({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '' })
    setAmenidadFotoUrl(null)
    setShowAmenidadForm(false)
    onRefresh()
  }

  async function toggleAmenidad(a: Amenidad) {
    await supabase.from('amenidades').update({ activo: !a.activo }).eq('id', a.id)
    onRefresh()
  }

  async function guardarReserva() {
    if (!reservaForm.amenidad_id || !reservaForm.unidad_id || !reservaForm.fecha || !reservaForm.hora_inicio || !reservaForm.hora_fin) {
      Swal.fire('Error', 'Complete todos los campos requeridos.', 'error'); return
    }
    const conflict = reservas.find(r =>
      r.amenidad_id === reservaForm.amenidad_id &&
      r.fecha === reservaForm.fecha &&
      r.estado !== 'cancelada' &&
      r.hora_inicio < reservaForm.hora_fin &&
      r.hora_fin > reservaForm.hora_inicio
    )
    if (conflict) { Swal.fire('Conflicto', 'Ya existe una reserva en ese horario para esta amenidad.', 'warning'); return }
    setSaving(true)
    const { error } = await supabase.from('reservas_amenidades').insert({
      company_id: companyId,
      amenidad_id: reservaForm.amenidad_id,
      unidad_id: reservaForm.unidad_id,
      fecha: reservaForm.fecha,
      hora_inicio: reservaForm.hora_inicio,
      hora_fin: reservaForm.hora_fin,
      num_invitados: Number(reservaForm.num_invitados),
      notas: reservaForm.notas.trim() || null,
      created_by: userId,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setReservaForm({ amenidad_id: '', unidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: '0', notas: '' })
    setShowReservaForm(false)
    Swal.fire({ icon: 'success', title: 'Reserva confirmada', timer: 1500, showConfirmButton: false })
    onRefresh()
  }

  async function cancelarReserva(id: string) {
    const r = await Swal.fire({ title: '¿Cancelar reserva?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, cancelar', cancelButtonText: 'No', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('reservas_amenidades').update({ estado: 'cancelada' }).eq('id', id)
    setSelectedReserva(null)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Amenidades y Reservas</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>{amenidadesActivas.length} amenidades activas · {reservas.filter(r => r.estado === 'confirmada').length} reservas activas</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && vista === 'amenidades' && <button onClick={() => setShowAmenidadForm(true)} style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>+ Amenidad</button>}
          {(vista === 'reservas' || vista === 'calendario') && canCreate && <button onClick={() => { setVista('reservas'); setShowReservaForm(true) }} style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>+ Reserva</button>}
        </div>
      </div>

      {/* Vista toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {(['amenidades', 'reservas', 'calendario'] as const).map(v => (
          <button key={v} onClick={() => setVista(v)} style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13.5px', background: vista === v ? 'linear-gradient(135deg,#0ea5e9,#0d9488)' : '#f1f5f9', color: vista === v ? 'white' : '#374151' }}>
            {v === 'amenidades' ? '🏊 Amenidades' : v === 'reservas' ? '📋 Lista' : '📆 Calendario'}
          </button>
        ))}
      </div>

      {/* ── AMENIDADES ── */}
      {vista === 'amenidades' && (
        <>
          {showAmenidadForm && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva amenidad</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre *</label>
                  <input value={amenidadForm.nombre} onChange={e => setAmenidadForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Piscina, Gimnasio, Salón Social"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Capacidad máxima</label>
                  <input type="number" value={amenidadForm.capacidad_max} onChange={e => setAmenidadForm(f => ({ ...f, capacidad_max: e.target.value }))} placeholder="Personas"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Descripción</label>
                  <input value={amenidadForm.descripcion} onChange={e => setAmenidadForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Opcional"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Horario inicio</label>
                  <input type="time" value={amenidadForm.horario_inicio} onChange={e => setAmenidadForm(f => ({ ...f, horario_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Horario fin</label>
                  <input type="time" value={amenidadForm.horario_fin} onChange={e => setAmenidadForm(f => ({ ...f, horario_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="deposito" checked={amenidadForm.requiere_deposito} onChange={e => setAmenidadForm(f => ({ ...f, requiere_deposito: e.target.checked }))} />
                  <label htmlFor="deposito" style={{ fontSize: '13.5px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Requiere depósito</label>
                </div>
                {amenidadForm.requiere_deposito && (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Monto depósito ({moneda})</label>
                    <input type="number" value={amenidadForm.monto_deposito} onChange={e => setAmenidadForm(f => ({ ...f, monto_deposito: e.target.value }))} min="0" step="0.01"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <ImageUploader value={amenidadFotoUrl} onChange={setAmenidadFotoUrl} folder="amenidades" label="Foto de la amenidad" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarAmenidad} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => setShowAmenidadForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {amenidades.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏊</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay amenidades registradas</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
              {amenidades.map(a => (
                <div key={a.id} style={{ background: 'white', border: `1.5px solid ${a.activo ? '#e2e8f0' : '#f1f5f9'}`, borderRadius: '14px', overflow: 'hidden', opacity: a.activo ? 1 : 0.6 }}>
                  {a.foto_url && <img src={a.foto_url} alt={a.nombre} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />}
                  <div style={{ padding: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{a.nombre}</h4>
                      {canEdit && (
                        <button onClick={() => toggleAmenidad(a)} style={{ padding: '3px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11.5px', fontWeight: 700, background: a.activo ? '#f0fdf4' : '#f1f5f9', color: a.activo ? '#16a34a' : '#94a3b8' }}>
                          {a.activo ? 'Activa' : 'Inactiva'}
                        </button>
                      )}
                    </div>
                    {a.descripcion && <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: '#64748b' }}>{a.descripcion}</p>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '12px', color: '#64748b' }}>
                      {a.capacidad_max && <span>👥 Máx {a.capacidad_max}</span>}
                      {a.horario_inicio && <span>⏰ {a.horario_inicio}–{a.horario_fin}</span>}
                      {a.requiere_deposito && <span>💰 Depósito {moneda} {a.monto_deposito}</span>}
                    </div>
                    <div style={{ marginTop: '12px', fontSize: '12px', color: '#94a3b8' }}>
                      {reservas.filter(r => r.amenidad_id === a.id && r.estado === 'confirmada').length} reservas activas
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── RESERVAS LISTA ── */}
      {vista === 'reservas' && (
        <>
          {showReservaForm && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva reserva</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Amenidad *</label>
                  <select value={reservaForm.amenidad_id} onChange={e => setReservaForm(f => ({ ...f, amenidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                    <option value="">Seleccionar...</option>
                    {amenidadesActivas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad *</label>
                  <select value={reservaForm.unidad_id} onChange={e => setReservaForm(f => ({ ...f, unidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                    <option value="">Seleccionar...</option>
                    {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha *</label>
                  <input type="date" value={reservaForm.fecha} onChange={e => setReservaForm(f => ({ ...f, fecha: e.target.value }))} min={hoy}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>N° invitados</label>
                  <input type="number" value={reservaForm.num_invitados} onChange={e => setReservaForm(f => ({ ...f, num_invitados: e.target.value }))} min="0"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
                  <input type="time" value={reservaForm.hora_inicio} onChange={e => setReservaForm(f => ({ ...f, hora_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora fin *</label>
                  <input type="time" value={reservaForm.hora_fin} onChange={e => setReservaForm(f => ({ ...f, hora_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarReserva} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Confirmar reserva'}
                </button>
                <button onClick={() => setShowReservaForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {reservas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📅</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay reservas registradas</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reservas.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(r => (
                <div key={r.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{r.amenidad_nombre}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      {r.unidad_nombre} · {r.fecha} · {r.hora_inicio}–{r.hora_fin}
                      {r.num_invitados > 0 && ` · ${r.num_invitados} invitados`}
                    </div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ESTADO_COLORS[r.estado]?.bg || '#f1f5f9', color: ESTADO_COLORS[r.estado]?.color || '#374151' }}>
                    {r.estado}
                  </span>
                  {r.estado !== 'cancelada' && canEdit && (
                    <button onClick={() => cancelarReserva(r.id)} style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      Cancelar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── CALENDARIO SEMANAL ── */}
      {vista === 'calendario' && (
        <div>
          {/* Navegación de semana */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button onClick={() => setSemana(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}
              style={{ padding: '6px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: '#f8fafc', fontWeight: 600 }}>← Ant.</button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
              Semana del {dias[0].toLocaleDateString('es', { day: 'numeric', month: 'long' })} al {dias[6].toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <button onClick={() => setSemana(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}
              style={{ padding: '6px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: '#f8fafc', fontWeight: 600 }}>Sig. →</button>
            <button onClick={() => setSemana(lunesDeSemana(new Date()))}
              style={{ padding: '6px 12px', border: '1.5px solid #bfdbfe', borderRadius: 8, cursor: 'pointer', fontSize: 12, background: '#eff6ff', color: '#2563eb', fontWeight: 600 }}>Hoy</button>
          </div>

          {amenidadesActivas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontSize: 13 }}>No hay amenidades activas para mostrar en el calendario.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ width: 110, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px 0 0 0' }}>Amenidad</th>
                    {dias.map((d, i) => {
                      const fechaStr = d.toISOString().slice(0, 10)
                      const esHoy = fechaStr === hoy
                      return (
                        <th key={i} style={{ padding: '8px 6px', fontSize: 11, fontWeight: 700, textAlign: 'center', border: '1px solid #e2e8f0', background: esHoy ? '#eff6ff' : '#f8fafc', color: esHoy ? '#2563eb' : '#64748b', minWidth: 100 }}>
                          <div style={{ fontWeight: 800 }}>{DIAS_ES[i]}</div>
                          <div style={{ fontSize: 14, color: esHoy ? '#1d4ed8' : '#374151', fontWeight: esHoy ? 800 : 600 }}>{d.getDate()}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {amenidadesActivas.map((a, ai) => (
                    <tr key={a.id}>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: '#374151', border: '1px solid #e2e8f0', background: '#fafafa', verticalAlign: 'middle' }}>
                        {a.nombre}
                        {a.horario_inicio && <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>{a.horario_inicio}–{a.horario_fin}</div>}
                      </td>
                      {dias.map((d, di) => {
                        const fechaStr = d.toISOString().slice(0, 10)
                        const esHoy = fechaStr === hoy
                        const resDia = reservas.filter(r => r.amenidad_id === a.id && r.fecha === fechaStr && r.estado !== 'cancelada')
                        const paleta = RESERVA_CAL_COLORS[ai % RESERVA_CAL_COLORS.length]
                        return (
                          <td key={di} style={{ padding: '6px', border: '1px solid #e2e8f0', background: esHoy ? '#f0f9ff' : 'white', verticalAlign: 'top', minHeight: 60 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 48 }}>
                              {resDia.map(r => (
                                <div key={r.id}
                                  onClick={() => setSelectedReserva(selectedReserva?.id === r.id ? null : r)}
                                  style={{ padding: '4px 7px', borderRadius: 6, border: `1px solid ${paleta.border}`, background: paleta.bg, cursor: 'pointer' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: paleta.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.unidad_nombre}</div>
                                  <div style={{ fontSize: 10, color: paleta.color, opacity: 0.8 }}>{r.hora_inicio}–{r.hora_fin}</div>
                                </div>
                              ))}
                              {canCreate && (
                                <button onClick={() => abrirReservaDesdeCalendario(a.id, fechaStr)}
                                  style={{ marginTop: resDia.length > 0 ? 2 : 'auto', padding: '2px 6px', border: '1px dashed #cbd5e1', borderRadius: 5, background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#94a3b8', lineHeight: 1, display: 'block', width: '100%', textAlign: 'center' }}
                                  title={`Reservar ${a.nombre} el ${fechaStr}`}>+</button>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Detalle de reserva seleccionada */}
          {selectedReserva && (
            <div style={{ marginTop: 16, background: 'white', border: '1.5px solid #bfdbfe', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{selectedReserva.amenidad_nombre}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {selectedReserva.unidad_nombre} · {selectedReserva.fecha} · {selectedReserva.hora_inicio}–{selectedReserva.hora_fin}
                  {selectedReserva.num_invitados > 0 && ` · ${selectedReserva.num_invitados} invitados`}
                </div>
                {selectedReserva.notas && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{selectedReserva.notas}</div>}
              </div>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ESTADO_COLORS[selectedReserva.estado]?.bg, color: ESTADO_COLORS[selectedReserva.estado]?.color }}>
                {selectedReserva.estado}
              </span>
              {selectedReserva.estado !== 'cancelada' && canEdit && (
                <button onClick={() => cancelarReserva(selectedReserva.id)}
                  style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  Cancelar
                </button>
              )}
              <button onClick={() => setSelectedReserva(null)}
                style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#64748b' }}>✕</button>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
            Haz clic en una reserva para ver detalles · Haz clic en <strong>+</strong> para crear una nueva reserva en esa fecha y amenidad.
          </div>
        </div>
      )}
    </div>
  )
}

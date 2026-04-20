import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { RondaSeguridad, NovedadSeguridad, TipoNovedad, PrioridadNovedad, EstadoRonda } from '../../../types'

interface Props {
  rondas: RondaSeguridad[]
  novedades: NovedadSeguridad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const PRIORIDAD_CONFIG: Record<PrioridadNovedad, { label: string; bg: string; color: string }> = {
  normal:  { label: 'Normal',  bg: '#f0fdf4', color: '#16a34a' },
  alta:    { label: 'Alta',    bg: '#fff7ed', color: '#ea580c' },
  critica: { label: 'Crítica', bg: '#fef2f2', color: '#dc2626' },
}

const TIPO_NOVEDAD_CONFIG: Record<TipoNovedad, { label: string; icon: string }> = {
  incidente:   { label: 'Incidente',   icon: '🚨' },
  observacion: { label: 'Observación', icon: '👁' },
  alarma:      { label: 'Alarma',      icon: '🔔' },
  acceso:      { label: 'Acceso',      icon: '🚪' },
  otro:        { label: 'Otro',        icon: '📋' },
}

const ESTADO_RONDA: Record<EstadoRonda, { label: string; bg: string; color: string }> = {
  en_curso:   { label: 'En curso',   bg: '#eff6ff', color: '#2563eb' },
  completada: { label: 'Completada', bg: '#f0fdf4', color: '#16a34a' },
  incompleta: { label: 'Incompleta', bg: '#fef2f2', color: '#dc2626' },
}

export function SeguridadTab({ rondas, novedades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [vista, setVista] = useState<'novedades' | 'rondas'>('novedades')
  const [showNovedadForm, setShowNovedadForm] = useState(false)
  const [showRondaForm, setShowRondaForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroPrioridad, setFiltroPrioridad] = useState<PrioridadNovedad | 'todos'>('todos')

  const [novedadForm, setNovedadForm] = useState({
    tipo: 'observacion' as TipoNovedad, descripcion: '', ubicacion: '',
    prioridad: 'normal' as PrioridadNovedad, ronda_id: '',
  })
  const [rondaForm, setRondaForm] = useState({ notas: '' })

  const novedadesFiltradas = novedades.filter(n =>
    filtroPrioridad === 'todos' || n.prioridad === filtroPrioridad
  )

  const rondaEnCurso = rondas.find(r => r.estado === 'en_curso')
  const hoy = new Date().toISOString().slice(0, 10)
  const novedadesHoy = novedades.filter(n => n.created_at.startsWith(hoy))
  const criticas = novedades.filter(n => n.prioridad === 'critica').length

  async function iniciarRonda() {
    setSaving(true)
    const { error } = await supabase.from('rondas_seguridad').insert({
      company_id: companyId, project_id: proyectoId,
      guardia_id: userId, estado: 'en_curso',
      notas: rondaForm.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setRondaForm({ notas: '' }); setShowRondaForm(false)
    onRefresh()
  }

  async function finalizarRonda(id: string, estado: EstadoRonda) {
    await supabase.from('rondas_seguridad').update({ estado, fin: new Date().toISOString() }).eq('id', id)
    onRefresh()
  }

  async function registrarNovedad() {
    if (!novedadForm.descripcion.trim()) { Swal.fire('Error', 'Ingrese la descripción.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('novedades_seguridad').insert({
      company_id: companyId, project_id: proyectoId,
      ronda_id: novedadForm.ronda_id || null,
      tipo: novedadForm.tipo, descripcion: novedadForm.descripcion.trim(),
      ubicacion: novedadForm.ubicacion.trim() || null,
      prioridad: novedadForm.prioridad, reportado_por: userId,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: 'Novedad registrada', timer: 1400, showConfirmButton: false })
    setNovedadForm({ tipo: 'observacion', descripcion: '', ubicacion: '', prioridad: 'normal', ronda_id: '' })
    setShowNovedadForm(false); onRefresh()
  }

  async function eliminarNovedad(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar novedad?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('novedades_seguridad').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Seguridad</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {novedadesHoy.length} novedades hoy
            {criticas > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> · {criticas} críticas</span>}
            {rondaEnCurso && <span style={{ color: '#2563eb', fontWeight: 600 }}> · Ronda en curso</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && (
            <>
              <button onClick={() => setShowNovedadForm(true)} style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
                + Novedad
              </button>
              {!rondaEnCurso && (
                <button onClick={() => setShowRondaForm(true)} style={{ padding: '9px 16px', background: '#f1f5f9', color: '#374151', border: '1.5px solid #e2e8f0', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
                  🛡 Iniciar ronda
                </button>
              )}
              {rondaEnCurso && (
                <button onClick={() => finalizarRonda(rondaEnCurso.id, 'completada')} style={{ padding: '9px 16px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
                  ✓ Finalizar ronda
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Ronda en curso banner */}
      {rondaEnCurso && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>🛡️</span>
            <span style={{ fontSize: '13.5px', color: '#1d4ed8', fontWeight: 600 }}>
              Ronda en curso desde {new Date(rondaEnCurso.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {canEdit && (
            <button onClick={() => finalizarRonda(rondaEnCurso.id, 'incompleta')}
              style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              Marcar incompleta
            </button>
          )}
        </div>
      )}

      {/* Vista toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button onClick={() => setVista('novedades')}
          style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vista === 'novedades' ? '#0ea5e9' : '#e2e8f0', background: vista === 'novedades' ? '#eff6ff' : 'white', color: vista === 'novedades' ? '#0ea5e9' : '#64748b' }}>
          📋 Novedades ({novedades.length})
        </button>
        <button onClick={() => setVista('rondas')}
          style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vista === 'rondas' ? '#0ea5e9' : '#e2e8f0', background: vista === 'rondas' ? '#eff6ff' : 'white', color: vista === 'rondas' ? '#0ea5e9' : '#64748b' }}>
          🛡 Rondas ({rondas.length})
        </button>
      </div>

      {/* Form novedad */}
      {showNovedadForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar novedad</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={novedadForm.tipo} onChange={e => setNovedadForm(f => ({ ...f, tipo: e.target.value as TipoNovedad }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                {(Object.entries(TIPO_NOVEDAD_CONFIG) as [TipoNovedad, typeof TIPO_NOVEDAD_CONFIG[TipoNovedad]][]).map(([v, c]) => (
                  <option key={v} value={v}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Prioridad</label>
              <select value={novedadForm.prioridad} onChange={e => setNovedadForm(f => ({ ...f, prioridad: e.target.value as PrioridadNovedad }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Descripción *</label>
              <textarea value={novedadForm.descripcion} onChange={e => setNovedadForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Detalle la novedad..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Ubicación</label>
              <input value={novedadForm.ubicacion} onChange={e => setNovedadForm(f => ({ ...f, ubicacion: e.target.value }))} placeholder="Ej. Entrada principal, Nivel 3..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            {rondaEnCurso && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Vincular a ronda actual</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: '#374151', cursor: 'pointer', marginTop: '8px' }}>
                  <input type="checkbox" checked={novedadForm.ronda_id === rondaEnCurso.id}
                    onChange={e => setNovedadForm(f => ({ ...f, ronda_id: e.target.checked ? rondaEnCurso.id : '' }))} />
                  Sí, vincular a esta ronda
                </label>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={registrarNovedad} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Registrar'}
            </button>
            <button onClick={() => setShowNovedadForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Form ronda */}
      {showRondaForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Iniciar ronda de seguridad</h3>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas (opcional)</label>
            <input value={rondaForm.notas} onChange={e => setRondaForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones iniciales..."
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={iniciarRonda} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              🛡 Iniciar ahora
            </button>
            <button onClick={() => setShowRondaForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Novedades view */}
      {vista === 'novedades' && (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {(['todos', 'normal', 'alta', 'critica'] as const).map(p => (
              <button key={p} onClick={() => setFiltroPrioridad(p)}
                style={{ padding: '6px 13px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: filtroPrioridad === p ? (p === 'todos' ? '#e2e8f0' : PRIORIDAD_CONFIG[p as PrioridadNovedad]?.bg) : 'transparent',
                  color: filtroPrioridad === p ? (p === 'todos' ? '#374151' : PRIORIDAD_CONFIG[p as PrioridadNovedad]?.color) : '#94a3b8' }}>
                {p === 'todos' ? 'Todas' : PRIORIDAD_CONFIG[p as PrioridadNovedad].label}
              </button>
            ))}
          </div>
          {novedadesFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay novedades registradas</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {novedadesFiltradas.map(n => {
                const pc = PRIORIDAD_CONFIG[n.prioridad]
                const tc = TIPO_NOVEDAD_CONFIG[n.tipo]
                return (
                  <div key={n.id} style={{ background: 'white', border: `1.5px solid ${n.prioridad === 'critica' ? '#fecaca' : '#e2e8f0'}`, borderRadius: '12px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <span style={{ fontSize: '20px', flexShrink: 0 }}>{tc.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}>{tc.label}</span>
                          <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
                          {n.ubicacion && <span style={{ fontSize: '12px', color: '#64748b' }}>📍 {n.ubicacion}</span>}
                        </div>
                        <p style={{ margin: '0 0 4px', fontSize: '13.5px', color: '#374151' }}>{n.descripcion}</p>
                        <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>{new Date(n.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <button onClick={() => eliminarNovedad(n.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '15px', padding: '2px 4px', flexShrink: 0 }}>🗑</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Rondas view */}
      {vista === 'rondas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rondas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛡️</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay rondas registradas</p>
            </div>
          ) : rondas.map(r => {
            const ec = ESTADO_RONDA[r.estado]
            const duracion = r.fin
              ? Math.round((new Date(r.fin).getTime() - new Date(r.inicio).getTime()) / 60000)
              : Math.round((Date.now() - new Date(r.inicio).getTime()) / 60000)
            const novsRonda = novedades.filter(n => n.ronda_id === r.id).length
            return (
              <div key={r.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontSize: '22px', flexShrink: 0 }}>🛡️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                    {new Date(r.inicio).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })} — {new Date(r.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#64748b', display: 'flex', gap: '12px', marginTop: '3px', flexWrap: 'wrap' }}>
                    <span>⏱ {duracion} min{r.fin ? '' : ' (en curso)'}</span>
                    {novsRonda > 0 && <span>📋 {novsRonda} novedad{novsRonda > 1 ? 'es' : ''}</span>}
                    {r.notas && <span>· {r.notas}</span>}
                  </div>
                </div>
                <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: ec.bg, color: ec.color, flexShrink: 0 }}>{ec.label}</span>
                {canEdit && r.estado === 'en_curso' && (
                  <button onClick={() => finalizarRonda(r.id, 'completada')} style={{ padding: '6px 12px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                    ✓ Completar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

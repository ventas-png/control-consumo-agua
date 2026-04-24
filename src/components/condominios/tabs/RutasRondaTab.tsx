import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { AreaCondominio, RutaRonda, PuntoControlRuta } from '../../../types'

interface Props {
  areas: AreaCondominio[]
  rutas: RutaRonda[]
  puntosControl: PuntoControlRuta[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ICONOS_PREDEFINIDOS = ['📍', '🚪', '🏊', '🏋️', '🚗', '🌳', '💡', '🔥', '📦', '🛗', '⚡', '💧', '🎭', '📮', '🏥', '🔐']

function blank_area(): Omit<AreaCondominio, 'id' | 'company_id' | 'project_id' | 'created_at'> {
  return { nombre: '', descripcion: '', icono: '📍', orden: 0, activo: true }
}

function blank_ruta(): { nombre: string; descripcion: string; tiempo_estimado_min: string } {
  return { nombre: '', descripcion: '', tiempo_estimado_min: '' }
}

export function RutasRondaTab({ areas, rutas, puntosControl, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [vista, setVista] = useState<'areas' | 'rutas'>('areas')
  const [saving, setSaving] = useState(false)

  // ── Areas state ─────────────────────────────────────────────
  const [showAreaForm, setShowAreaForm] = useState(false)
  const [editAreaId, setEditAreaId] = useState<string | null>(null)
  const [areaForm, setAreaForm] = useState(blank_area())

  // ── Rutas state ─────────────────────────────────────────────
  const [showRutaForm, setShowRutaForm] = useState(false)
  const [editRutaId, setEditRutaId] = useState<string | null>(null)
  const [rutaForm, setRutaForm] = useState(blank_ruta())
  const [selectedRutaId, setSelectedRutaId] = useState<string | null>(null)
  const [addingPunto, setAddingPunto] = useState(false)
  const [newPuntoAreaId, setNewPuntoAreaId] = useState('')
  const [newPuntoInstrucciones, setNewPuntoInstrucciones] = useState('')
  const [newPuntoTiempo, setNewPuntoTiempo] = useState('')

  // ── Areas helpers ────────────────────────────────────────────
  function startEditArea(a: AreaCondominio) {
    setEditAreaId(a.id)
    setAreaForm({ nombre: a.nombre, descripcion: a.descripcion ?? '', icono: a.icono, orden: a.orden, activo: a.activo })
    setShowAreaForm(true)
  }

  function resetAreaForm() {
    setAreaForm(blank_area()); setEditAreaId(null); setShowAreaForm(false)
  }

  async function saveArea() {
    if (!areaForm.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre del área.', 'error'); return }
    setSaving(true)
    if (editAreaId) {
      const { error } = await supabase.from('areas_condominio').update({
        nombre: areaForm.nombre.trim(), descripcion: (areaForm.descripcion ?? '').trim() || null,
        icono: areaForm.icono, orden: areaForm.orden, activo: areaForm.activo,
      }).eq('id', editAreaId)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    } else {
      const { error } = await supabase.from('areas_condominio').insert({
        company_id: companyId, project_id: proyectoId,
        nombre: areaForm.nombre.trim(), descripcion: (areaForm.descripcion ?? '').trim() || null,
        icono: areaForm.icono, orden: areaForm.orden,
      })
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    }
    setSaving(false); resetAreaForm(); onRefresh()
  }

  async function deleteArea(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar área?', text: 'Se eliminará de las rutas que la usan.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('areas_condominio').delete().eq('id', id)
    onRefresh()
  }

  // ── Rutas helpers ────────────────────────────────────────────
  function startEditRuta(r: RutaRonda) {
    setEditRutaId(r.id)
    setRutaForm({ nombre: r.nombre, descripcion: r.descripcion ?? '', tiempo_estimado_min: r.tiempo_estimado_min?.toString() ?? '' })
    setShowRutaForm(true)
  }

  function resetRutaForm() {
    setRutaForm(blank_ruta()); setEditRutaId(null); setShowRutaForm(false)
  }

  async function saveRuta() {
    if (!rutaForm.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre de la ruta.', 'error'); return }
    setSaving(true)
    if (editRutaId) {
      const { error } = await supabase.from('rutas_ronda').update({
        nombre: rutaForm.nombre.trim(), descripcion: rutaForm.descripcion.trim() || null,
        tiempo_estimado_min: rutaForm.tiempo_estimado_min ? parseInt(rutaForm.tiempo_estimado_min) : null,
      }).eq('id', editRutaId)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    } else {
      const { data, error } = await supabase.from('rutas_ronda').insert({
        company_id: companyId, project_id: proyectoId,
        nombre: rutaForm.nombre.trim(), descripcion: rutaForm.descripcion.trim() || null,
        tiempo_estimado_min: rutaForm.tiempo_estimado_min ? parseInt(rutaForm.tiempo_estimado_min) : null,
      }).select('id').single()
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
      if (data) setSelectedRutaId(data.id)
    }
    setSaving(false); resetRutaForm(); onRefresh()
  }

  async function deleteRuta(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar ruta?', text: 'Se eliminarán también los puntos de control.', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('rutas_ronda').delete().eq('id', id)
    if (selectedRutaId === id) setSelectedRutaId(null)
    onRefresh()
  }

  // ── Puntos helpers ───────────────────────────────────────────
  const puntosDeRuta = (rutaId: string) =>
    puntosControl.filter(p => p.ruta_id === rutaId).sort((a, b) => a.orden - b.orden)

  async function addPunto() {
    if (!selectedRutaId || !newPuntoAreaId) return
    const existentes = puntosDeRuta(selectedRutaId)
    const maxOrden = existentes.length ? Math.max(...existentes.map(p => p.orden)) : -1
    setSaving(true)
    const { error } = await supabase.from('puntos_control_ruta').insert({
      ruta_id: selectedRutaId, area_id: newPuntoAreaId,
      orden: maxOrden + 1,
      instrucciones: newPuntoInstrucciones.trim() || null,
      tiempo_estimado_min: newPuntoTiempo ? parseInt(newPuntoTiempo) : null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setNewPuntoAreaId(''); setNewPuntoInstrucciones(''); setNewPuntoTiempo('')
    setAddingPunto(false); onRefresh()
  }

  async function deletePunto(id: string) {
    await supabase.from('puntos_control_ruta').delete().eq('id', id)
    onRefresh()
  }

  async function movePunto(punto: PuntoControlRuta, dir: 'up' | 'down') {
    const puntos = puntosDeRuta(punto.ruta_id)
    const idx = puntos.findIndex(p => p.id === punto.id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= puntos.length) return
    const swap = puntos[swapIdx]
    await Promise.all([
      supabase.from('puntos_control_ruta').update({ orden: swap.orden }).eq('id', punto.id),
      supabase.from('puntos_control_ruta').update({ orden: punto.orden }).eq('id', swap.id),
    ])
    onRefresh()
  }

  const areasActivas = areas.filter(a => a.activo).sort((a, b) => a.orden - b.orden)

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Rutas de Ronda</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {areas.length} áreas · {rutas.filter(r => r.activo).length} rutas activas
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {vista === 'areas' && canCreate && (
            <button onClick={() => { resetAreaForm(); setShowAreaForm(true) }}
              style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
              + Nueva área
            </button>
          )}
          {vista === 'rutas' && canCreate && (
            <button onClick={() => { resetRutaForm(); setShowRutaForm(true) }}
              style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
              + Nueva ruta
            </button>
          )}
        </div>
      </div>

      {/* Vista toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {(['areas', 'rutas'] as const).map(v => (
          <button key={v} onClick={() => setVista(v)}
            style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vista === v ? '#6366f1' : '#e2e8f0', background: vista === v ? '#eef2ff' : 'white', color: vista === v ? '#6366f1' : '#64748b' }}>
            {v === 'areas' ? `📍 Áreas (${areas.length})` : `🗺 Rutas (${rutas.length})`}
          </button>
        ))}
      </div>

      {/* ─── ÁREAS ──────────────────────────────────────────────────────── */}
      {vista === 'areas' && (
        <>
          {showAreaForm && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editAreaId ? 'Editar área' : 'Nueva área'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre del área *</label>
                  <input value={areaForm.nombre} onChange={e => setAreaForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Lobby principal, Estacionamiento B2..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Ícono</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', background: '#f8fafc', borderRadius: '8px', border: '1.5px solid #e2e8f0' }}>
                    {ICONOS_PREDEFINIDOS.map(ic => (
                      <button key={ic} onClick={() => setAreaForm(f => ({ ...f, icono: ic }))}
                        style={{ width: '36px', height: '36px', fontSize: '20px', borderRadius: '8px', border: '2px solid', borderColor: areaForm.icono === ic ? '#6366f1' : 'transparent', background: areaForm.icono === ic ? '#eef2ff' : 'transparent', cursor: 'pointer' }}>
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Orden</label>
                  <input type="number" value={areaForm.orden} onChange={e => setAreaForm(f => ({ ...f, orden: parseInt(e.target.value) || 0 }))} min={0}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Descripción</label>
                  <input value={areaForm.descripcion ?? ''} onChange={e => setAreaForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción opcional..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={saveArea} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : editAreaId ? 'Actualizar' : 'Guardar'}
                </button>
                <button onClick={resetAreaForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {areas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px', color: '#94a3b8' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📍</div>
              <p style={{ fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Sin áreas definidas</p>
              <p style={{ fontSize: '13px' }}>Crea las áreas físicas del condominio para construir rutas de ronda.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
              {areas.sort((a, b) => a.orden - b.orden).map(a => (
                <div key={a.id} style={{ background: 'white', border: `1.5px solid ${a.activo ? '#e2e8f0' : '#f1f5f9'}`, borderRadius: '14px', padding: '16px', opacity: a.activo ? 1 : 0.55 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '28px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f3ff', borderRadius: '10px' }}>{a.icono}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</div>
                      <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>Orden: {a.orden} · {a.activo ? 'Activa' : 'Inactiva'}</div>
                    </div>
                  </div>
                  {a.descripcion && <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: '#64748b' }}>{a.descripcion}</p>}
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => startEditArea(a)} style={{ flex: 1, padding: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#374151', fontWeight: 600 }}>✏️ Editar</button>
                      <button onClick={() => deleteArea(a.id)} style={{ padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', color: '#dc2626' }}>🗑</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── RUTAS ──────────────────────────────────────────────────────── */}
      {vista === 'rutas' && (
        <>
          {showRutaForm && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editRutaId ? 'Editar ruta' : 'Nueva ruta de ronda'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre de la ruta *</label>
                  <input value={rutaForm.nombre} onChange={e => setRutaForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Ronda nocturna, Ronda diurna..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tiempo estimado (min)</label>
                  <input type="number" value={rutaForm.tiempo_estimado_min} onChange={e => setRutaForm(f => ({ ...f, tiempo_estimado_min: e.target.value }))} placeholder="45"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Descripción</label>
                  <input value={rutaForm.descripcion} onChange={e => setRutaForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción de la ruta..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={saveRuta} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : editRutaId ? 'Actualizar' : 'Guardar'}
                </button>
                <button onClick={resetRutaForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {rutas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px', color: '#94a3b8' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🗺️</div>
              <p style={{ fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Sin rutas de ronda</p>
              <p style={{ fontSize: '13px' }}>Crea una ruta y añade las áreas que el guardia debe recorrer en orden.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {rutas.map(ruta => {
                const puntos = puntosDeRuta(ruta.id)
                const isOpen = selectedRutaId === ruta.id
                return (
                  <div key={ruta.id} style={{ background: 'white', border: `1.5px solid ${isOpen ? '#6366f1' : '#e2e8f0'}`, borderRadius: '16px', overflow: 'hidden' }}>
                    {/* Ruta header */}
                    <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }}
                      onClick={() => setSelectedRutaId(isOpen ? null : ruta.id)}>
                      <span style={{ fontSize: '24px' }}>🗺️</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>{ruta.nombre}</div>
                        <div style={{ fontSize: '12.5px', color: '#64748b', display: 'flex', gap: '14px', marginTop: '2px', flexWrap: 'wrap' }}>
                          {ruta.tiempo_estimado_min && <span>⏱ ~{ruta.tiempo_estimado_min} min</span>}
                          <span>📍 {puntos.length} punto{puntos.length !== 1 ? 's' : ''}</span>
                          {!ruta.activo && <span style={{ color: '#ef4444' }}>Inactiva</span>}
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => startEditRuta(ruta)} style={{ padding: '6px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#374151', fontWeight: 600 }}>✏️</button>
                          <button onClick={() => deleteRuta(ruta.id)} style={{ padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', color: '#dc2626' }}>🗑</button>
                        </div>
                      )}
                      <span style={{ color: '#94a3b8', fontSize: '16px', transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                    </div>

                    {/* Puntos de la ruta */}
                    {isOpen && (
                      <div style={{ borderTop: '1px solid #e2e8f0', padding: '16px 20px' }}>
                        {puntos.length === 0 ? (
                          <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 12px' }}>Sin puntos de control. Agrega las áreas que componen esta ruta.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                            {puntos.map((p, idx) => {
                              const area = areas.find(a => a.id === p.area_id)
                              return (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                  <span style={{ fontWeight: 800, fontSize: '13px', color: '#6366f1', width: '22px', textAlign: 'center' }}>{idx + 1}</span>
                                  <span style={{ fontSize: '20px' }}>{area?.icono ?? '📍'}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '13.5px', color: '#0f172a' }}>{area?.nombre ?? 'Área eliminada'}</div>
                                    {p.instrucciones && <div style={{ fontSize: '12px', color: '#64748b' }}>{p.instrucciones}</div>}
                                    {p.tiempo_estimado_min && <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>⏱ {p.tiempo_estimado_min} min</div>}
                                  </div>
                                  {canEdit && (
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button onClick={() => movePunto(p, 'up')} disabled={idx === 0} style={{ padding: '4px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontSize: '12px' }}>▲</button>
                                      <button onClick={() => movePunto(p, 'down')} disabled={idx === puntos.length - 1} style={{ padding: '4px 8px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: idx === puntos.length - 1 ? 'default' : 'pointer', opacity: idx === puntos.length - 1 ? 0.3 : 1, fontSize: '12px' }}>▼</button>
                                      <button onClick={() => deletePunto(p.id)} style={{ padding: '4px 8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer', color: '#dc2626', fontSize: '12px' }}>✕</button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Add punto */}
                        {canCreate && !addingPunto && (
                          <button onClick={() => setAddingPunto(true)}
                            style={{ padding: '7px 14px', background: '#f5f3ff', color: '#6366f1', border: '1.5px dashed #a5b4fc', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                            + Agregar punto de control
                          </button>
                        )}

                        {addingPunto && (
                          <div style={{ background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: '10px', padding: '14px', marginTop: '8px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                              <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Área *</label>
                                <select value={newPuntoAreaId} onChange={e => setNewPuntoAreaId(e.target.value)}
                                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #c4b5fd', borderRadius: '8px', fontSize: '13.5px', background: 'white' }}>
                                  <option value="">Seleccionar área...</option>
                                  {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Instrucciones</label>
                                <input value={newPuntoInstrucciones} onChange={e => setNewPuntoInstrucciones(e.target.value)} placeholder="Verificar puertas, revisar cámaras..."
                                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #c4b5fd', borderRadius: '8px', fontSize: '13.5px', background: 'white' }} />
                              </div>
                              <div>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tiempo est. (min)</label>
                                <input type="number" value={newPuntoTiempo} onChange={e => setNewPuntoTiempo(e.target.value)} placeholder="5"
                                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #c4b5fd', borderRadius: '8px', fontSize: '13.5px', background: 'white' }} />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={addPunto} disabled={saving || !newPuntoAreaId} style={{ padding: '8px 18px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: '7px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                                {saving ? '...' : 'Agregar'}
                              </button>
                              <button onClick={() => { setAddingPunto(false); setNewPuntoAreaId(''); setNewPuntoInstrucciones(''); setNewPuntoTiempo('') }}
                                style={{ padding: '8px 14px', background: 'white', color: '#374151', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

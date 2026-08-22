import { useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import {
  createCondominioRow,
  createCondominioRowReturning,
  updateCondominioRow,
  deleteCondominioRow,
} from '../../../domain/condominios/tabMutations'
import { AreasCatalog } from '../AreasCatalog'
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

function blank_ruta(): { nombre: string; descripcion: string; tiempo_estimado_min: string } {
  return { nombre: '', descripcion: '', tiempo_estimado_min: '' }
}

export function RutasRondaTab({ areas, rutas, puntosControl, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [vista, setVista] = useState<'areas' | 'rutas'>('areas')
  const [saving, setSaving] = useState(false)

  // ── Rutas state ─────────────────────────────────────────────
  const [showRutaForm, setShowRutaForm] = useState(false)
  const [editRutaId, setEditRutaId] = useState<string | null>(null)
  const [rutaForm, setRutaForm] = useState(blank_ruta())
  const [selectedRutaId, setSelectedRutaId] = useState<string | null>(null)
  const [addingPunto, setAddingPunto] = useState(false)
  const [newPuntoAreaId, setNewPuntoAreaId] = useState('')
  const [newPuntoInstrucciones, setNewPuntoInstrucciones] = useState('')
  const [newPuntoTiempo, setNewPuntoTiempo] = useState('')

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
    if (!rutaForm.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre de la ruta.' }); return }
    setSaving(true)
    if (editRutaId) {
      const { error } = await updateCondominioRow('rutas_ronda', editRutaId, {
        nombre: rutaForm.nombre.trim(), descripcion: rutaForm.descripcion.trim() || null,
        tiempo_estimado_min: rutaForm.tiempo_estimado_min ? parseInt(rutaForm.tiempo_estimado_min) : null,
      })
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    } else {
      const { data, error } = await createCondominioRowReturning('rutas_ronda', {
        company_id: companyId, project_id: proyectoId,
        nombre: rutaForm.nombre.trim(), descripcion: rutaForm.descripcion.trim() || null,
        tiempo_estimado_min: rutaForm.tiempo_estimado_min ? parseInt(rutaForm.tiempo_estimado_min) : null,
      })
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
      if (data) setSelectedRutaId(data.id as string)
    }
    setSaving(false); resetRutaForm(); onRefresh()
  }

  async function deleteRuta(id: string) {
    const r = await confirm({ title: '¿Eliminar ruta?', text: 'Se eliminarán también los puntos de control.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('rutas_ronda', id)
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
    const { error } = await createCondominioRow('puntos_control_ruta', {
      ruta_id: selectedRutaId, area_id: newPuntoAreaId,
      orden: maxOrden + 1,
      instrucciones: newPuntoInstrucciones.trim() || null,
      tiempo_estimado_min: newPuntoTiempo ? parseInt(newPuntoTiempo) : null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setNewPuntoAreaId(''); setNewPuntoInstrucciones(''); setNewPuntoTiempo('')
    setAddingPunto(false); onRefresh()
  }

  async function deletePunto(id: string) {
    await deleteCondominioRow('puntos_control_ruta', id)
    onRefresh()
  }

  async function movePunto(punto: PuntoControlRuta, dir: 'up' | 'down') {
    const puntos = puntosDeRuta(punto.ruta_id)
    const idx = puntos.findIndex(p => p.id === punto.id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= puntos.length) return
    const swap = puntos[swapIdx]
    await Promise.all([
      updateCondominioRow('puntos_control_ruta', punto.id, { orden: swap.orden }),
      updateCondominioRow('puntos_control_ruta', swap.id, { orden: punto.orden }),
    ])
    onRefresh()
  }

  const areasActivas = areas.filter(a => a.activo).sort((a, b) => a.orden - b.orden)

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Rutas de Ronda</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {areas.length} áreas · {rutas.filter(r => r.activo).length} rutas activas
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {vista === 'rutas' && canCreate && (
            <button onClick={() => { resetRutaForm(); setShowRutaForm(true) }}
              style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
              + Nueva ruta
            </button>
          )}
        </div>
      </div>

      {/* Vista toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {(['areas', 'rutas'] as const).map(v => (
          <button key={v} onClick={() => setVista(v)}
            style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vista === v ? 'var(--at-accent)' : 'var(--at-line)', background: vista === v ? 'var(--at-accent-tint)' : 'var(--at-surface)', color: vista === v ? 'var(--at-accent)' : 'var(--at-ink-3)' }}>
            {v === 'areas' ? `📍 Áreas (${areas.length})` : `🗺 Rutas (${rutas.length})`}
          </button>
        ))}
      </div>

      {/* ─── ÁREAS (catálogo compartido con Limpieza) ───────────────────── */}
      {vista === 'areas' && (
        <AreasCatalog
          areas={areas}
          proyectoId={proyectoId}
          companyId={companyId}
          canCreate={canCreate}
          canEdit={canEdit}
          onRefresh={onRefresh}
        />
      )}

      {/* ─── RUTAS ──────────────────────────────────────────────────────── */}
      {vista === 'rutas' && (
        <>
          {showRutaForm && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editRutaId ? 'Editar ruta' : 'Nueva ruta de ronda'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Nombre de la ruta *</label>
                  <input value={rutaForm.nombre} onChange={e => setRutaForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Ronda nocturna, Ronda diurna..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tiempo estimado (min)</label>
                  <input type="number" value={rutaForm.tiempo_estimado_min} onChange={e => setRutaForm(f => ({ ...f, tiempo_estimado_min: e.target.value }))} placeholder="45"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción</label>
                  <input value={rutaForm.descripcion} onChange={e => setRutaForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción de la ruta..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={saveRuta} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : editRutaId ? 'Actualizar' : 'Guardar'}
                </button>
                <button onClick={resetRutaForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {rutas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '56px', color: 'var(--at-ink-3)' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🗺️</div>
              <p style={{ fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Sin rutas de ronda</p>
              <p style={{ fontSize: '13px' }}>Crea una ruta y añade las áreas que el guardia debe recorrer en orden.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {rutas.map(ruta => {
                const puntos = puntosDeRuta(ruta.id)
                const isOpen = selectedRutaId === ruta.id
                return (
                  <div key={ruta.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${isOpen ? 'var(--at-accent)' : 'var(--at-line)'}`, borderRadius: '16px', overflow: 'hidden' }}>
                    {/* Ruta header */}
                    <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }}
                      onClick={() => setSelectedRutaId(isOpen ? null : ruta.id)}>
                      <span style={{ fontSize: '24px' }}>🗺️</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)' }}>{ruta.nombre}</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '14px', marginTop: '2px', flexWrap: 'wrap' }}>
                          {ruta.tiempo_estimado_min && <span>⏱ ~{ruta.tiempo_estimado_min} min</span>}
                          <span>📍 {puntos.length} punto{puntos.length !== 1 ? 's' : ''}</span>
                          {!ruta.activo && <span style={{ color: 'var(--at-danger)' }}>Inactiva</span>}
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => startEditRuta(ruta)} style={{ padding: '6px 12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️</button>
                          <button onClick={() => deleteRuta(ruta.id)} style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>
                        </div>
                      )}
                      <span style={{ color: 'var(--at-ink-3)', fontSize: '16px', transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                    </div>

                    {/* Puntos de la ruta */}
                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--at-line)', padding: '16px 20px' }}>
                        {puntos.length === 0 ? (
                          <p style={{ color: 'var(--at-ink-3)', fontSize: '13px', margin: '0 0 12px' }}>Sin puntos de control. Agrega las áreas que componen esta ruta.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                            {puntos.map((p, idx) => {
                              const area = areas.find(a => a.id === p.area_id)
                              return (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--at-surface-2)', borderRadius: '10px', border: '1px solid var(--at-line)' }}>
                                  <span style={{ fontWeight: 800, fontSize: '13px', color: 'var(--at-accent)', width: '22px', textAlign: 'center' }}>{idx + 1}</span>
                                  <span style={{ fontSize: '20px' }}>{area?.icono ?? '📍'}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--at-ink)' }}>{area?.nombre ?? 'Área eliminada'}</div>
                                    {p.instrucciones && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{p.instrucciones}</div>}
                                    {p.tiempo_estimado_min && <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>⏱ {p.tiempo_estimado_min} min</div>}
                                  </div>
                                  {canEdit && (
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button onClick={() => movePunto(p, 'up')} disabled={idx === 0} style={{ padding: '4px 8px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontSize: '12px' }}>▲</button>
                                      <button onClick={() => movePunto(p, 'down')} disabled={idx === puntos.length - 1} style={{ padding: '4px 8px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: idx === puntos.length - 1 ? 'default' : 'pointer', opacity: idx === puntos.length - 1 ? 0.3 : 1, fontSize: '12px' }}>▼</button>
                                      <button onClick={() => deletePunto(p.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '12px' }}>✕</button>
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
                            style={{ padding: '7px 14px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent)', border: '1.5px dashed var(--at-accent-soft)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                            + Agregar punto de control
                          </button>
                        )}

                        {addingPunto && (
                          <div style={{ background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-accent-soft)', borderRadius: '10px', padding: '14px', marginTop: '8px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                              <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Área *</label>
                                <select value={newPuntoAreaId} onChange={e => setNewPuntoAreaId(e.target.value)}
                                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-accent-soft)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface)' }}>
                                  <option value="">Seleccionar área...</option>
                                  {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Instrucciones</label>
                                <input value={newPuntoInstrucciones} onChange={e => setNewPuntoInstrucciones(e.target.value)} placeholder="Verificar puertas, revisar cámaras..."
                                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-accent-soft)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface)' }} />
                              </div>
                              <div>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tiempo est. (min)</label>
                                <input type="number" value={newPuntoTiempo} onChange={e => setNewPuntoTiempo(e.target.value)} placeholder="5"
                                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-accent-soft)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface)' }} />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={addPunto} disabled={saving || !newPuntoAreaId} style={{ padding: '8px 18px', background: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', color: 'white', border: 'none', borderRadius: '7px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                                {saving ? '...' : 'Agregar'}
                              </button>
                              <button onClick={() => { setAddingPunto(false); setNewPuntoAreaId(''); setNewPuntoInstrucciones(''); setNewPuntoTiempo('') }}
                                style={{ padding: '8px 14px', background: 'var(--at-surface)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>
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

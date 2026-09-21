// Rutas de ronda: el recorrido de vigilancia y el catálogo de sitios que lo
// componen. Desde 20260921000000 vive en la sección SEGURIDAD, no en Recursos
// Humanos: una ruta no reparte jornada, describe qué se vigila y en qué orden, y
// su contraparte es la ronda que se ejecuta en el tab Seguridad.
//
// TRES VISTAS, TRES NIVELES DEL MISMO CATÁLOGO:
//   · Áreas   — solo lectura. Se administran en el tab Áreas (punto único de
//               alta); aquí son la referencia de qué se puede encadenar.
//   · Puntos  — el catálogo de puntos de verificación: los sitios concretos que
//               se revisan dentro de cada área. Se dan de alta una vez (de a
//               uno, en lote, o generados desde las áreas).
//   · Rutas   — el recorrido: se ASIGNAN puntos del catálogo, varios de una vez,
//               y se ordenan. Ya no se re-escribe cada parada por ruta.
import { useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import {
  createCondominioRow,
  createCondominioRowReturning,
  updateCondominioRow,
  deleteCondominioRow,
} from '../../../domain/condominios/tabMutations'
import { AreasResumen } from '../AreasResumen'
import { PuntosVerificacionCatalog } from '../PuntosVerificacionCatalog'
import { puntoExigeFoto } from '../../../types'
import type { AreaCondominio, RutaRonda, PuntoControlRuta, PuntoVerificacion } from '../../../types'

interface Props {
  areas: AreaCondominio[]
  rutas: RutaRonda[]
  puntosControl: PuntoControlRuta[]
  puntosVerificacion: PuntoVerificacion[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  /** Visibilidad del tab "Áreas": decide si se ofrece el atajo para configurarlas. */
  puedeConfigurarAreas: boolean
  onIrATab: (tabId: 'areas_config') => void
  onRefresh: () => void
}

type Vista = 'areas' | 'puntos' | 'rutas'

function blank_ruta(): { nombre: string; descripcion: string; tiempo_estimado_min: string } {
  return { nombre: '', descripcion: '', tiempo_estimado_min: '' }
}

/** Las tres opciones del override de evidencia de una parada. */
const OPCIONES_FOTO = [
  { valor: 'hereda', label: 'Según el punto' },
  { valor: 'si', label: '📷 Exige foto' },
  { valor: 'no', label: 'Sin foto' },
] as const

export function RutasRondaTab({
  areas, rutas, puntosControl, puntosVerificacion, proyectoId, companyId,
  canCreate, canEdit, canDelete, puedeConfigurarAreas, onIrATab, onRefresh,
}: Props) {
  // Arranca en Rutas: desde que el catálogo se administra en su propio tab, la
  // vista de áreas aquí es referencia (qué puedo encadenar), no el trabajo.
  const [vista, setVista] = useState<Vista>('rutas')
  const [saving, setSaving] = useState(false)

  // ── Rutas state ─────────────────────────────────────────────
  const [showRutaForm, setShowRutaForm] = useState(false)
  const [editRutaId, setEditRutaId] = useState<string | null>(null)
  const [rutaForm, setRutaForm] = useState(blank_ruta())
  const [selectedRutaId, setSelectedRutaId] = useState<string | null>(null)
  // Selección múltiple del catálogo para armar la ruta de un tirón.
  const [eligiendoPuntos, setEligiendoPuntos] = useState(false)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

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
    const r = await confirm({ title: '¿Eliminar ruta?', text: 'Se eliminarán también sus paradas. Los puntos del catálogo NO se borran: quedan disponibles para otras rutas.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('rutas_ronda', id)
    if (selectedRutaId === id) setSelectedRutaId(null)
    onRefresh()
  }

  // ── Paradas helpers ──────────────────────────────────────────
  const puntosDeRuta = (rutaId: string) =>
    puntosControl.filter(p => p.ruta_id === rutaId).sort((a, b) => a.orden - b.orden)

  /** Cuántas rutas usan cada punto del catálogo (lo muestra el catálogo). */
  const usosPorPunto = puntosControl.reduce<Record<string, number>>((acc, p) => {
    if (p.punto_id) acc[p.punto_id] = (acc[p.punto_id] ?? 0) + 1
    return acc
  }, {})

  const ordenDeArea = (areaId: string) => {
    const a = areas.find(x => x.id === areaId)
    return a ? a.orden : Number.MAX_SAFE_INTEGER
  }

  /** Catálogo activo, en orden de recorrido: por área, y dentro del área por orden. */
  const puntosCatalogoOrdenados = puntosVerificacion
    .filter(p => p.activo)
    .sort((a, b) =>
      ordenDeArea(a.area_id) - ordenDeArea(b.area_id) ||
      (a.area_nombre ?? '').localeCompare(b.area_nombre ?? '') ||
      a.orden - b.orden ||
      a.nombre.localeCompare(b.nombre))

  function abrirSelector() {
    setSeleccion(new Set()); setEligiendoPuntos(true)
  }

  function togglePunto(id: string) {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  /** Alta en LOTE de las paradas: una sola escritura, el orden ya resuelto. */
  async function agregarSeleccionados() {
    if (!selectedRutaId || seleccion.size === 0) return
    const existentes = puntosDeRuta(selectedRutaId)
    const maxOrden = existentes.length ? Math.max(...existentes.map(p => p.orden)) : -1
    // El orden del catálogo (área, luego orden del punto) es el que se propone:
    // recorrer un área entera antes de pasar a la siguiente es lo que hace un
    // guardia. Después se reordena a mano con las flechas.
    const aAgregar = puntosCatalogoOrdenados.filter(p => seleccion.has(p.id))
    setSaving(true)
    const { error } = await createCondominioRow('puntos_control_ruta', aAgregar.map((p, i) => ({
      ruta_id: selectedRutaId,
      punto_id: p.id,
      // area_id se manda explícito y debe ser el del punto: la FK compuesta
      // (punto_id, area_id) del motor no acepta otra cosa.
      area_id: p.area_id,
      orden: maxOrden + 1 + i,
      instrucciones: p.instrucciones,
      tiempo_estimado_min: p.tiempo_estimado_min,
    })))
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `${aAgregar.length} punto${aAgregar.length !== 1 ? 's' : ''} agregado${aAgregar.length !== 1 ? 's' : ''}`, duration: 1600 })
    setSeleccion(new Set()); setEligiendoPuntos(false); onRefresh()
  }

  async function deletePunto(id: string) {
    await deleteCondominioRow('puntos_control_ruta', id)
    onRefresh()
  }

  async function cambiarFoto(punto: PuntoControlRuta, valor: string) {
    const requiere_foto = valor === 'hereda' ? null : valor === 'si'
    const { error } = await updateCondominioRow('puntos_control_ruta', punto.id, { requiere_foto })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
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

  const rutasActivas = rutas.filter(r => r.activo).length

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Rutas de Ronda</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {areas.length} áreas · {puntosVerificacion.length} puntos · {rutasActivas} rutas activas
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
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {([
          { v: 'areas' as const, label: `📍 Áreas (${areas.length})` },
          { v: 'puntos' as const, label: `🧭 Puntos (${puntosVerificacion.length})` },
          { v: 'rutas' as const, label: `🗺 Rutas (${rutas.length})` },
        ]).map(({ v, label }) => (
          <button key={v} onClick={() => setVista(v)}
            style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vista === v ? 'var(--at-accent)' : 'var(--at-line)', background: vista === v ? 'var(--at-accent-tint)' : 'var(--at-surface)', color: vista === v ? 'var(--at-accent)' : 'var(--at-ink-3)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ─── ÁREAS (catálogo compartido, de solo lectura desde aquí) ─────── */}
      {vista === 'areas' && (
        <AreasResumen
          areas={areas}
          uso="los puntos de verificación de cada área"
          onConfigurar={puedeConfigurarAreas ? () => onIrATab('areas_config') : undefined}
        />
      )}

      {/* ─── PUNTOS (el catálogo que alimenta las rutas) ─────────────────── */}
      {vista === 'puntos' && (
        <PuntosVerificacionCatalog
          areas={areas}
          puntos={puntosVerificacion}
          usosPorPunto={usosPorPunto}
          proyectoId={proyectoId}
          companyId={companyId}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
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
              <p style={{ fontSize: '13px' }}>Crea una ruta y asígnale los puntos de verificación que el guardia debe recorrer en orden.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {rutas.map(ruta => {
                const puntos = puntosDeRuta(ruta.id)
                const isOpen = selectedRutaId === ruta.id
                const conFoto = puntos.filter(puntoExigeFoto).length
                return (
                  <div key={ruta.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${isOpen ? 'var(--at-accent)' : 'var(--at-line)'}`, borderRadius: '16px', overflow: 'hidden' }}>
                    {/* Ruta header */}
                    <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }}
                      onClick={() => { setSelectedRutaId(isOpen ? null : ruta.id); setEligiendoPuntos(false) }}>
                      <span style={{ fontSize: '24px' }}>🗺️</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)' }}>{ruta.nombre}</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '14px', marginTop: '2px', flexWrap: 'wrap' }}>
                          {ruta.tiempo_estimado_min && <span>⏱ ~{ruta.tiempo_estimado_min} min</span>}
                          <span>📍 {puntos.length} punto{puntos.length !== 1 ? 's' : ''}</span>
                          {conFoto > 0 && <span>📷 {conFoto} con foto</span>}
                          {!ruta.activo && <span style={{ color: 'var(--at-danger)' }}>Inactiva</span>}
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => startEditRuta(ruta)} aria-label={`Editar ${ruta.nombre}`} style={{ padding: '6px 12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️</button>
                          <button onClick={() => deleteRuta(ruta.id)} aria-label={`Eliminar ${ruta.nombre}`} style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>
                        </div>
                      )}
                      <span style={{ color: 'var(--at-ink-3)', fontSize: '16px', transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                    </div>

                    {/* Paradas de la ruta */}
                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--at-line)', padding: '16px 20px' }}>
                        {puntos.length === 0 ? (
                          <p style={{ color: 'var(--at-ink-3)', fontSize: '13px', margin: '0 0 12px' }}>Sin paradas. Asigna los puntos de verificación que componen esta ruta.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                            {puntos.map((p, idx) => {
                              const area = areas.find(a => a.id === p.area_id)
                              const exige = puntoExigeFoto(p)
                              const valorFoto = p.requiere_foto == null ? 'hereda' : p.requiere_foto ? 'si' : 'no'
                              return (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--at-surface-2)', borderRadius: '10px', border: '1px solid var(--at-line)' }}>
                                  <span style={{ fontWeight: 800, fontSize: '13px', color: 'var(--at-accent)', width: '22px', textAlign: 'center' }}>{idx + 1}</span>
                                  <span style={{ fontSize: '20px' }}>{area?.icono ?? '📍'}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--at-ink)' }}>
                                      {/* Sin `punto_nombre` la parada es legada (anterior al catálogo):
                                          se identificaba solo por el área, y así se sigue mostrando. */}
                                      {p.punto_nombre ?? area?.nombre ?? 'Área eliminada'}
                                      {exige && <span title="Exige imagen para cerrarse" style={{ marginLeft: '6px' }}>📷</span>}
                                    </div>
                                    {p.punto_nombre && area && <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{area.nombre}</div>}
                                    {p.instrucciones && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{p.instrucciones}</div>}
                                    {p.tiempo_estimado_min && <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>⏱ {p.tiempo_estimado_min} min</div>}
                                  </div>
                                  {canEdit && (
                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                      {p.punto_id && (
                                        <select value={valorFoto} onChange={e => cambiarFoto(p, e.target.value)}
                                          aria-label={`Evidencia de ${p.punto_nombre ?? 'la parada'}`}
                                          title="Evidencia fotográfica en esta ruta"
                                          style={{ padding: '4px 6px', border: '1px solid var(--at-line)', borderRadius: '6px', fontSize: '11.5px', background: 'var(--at-surface)', color: 'var(--at-ink-2)' }}>
                                          {OPCIONES_FOTO.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                                        </select>
                                      )}
                                      <button onClick={() => movePunto(p, 'up')} disabled={idx === 0} aria-label="Subir" style={{ padding: '4px 8px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontSize: '12px' }}>▲</button>
                                      <button onClick={() => movePunto(p, 'down')} disabled={idx === puntos.length - 1} aria-label="Bajar" style={{ padding: '4px 8px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: idx === puntos.length - 1 ? 'default' : 'pointer', opacity: idx === puntos.length - 1 ? 0.3 : 1, fontSize: '12px' }}>▼</button>
                                      <button onClick={() => deletePunto(p.id)} aria-label="Quitar de la ruta" style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '12px' }}>✕</button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Asignación desde el catálogo */}
                        {canCreate && !eligiendoPuntos && (
                          puntosCatalogoOrdenados.length === 0 ? (
                            <div style={{ padding: '12px 14px', background: 'var(--at-accent-tint-2)', border: '1.5px dashed var(--at-accent-soft)', borderRadius: '10px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                              El catálogo de puntos está vacío.{' '}
                              <button onClick={() => setVista('puntos')}
                                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--at-accent)', fontWeight: 700, cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}>
                                Créalos en la pestaña Puntos
                              </button>{' '}
                              y vuelve a asignarlos aquí.
                            </div>
                          ) : (
                            <button onClick={abrirSelector}
                              style={{ padding: '7px 14px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent)', border: '1.5px dashed var(--at-accent-soft)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                              + Asignar puntos del catálogo
                            </button>
                          )
                        )}

                        {eligiendoPuntos && (
                          <div style={{ background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-accent-soft)', borderRadius: '10px', padding: '14px', marginTop: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Puntos del catálogo</span>
                              <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                                Marca los que recorre esta ruta. Un punto puede estar en varias.
                              </span>
                            </div>
                            <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                              {puntosCatalogoOrdenados.map((pv, i, arr) => {
                                const area = areas.find(a => a.id === pv.area_id)
                                const nuevaArea = i === 0 || arr[i - 1].area_id !== pv.area_id
                                const yaEsta = puntos.some(p => p.punto_id === pv.id)
                                return (
                                  <div key={pv.id}>
                                    {nuevaArea && (
                                      <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-ink-3)', padding: '8px 4px 3px' }}>
                                        {area?.icono ?? '📍'} {area?.nombre ?? pv.area_nombre ?? 'Sin área'}
                                      </div>
                                    )}
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '7px 10px', background: 'var(--at-surface)', borderRadius: '8px', border: '1px solid var(--at-line)', cursor: yaEsta ? 'default' : 'pointer', opacity: yaEsta ? 0.5 : 1 }}>
                                      <input type="checkbox" disabled={yaEsta} checked={seleccion.has(pv.id)} onChange={() => togglePunto(pv.id)} />
                                      <span style={{ flex: 1, minWidth: 0, fontSize: '13px', color: 'var(--at-ink)', fontWeight: 600 }}>{pv.nombre}</span>
                                      {pv.requiere_foto && <span title="Exige imagen">📷</span>}
                                      {pv.tiempo_estimado_min && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>⏱ {pv.tiempo_estimado_min}′</span>}
                                      {yaEsta && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>ya en la ruta</span>}
                                    </label>
                                  </div>
                                )
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <button onClick={agregarSeleccionados} disabled={saving || seleccion.size === 0}
                                style={{ padding: '8px 18px', background: seleccion.size === 0 ? 'var(--at-chip)' : 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', color: seleccion.size === 0 ? 'var(--at-ink-3)' : 'white', border: 'none', borderRadius: '7px', fontWeight: 600, cursor: seleccion.size === 0 ? 'default' : 'pointer', fontSize: '13px' }}>
                                {saving ? '...' : `Agregar ${seleccion.size || ''} punto${seleccion.size !== 1 ? 's' : ''}`.trim()}
                              </button>
                              <button onClick={() => { setEligiendoPuntos(false); setSeleccion(new Set()) }}
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

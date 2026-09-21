// Catálogo de puntos de verificación (`puntos_verificacion`, 20260921000100).
//
// QUÉ RESUELVE. Antes, un punto de control solo existía DENTRO de una ruta: la
// fila era (ruta, área, orden, instrucciones). Quien armaba la ronda escribía a
// mano cada parada, cada vez, y la ronda diurna y la nocturna terminaban con
// textos distintos para el mismo sitio. Aquí el punto se da de alta UNA vez —de
// a uno, en lote o generándolo desde las áreas— y después solo se ASIGNA a las
// rutas que lo recorran (RutasRondaTab).
//
// El área NO se administra desde aquí: su punto único de alta es el tab Áreas
// (ver AreasCatalog). Este catálogo cuelga de ese, no lo reemplaza.
import { useState, type CSSProperties } from 'react'
import { notify, confirm } from '../shared/Dialog'
import { EmptyState } from '../shared/EmptyState'
import {
  createCondominioRow, deleteCondominioRow, updateCondominioRow,
} from '../../domain/condominios/tabMutations'
import {
  areasSinPuntos, parsearAltaMasiva, puntoDuplicado,
} from '../../domain/condominios/puntosVerificacion'
import type { AreaCondominio, PuntoVerificacion } from '../../types'

interface Props {
  areas: AreaCondominio[]
  puntos: PuntoVerificacion[]
  /** Cuántas rutas usan cada punto, para avisar antes de retirarlo. */
  usosPorPunto: Record<string, number>
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

interface FormState {
  area_id: string
  nombre: string
  instrucciones: string
  tiempo_estimado_min: string
  requiere_foto: boolean
  activo: boolean
}

function blankForm(areaId = ''): FormState {
  return {
    area_id: areaId, nombre: '', instrucciones: '',
    tiempo_estimado_min: '', requiere_foto: false, activo: true,
  }
}

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  background: 'var(--at-surface-2)',
}
const labelStyle: CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px',
}
const btnPrimario: CSSProperties = {
  padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))',
  color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px',
}
const btnSecundario: CSSProperties = {
  padding: '9px 16px', background: 'var(--at-surface)', color: 'var(--at-ink-2)',
  border: '1.5px solid var(--at-line)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px',
}

export function PuntosVerificacionCatalog({
  areas, puntos, usosPorPunto, proyectoId, companyId,
  canCreate, canEdit, canDelete, onRefresh,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [modo, setModo] = useState<'cerrado' | 'uno' | 'lote'>('cerrado')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(blankForm())

  // Alta masiva: un área, muchos nombres (uno por línea).
  const [loteAreaId, setLoteAreaId] = useState('')
  const [loteTexto, setLoteTexto] = useState('')
  const [loteFoto, setLoteFoto] = useState(false)
  const [loteTiempo, setLoteTiempo] = useState('')

  const areasActivas = areas.filter(a => a.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const areaDe = (id: string) => areas.find(a => a.id === id)
  const pendientes = areasSinPuntos(areas, puntos)

  function cerrar() {
    setModo('cerrado'); setEditId(null); setForm(blankForm())
    setLoteTexto(''); setLoteFoto(false); setLoteTiempo('')
  }

  function startEdit(p: PuntoVerificacion) {
    setEditId(p.id)
    setForm({
      area_id: p.area_id, nombre: p.nombre, instrucciones: p.instrucciones ?? '',
      tiempo_estimado_min: p.tiempo_estimado_min?.toString() ?? '',
      requiere_foto: p.requiere_foto, activo: p.activo,
    })
    setModo('uno')
  }

  // ── Alta / edición de a uno ─────────────────────────────────────────────
  async function guardar() {
    if (!form.area_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione el área del punto.' }); return }
    if (!form.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre del punto.' }); return }
    const dup = puntoDuplicado(form.nombre, form.area_id, puntos, editId ?? undefined)
    if (dup) {
      notify({
        variant: 'error', title: 'Punto duplicado',
        text: `"${dup.nombre.trim()}"${dup.activo ? '' : ' (inactivo)'} ya existe en ${areaDe(form.area_id)?.nombre ?? 'esa área'}. Edítalo o reactívalo en lugar de crearlo de nuevo.`,
      })
      return
    }
    setSaving(true)
    const payload = {
      area_id: form.area_id,
      nombre: form.nombre.trim(),
      instrucciones: form.instrucciones.trim() || null,
      tiempo_estimado_min: form.tiempo_estimado_min ? parseInt(form.tiempo_estimado_min) : null,
      requiere_foto: form.requiere_foto,
      activo: form.activo,
    }
    const { error } = editId
      ? await updateCondominioRow('puntos_verificacion', editId, payload)
      : await createCondominioRow('puntos_verificacion', {
          ...payload, company_id: companyId, project_id: proyectoId,
          orden: puntos.filter(p => p.area_id === form.area_id).length,
        })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    cerrar(); onRefresh()
  }

  // ── Alta masiva: una línea = un punto ───────────────────────────────────
  async function guardarLote() {
    if (!loteAreaId) { notify({ variant: 'error', title: 'Error', text: 'Seleccione el área.' }); return }
    const { nuevos, repetidos } = parsearAltaMasiva(loteTexto, loteAreaId, puntos)
    if (nuevos.length === 0) {
      notify({
        variant: 'error', title: 'Nada que crear',
        text: repetidos.length > 0
          ? `Los ${repetidos.length} nombres del pegado ya existen en esta área.`
          : 'Escribe al menos un punto (uno por línea).',
      })
      return
    }
    const base = puntos.filter(p => p.area_id === loteAreaId).length
    setSaving(true)
    const { error } = await createCondominioRow('puntos_verificacion', nuevos.map((nombre, i) => ({
      company_id: companyId, project_id: proyectoId, area_id: loteAreaId,
      nombre,
      tiempo_estimado_min: loteTiempo ? parseInt(loteTiempo) : null,
      requiere_foto: loteFoto,
      orden: base + i,
      activo: true,
    })))
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({
      variant: 'success',
      title: `${nuevos.length} punto${nuevos.length !== 1 ? 's' : ''} creado${nuevos.length !== 1 ? 's' : ''}`,
      text: repetidos.length > 0 ? `Se omitieron ${repetidos.length} que ya existían.` : undefined,
      duration: 2200,
    })
    cerrar(); onRefresh()
  }

  // ── Generar un punto por área que todavía no tiene ninguno ──────────────
  async function generarDesdeAreas() {
    if (pendientes.length === 0) return
    const r = await confirm({
      title: `¿Generar ${pendientes.length} punto${pendientes.length !== 1 ? 's' : ''}?`,
      text: `Se crea un punto por cada área activa que todavía no tiene ninguno, con el nombre del área. Después los editas o les agregas más.`,
      icon: 'question', confirmText: 'Generar',
    })
    if (!r.isConfirmed) return
    setSaving(true)
    const { error } = await createCondominioRow('puntos_verificacion', pendientes.map(a => ({
      company_id: companyId, project_id: proyectoId, area_id: a.id,
      nombre: a.nombre, requiere_foto: false, orden: 0, activo: true,
    })))
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `${pendientes.length} puntos generados`, duration: 1800 })
    onRefresh()
  }

  async function toggleActivo(p: PuntoVerificacion) {
    const { error } = await updateCondominioRow('puntos_verificacion', p.id, { activo: !p.activo })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function eliminar(p: PuntoVerificacion) {
    const usos = usosPorPunto[p.id] ?? 0
    const r = await confirm({
      title: '¿Eliminar punto?',
      text: usos > 0
        ? `${p.nombre} está en ${usos} ruta${usos !== 1 ? 's' : ''}: al eliminarlo desaparece de ellas. Si solo quieres dejar de usarlo, desactívalo.`
        : `${p.nombre} — no está en ninguna ruta.`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('puntos_verificacion', p.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  // ── Agrupación por área, en el orden del catálogo de áreas ──────────────
  const grupos = areas
    .map(a => ({ area: a, puntos: puntos.filter(p => p.area_id === a.id).sort((x, y) => x.orden - y.orden || x.nombre.localeCompare(y.nombre)) }))
    .filter(g => g.puntos.length > 0)
    .sort((a, b) => a.area.orden - b.area.orden || a.area.nombre.localeCompare(b.area.nombre))

  return (
    <div>
      {canCreate && modo === 'cerrado' && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <button onClick={() => { setForm(blankForm(areasActivas[0]?.id ?? '')); setEditId(null); setModo('uno') }} style={btnPrimario}>
            + Nuevo punto
          </button>
          <button onClick={() => { setLoteAreaId(areasActivas[0]?.id ?? ''); setModo('lote') }} style={btnSecundario}>
            📋 Alta masiva
          </button>
          {pendientes.length > 0 && (
            <button onClick={generarDesdeAreas} disabled={saving} style={btnSecundario}
              title="Crea un punto por área activa que todavía no tiene ninguno">
              ✨ Generar desde áreas ({pendientes.length})
            </button>
          )}
        </div>
      )}

      {/* ─── Alta / edición de a uno ──────────────────────────────────────── */}
      {modo === 'uno' && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editId ? 'Editar punto' : 'Nuevo punto de verificación'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle} htmlFor="pv-area">Área *</label>
              <select id="pv-area" value={form.area_id} onChange={e => setForm(f => ({ ...f, area_id: e.target.value }))} style={inputStyle}>
                <option value="">Seleccionar área...</option>
                {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="pv-nombre">Nombre del punto *</label>
              <input id="pv-nombre" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej. Puerta peatonal, Tablero eléctrico..." style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor="pv-instr">Instrucciones</label>
              <input id="pv-instr" value={form.instrucciones} onChange={e => setForm(f => ({ ...f, instrucciones: e.target.value }))}
                placeholder="Verificar candado, revisar cámara, anotar lectura..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="pv-tiempo">Tiempo est. (min)</label>
              <input id="pv-tiempo" type="number" min={1} value={form.tiempo_estimado_min}
                onChange={e => setForm(f => ({ ...f, tiempo_estimado_min: e.target.value }))} placeholder="5" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="pv-estado">Estado</label>
              <select id="pv-estado" value={String(form.activo)} onChange={e => setForm(f => ({ ...f, activo: e.target.value === 'true' }))} style={inputStyle}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>
            <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.requiere_foto} onChange={e => setForm(f => ({ ...f, requiere_foto: e.target.checked }))} />
              <span style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>📷 Documentar con imagen</span>
              <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>— el guardia no puede cerrar este punto sin foto</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={guardar} disabled={saving} style={btnPrimario}>
              {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Guardar'}
            </button>
            <button onClick={cerrar} style={btnSecundario}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ─── Alta masiva ──────────────────────────────────────────────────── */}
      {modo === 'lote' && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>Alta masiva de puntos</h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Un nombre por línea. Los que ya existan en el área se omiten solos.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle} htmlFor="pv-lote-area">Área *</label>
              <select id="pv-lote-area" value={loteAreaId} onChange={e => setLoteAreaId(e.target.value)} style={inputStyle}>
                <option value="">Seleccionar área...</option>
                {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="pv-lote-tiempo">Tiempo est. por punto (min)</label>
              <input id="pv-lote-tiempo" type="number" min={1} value={loteTiempo} onChange={e => setLoteTiempo(e.target.value)} placeholder="5" style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor="pv-lote-texto">Puntos (uno por línea) *</label>
              <textarea id="pv-lote-texto" value={loteTexto} onChange={e => setLoteTexto(e.target.value)} rows={7}
                placeholder={'Puerta peatonal\nPortón vehicular\nTablero eléctrico\nCámara norte'}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={loteFoto} onChange={e => setLoteFoto(e.target.checked)} />
              <span style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>📷 Todos exigen imagen</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', alignItems: 'center' }}>
            <button onClick={guardarLote} disabled={saving} style={btnPrimario}>
              {saving ? 'Creando...' : 'Crear puntos'}
            </button>
            <button onClick={cerrar} style={btnSecundario}>Cancelar</button>
            {loteAreaId && loteTexto.trim() && (
              <span style={{ fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                {parsearAltaMasiva(loteTexto, loteAreaId, puntos).nuevos.length} nuevo(s)
                {parsearAltaMasiva(loteTexto, loteAreaId, puntos).repetidos.length > 0 &&
                  ` · ${parsearAltaMasiva(loteTexto, loteAreaId, puntos).repetidos.length} repetido(s)`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ─── El catálogo, agrupado por área ───────────────────────────────── */}
      {grupos.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="Sin puntos de verificación"
          description="Da de alta los sitios concretos que se revisan en cada área (puerta peatonal, tablero, bomba). Después los asignas a las rutas que los recorren, sin volver a escribirlos."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {grupos.map(({ area, puntos: ps }) => (
            <div key={area.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '18px' }}>{area.icono}</span>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>{area.nombre}</h4>
                <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  {ps.length} punto{ps.length !== 1 ? 's' : ''}
                </span>
                {!area.activo && <span style={{ fontSize: '11.5px', color: 'var(--at-warning-strong)' }}>área inactiva</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                {ps.map(p => {
                  const usos = usosPorPunto[p.id] ?? 0
                  return (
                    <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${p.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '12px', padding: '13px', opacity: p.activo ? 1 : 0.55 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
                        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)' }}>{p.nombre}</div>
                        {p.requiere_foto && <span title="Exige imagen para cerrarse" style={{ fontSize: '13px' }}>📷</span>}
                      </div>
                      {p.instrucciones && <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--at-ink-3)' }}>{p.instrucciones}</p>}
                      <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: canEdit ? '10px' : 0 }}>
                        {p.tiempo_estimado_min && <span>⏱ {p.tiempo_estimado_min} min</span>}
                        <span>{usos > 0 ? `🗺 en ${usos} ruta${usos !== 1 ? 's' : ''}` : 'sin asignar'}</span>
                        {!p.activo && <span>Inactivo</span>}
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => startEdit(p)} style={{ flex: 1, padding: '5px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️ Editar</button>
                          <button onClick={() => toggleActivo(p)} style={{ padding: '5px 9px', background: p.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: `1px solid ${p.activo ? 'var(--at-warning-border)' : 'var(--at-success-border)'}`, borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: p.activo ? 'var(--at-warning-strong)' : 'var(--at-success)', fontWeight: 600 }}>
                            {p.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          {canDelete && (
                            <button onClick={() => eliminar(p)} aria-label={`Eliminar ${p.nombre}`}
                              style={{ padding: '5px 9px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)' }}>🗑</button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import {
  createCondominioRow,
  createCondominioRowReturning,
  updateCondominioRow,
  deleteCondominioRow,
} from '../../../domain/condominios/tabMutations'
import type {
  BloqueTurno, TareaBloque, PlantillaTareaCargo,
  PersonalCondominio, AreaCondominio,
  EstadoBloqueTurno, TurnoTipo, EstadoTareaBloque,
} from '../../../types'

interface Props {
  bloques: BloqueTurno[]
  tareas: TareaBloque[]
  plantillas: PlantillaTareaCargo[]
  personal: PersonalCondominio[]
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TURNO_CONFIG: Record<TurnoTipo, { label: string; icon: string; bg: string; color: string }> = {
  manana: { label: 'Mañana',  icon: '🌅', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  tarde:  { label: 'Tarde',   icon: '☀️',  bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  noche:  { label: 'Noche',   icon: '🌙', bg: 'var(--at-accent-tint)', color: 'var(--at-accent-dark)' },
}

const ESTADO_BLOQUE: Record<EstadoBloqueTurno, { label: string; bg: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
  en_curso:   { label: 'En curso',   bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  completado: { label: 'Completado', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  incompleto: { label: 'Incompleto', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

const ESTADO_TAREA: Record<EstadoTareaBloque, { label: string; icon: string; bg: string; color: string; border: string }> = {
  pendiente:       { label: 'Pendiente',       icon: '⏳', bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)', border: 'var(--at-line)' },
  completada:      { label: 'Completada',      icon: '✅', bg: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'var(--at-success-border)' },
  con_observacion: { label: 'Con observación', icon: '⚠️', bg: 'var(--at-warning-tint)', color: 'var(--at-warning)', border: 'var(--at-warning-border)' },
  omitida:         { label: 'Omitida',         icon: '⏭',  bg: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', border: 'var(--at-accent-soft-2)' },
}

function blankBloque(hoy: string) {
  return { personal_id: '', turno: 'manana' as TurnoTipo, fecha: hoy, notas: '' }
}

export function TareasPersonalTab({
  bloques, tareas, plantillas, personal, areas,
  proyectoId, companyId, userId, canCreate, canEdit, onRefresh,
}: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [saving, setSaving] = useState(false)
  const [showBloqueForm, setShowBloqueForm] = useState(false)
  const [bloqueForm, setBloqueForm] = useState(blankBloque(hoy))
  const [selectedPersonalId, setSelectedPersonalId] = useState<string>('todos')
  const [selectedFecha, setSelectedFecha] = useState<string>(hoy)
  const [bloqueAbierto, setBloqueAbierto] = useState<string | null>(null)

  // Tareas a agregar al bloque
  const [addingTarea, setAddingTarea] = useState(false)
  const [nuevaTarea, setNuevaTarea] = useState({ titulo: '', descripcion: '', area_id: '', plantilla_id: '', requiere_foto: false })

  const bloquesFiltrados = bloques.filter(b => {
    const porPersonal = selectedPersonalId === 'todos' || b.personal_id === selectedPersonalId
    const porFecha = !selectedFecha || b.fecha === selectedFecha
    return porPersonal && porFecha
  })

  const tareasDeBloque = (bloqueId: string) =>
    tareas.filter(t => t.bloque_id === bloqueId).sort((a, b) => a.orden - b.orden)

  // ── CRUD Bloque ─────────────────────────────────────────────
  async function crearBloque() {
    if (!bloqueForm.personal_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione el empleado.' }); return }
    setSaving(true)
    const { data, error } = await createCondominioRowReturning('bloques_turno', {
      company_id: companyId, project_id: proyectoId,
      personal_id: bloqueForm.personal_id, turno: bloqueForm.turno,
      fecha: bloqueForm.fecha, creado_por: userId,
      notas: bloqueForm.notas.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setBloqueForm(blankBloque(hoy)); setShowBloqueForm(false)
    if (data) setBloqueAbierto(data.id as string)
    onRefresh()
  }

  async function iniciarBloque(id: string) {
    await updateCondominioRow('bloques_turno', id, { estado: 'en_curso', iniciado_en: new Date().toISOString() })
    onRefresh()
  }

  async function cerrarBloque(id: string, estado: EstadoBloqueTurno) {
    const ts = tareasDeBloque(id)
    const completadas = ts.filter(t => t.estado === 'completada' || t.estado === 'con_observacion').length
    const puntaje = ts.length > 0 ? Math.round((completadas / ts.length) * 100) : 0
    await updateCondominioRow('bloques_turno', id, {
      estado, cerrado_en: new Date().toISOString(), puntaje_completitud: puntaje,
    })
    onRefresh()
  }

  async function deleteBloque(id: string) {
    const r = await confirm({ title: '¿Eliminar bloque?', text: 'Se eliminan también las tareas asociadas.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('bloques_turno', id)
    if (bloqueAbierto === id) setBloqueAbierto(null)
    onRefresh()
  }

  // ── CRUD Tarea ───────────────────────────────────────────────
  async function agregarTareaDesde(bloqueId: string) {
    if (!nuevaTarea.titulo.trim() && !nuevaTarea.plantilla_id) { notify({ variant: 'error', title: 'Error', text: 'Ingrese título o seleccione plantilla.' }); return }
    const plantilla = nuevaTarea.plantilla_id ? plantillas.find(p => p.id === nuevaTarea.plantilla_id) : null
    const ts = tareasDeBloque(bloqueId)
    const maxOrden = ts.length ? Math.max(...ts.map(t => t.orden)) : -1
    setSaving(true)
    const { error } = await createCondominioRow('tareas_bloque', {
      bloque_id: bloqueId,
      plantilla_id: nuevaTarea.plantilla_id || null,
      titulo: plantilla?.titulo ?? nuevaTarea.titulo.trim(),
      descripcion: (plantilla?.descripcion ?? nuevaTarea.descripcion.trim()) || null,
      area_id: nuevaTarea.area_id || plantilla?.area_id || null,
      requiere_foto: nuevaTarea.requiere_foto || plantilla?.requiere_foto || false,
      orden: maxOrden + 1,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setNuevaTarea({ titulo: '', descripcion: '', area_id: '', plantilla_id: '', requiere_foto: false })
    setAddingTarea(false); onRefresh()
  }

  async function agregarDesdePlantillas(bloqueId: string, cargo: string) {
    const pls = plantillas.filter(p => p.cargo === cargo && p.activo).sort((a, b) => a.orden - b.orden)
    if (pls.length === 0) { notify({ variant: 'info', title: 'Info', text: 'No hay plantillas activas para ese cargo.' }); return }
    const ts = tareasDeBloque(bloqueId)
    const maxOrden = ts.length ? Math.max(...ts.map(t => t.orden)) : -1
    setSaving(true)
    await createCondominioRow('tareas_bloque',
      pls.map((p, i) => ({
        bloque_id: bloqueId, plantilla_id: p.id,
        titulo: p.titulo, descripcion: p.descripcion ?? null,
        area_id: p.area_id ?? null, requiere_foto: p.requiere_foto,
        orden: maxOrden + 1 + i,
      }))
    )
    setSaving(false); onRefresh()
  }

  async function marcarTarea(tareaId: string, estado: EstadoTareaBloque) {
    if (estado === 'con_observacion') {
      const result = await openPromptDialog({
        title: '¿Qué observación encontraste?',
        fields: [{
          name: 'notas',
          label: 'Observación',
          control: 'textarea',
          rows: 4,
          placeholder: 'Describe la observación o problema...',
          required: true,
          autoFocus: true,
        }],
        submitText: 'Registrar',
      })
      if (!result) return
      await updateCondominioRow('tareas_bloque', tareaId, {
        estado, notas_operativo: result.notas,
        completada_en: new Date().toISOString(),
      })
    } else {
      await updateCondominioRow('tareas_bloque', tareaId, {
        estado,
        completada_en: estado !== 'pendiente' ? new Date().toISOString() : null,
      })
    }
    onRefresh()
  }

  async function deleteTarea(id: string) {
    await deleteCondominioRow('tareas_bloque', id)
    onRefresh()
  }

  const personalActivo = personal.filter(p => p.estado !== 'inactivo').sort((a, b) => a.nombre.localeCompare(b.nombre))

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Turnos y tareas operativas</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {bloques.filter(b => b.estado === 'en_curso').length} turno{bloques.filter(b => b.estado === 'en_curso').length !== 1 ? 's' : ''} en curso hoy
          </p>
        </div>
        {canCreate && (
          <button onClick={() => { setBloqueForm(blankBloque(hoy)); setShowBloqueForm(true) }}
            style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
            + Asignar turno
          </button>
        )}
      </div>

      {/* Form nuevo bloque */}
      {showBloqueForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Asignar bloque de turno</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Empleado *</label>
              <select value={bloqueForm.personal_id} onChange={e => setBloqueForm(f => ({ ...f, personal_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Seleccionar empleado...</option>
                {personalActivo.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.cargo}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha</label>
              <input type="date" value={bloqueForm.fecha} onChange={e => setBloqueForm(f => ({ ...f, fecha: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Turno</label>
              <select value={bloqueForm.turno} onChange={e => setBloqueForm(f => ({ ...f, turno: e.target.value as TurnoTipo }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="manana">🌅 Mañana</option>
                <option value="tarde">☀️ Tarde</option>
                <option value="noche">🌙 Noche</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={bloqueForm.notas} onChange={e => setBloqueForm(f => ({ ...f, notas: e.target.value }))} placeholder="Indicaciones especiales..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={crearBloque} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Creando...' : 'Crear turno'}
            </button>
            <button onClick={() => setShowBloqueForm(false)} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedPersonalId} onChange={e => setSelectedPersonalId(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }}>
          <option value="todos">Todos los empleados</option>
          {personalActivo.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.cargo}</option>)}
        </select>
        <input type="date" value={selectedFecha} onChange={e => setSelectedFecha(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
        {selectedFecha !== hoy && (
          <button onClick={() => setSelectedFecha(hoy)} style={{ padding: '7px 12px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-ink-2)' }}>
            Hoy
          </button>
        )}
      </div>

      {/* Lista de bloques */}
      {bloquesFiltrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>⚙️</div>
          <p style={{ fontWeight: 700, color: 'var(--at-ink-3)' }}>Sin turnos asignados para este filtro</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {bloquesFiltrados.map(bloque => {
            const tc = TURNO_CONFIG[bloque.turno]
            const ec = ESTADO_BLOQUE[bloque.estado]
            const ts = tareasDeBloque(bloque.id)
            const completadas = ts.filter(t => t.estado === 'completada' || t.estado === 'con_observacion').length
            const progreso = ts.length > 0 ? Math.round((completadas / ts.length) * 100) : 0
            const isOpen = bloqueAbierto === bloque.id
            const empleado = personal.find(p => p.id === bloque.personal_id)

            return (
              <div key={bloque.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${isOpen ? 'var(--at-warning)' : 'var(--at-line)'}`, borderRadius: '16px', overflow: 'hidden' }}>
                {/* Header del bloque */}
                <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', background: isOpen ? 'var(--at-warning-tint)' : 'var(--at-surface)' }}
                  onClick={() => setBloqueAbierto(isOpen ? null : bloque.id)}>
                  <span style={{ fontSize: '22px' }}>{tc.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>
                      {empleado?.nombre ?? 'Empleado'} — {empleado?.cargo ?? ''}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2px' }}>
                      <span style={{ background: tc.bg, color: tc.color, padding: '1px 8px', borderRadius: '20px', fontWeight: 600 }}>{tc.label}</span>
                      <span>{new Date(bloque.fecha + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      <span>📋 {ts.length} tarea{ts.length !== 1 ? 's' : ''}</span>
                      {ts.length > 0 && <span>{progreso}% completado</span>}
                      {bloque.puntaje_completitud !== null && bloque.puntaje_completitud !== undefined && bloque.estado !== 'en_curso' && (
                        <span style={{ fontWeight: 700, color: bloque.puntaje_completitud >= 80 ? 'var(--at-success)' : bloque.puntaje_completitud >= 50 ? 'var(--at-warning)' : 'var(--at-danger)' }}>
                          Cierre: {bloque.puntaje_completitud}%
                        </span>
                      )}
                    </div>
                    {/* Barra de progreso */}
                    {ts.length > 0 && (
                      <div style={{ marginTop: '6px', height: '5px', background: 'var(--at-line)', borderRadius: '99px', overflow: 'hidden' }}>
                        <div style={{ width: `${progreso}%`, height: '100%', background: progreso === 100 ? 'var(--at-success)' : 'var(--at-warning)', borderRadius: '99px', transition: 'width .4s' }} />
                      </div>
                    )}
                  </div>
                  <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: ec.bg, color: ec.color, flexShrink: 0 }}>{ec.label}</span>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '5px' }} onClick={e => e.stopPropagation()}>
                      {bloque.estado === 'pendiente' && (
                        <button onClick={() => iniciarBloque(bloque.id)} style={{ padding: '6px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                          ▶ Iniciar
                        </button>
                      )}
                      {bloque.estado === 'en_curso' && (
                        <button onClick={() => cerrarBloque(bloque.id, 'completado')} style={{ padding: '6px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                          ✓ Cerrar turno
                        </button>
                      )}
                      <button onClick={() => deleteBloque(bloque.id)} style={{ padding: '6px 9px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>
                    </div>
                  )}
                  <span style={{ color: 'var(--at-ink-3)', fontSize: '16px', transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </div>

                {/* Detalle de tareas */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--at-warning-border)', padding: '16px 18px', background: 'var(--at-warning-tint)' }}>
                    {/* Botón cargar plantillas */}
                    {canCreate && empleado && bloque.estado !== 'completado' && bloque.estado !== 'incompleto' && (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                        {Array.from(new Set(plantillas.filter(p => p.activo && p.cargo.toLowerCase() === (empleado.cargo ?? '').toLowerCase()).map(p => p.cargo))).map(cargo => (
                          <button key={cargo} onClick={() => agregarDesdePlantillas(bloque.id, cargo)} disabled={saving}
                            style={{ padding: '7px 14px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: '1.5px solid var(--at-warning-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}>
                            📋 Cargar tareas de {cargo}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Lista de tareas */}
                    {ts.length === 0 ? (
                      <p style={{ color: 'var(--at-ink-3)', fontSize: '13px', margin: '0 0 12px' }}>Sin tareas. Agrega tareas manualmente o carga las plantillas del cargo.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                        {ts.map((t, idx) => {
                          const et = ESTADO_TAREA[t.estado]
                          const areaNombre = t.area_nombre ?? (areas.find(a => a.id === t.area_id)?.nombre)
                          const areaIcono  = t.area_icono  ?? (areas.find(a => a.id === t.area_id)?.icono ?? '')
                          return (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: et.bg, borderRadius: '10px', border: `1px solid ${et.border}` }}>
                              <span style={{ fontWeight: 800, fontSize: '12px', color: 'var(--at-warning)', width: '18px', textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>
                              <span style={{ fontSize: '18px', flexShrink: 0 }}>{et.icon}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--at-ink)' }}>{t.titulo}</div>
                                {t.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{t.descripcion}</div>}
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                                  {areaNombre && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{areaIcono} {areaNombre}</span>}
                                  {t.requiere_foto && <span style={{ fontSize: '11.5px', color: 'var(--at-accent-hover)' }}>📷 Requiere foto</span>}
                                  {t.notas_operativo && <span style={{ fontSize: '11.5px', color: 'var(--at-warning)' }}>⚠ {t.notas_operativo}</span>}
                                  {t.completada_en && <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{new Date(t.completada_en).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>}
                                </div>
                              </div>
                              {/* Acciones del operativo */}
                              {canEdit && bloque.estado === 'en_curso' && t.estado === 'pendiente' && (
                                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                  <button onClick={() => marcarTarea(t.id, 'completada')} title="Completada" style={{ padding: '5px 9px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>✅</button>
                                  <button onClick={() => marcarTarea(t.id, 'con_observacion')} title="Con observación" style={{ padding: '5px 9px', background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>⚠️</button>
                                  <button onClick={() => marcarTarea(t.id, 'omitida')} title="Omitir" style={{ padding: '5px 9px', background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-accent-soft-2)', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>⏭</button>
                                </div>
                              )}
                              {canEdit && bloque.estado !== 'completado' && bloque.estado !== 'incompleto' && (
                                <button onClick={() => deleteTarea(t.id)} style={{ padding: '5px 8px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '13px', flexShrink: 0 }}>✕</button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Agregar tarea ad-hoc */}
                    {canCreate && bloque.estado !== 'completado' && bloque.estado !== 'incompleto' && (
                      <>
                        {!addingTarea ? (
                          <button onClick={() => setAddingTarea(true)}
                            style={{ padding: '7px 14px', background: 'var(--at-surface)', color: 'var(--at-warning)', border: '1.5px dashed #fcd34d', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                            + Agregar tarea
                          </button>
                        ) : (
                          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-warning-border)', borderRadius: '10px', padding: '14px', marginTop: '4px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                              <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Desde plantilla</label>
                                <select value={nuevaTarea.plantilla_id} onChange={e => {
                                  const p = plantillas.find(x => x.id === e.target.value)
                                  setNuevaTarea(f => ({ ...f, plantilla_id: e.target.value, titulo: p?.titulo ?? '', descripcion: p?.descripcion ?? '', area_id: p?.area_id ?? '', requiere_foto: p?.requiere_foto ?? false }))
                                }} style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-warning-border)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-warning-tint)' }}>
                                  <option value="">Tarea personalizada</option>
                                  {plantillas.filter(p => p.activo).sort((a, b) => a.cargo.localeCompare(b.cargo) || a.orden - b.orden).map(p => (
                                    <option key={p.id} value={p.id}>{p.cargo} — {p.titulo}</option>
                                  ))}
                                </select>
                              </div>
                              {!nuevaTarea.plantilla_id && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Título *</label>
                                  <input value={nuevaTarea.titulo} onChange={e => setNuevaTarea(f => ({ ...f, titulo: e.target.value }))} placeholder="Título de la tarea..."
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-warning-border)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-warning-tint)' }} />
                                </div>
                              )}
                              <div>
                                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Área</label>
                                <select value={nuevaTarea.area_id} onChange={e => setNuevaTarea(f => ({ ...f, area_id: e.target.value }))}
                                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-warning-border)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-warning-tint)' }}>
                                  <option value="">Sin área</option>
                                  {areas.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                                </select>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--at-ink-2)', cursor: 'pointer', marginTop: '16px' }}>
                                  <input type="checkbox" checked={nuevaTarea.requiere_foto} onChange={e => setNuevaTarea(f => ({ ...f, requiere_foto: e.target.checked }))} />
                                  Requiere foto
                                </label>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => agregarTareaDesde(bloque.id)} disabled={saving} style={{ padding: '8px 18px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '7px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                                {saving ? '...' : 'Agregar'}
                              </button>
                              <button onClick={() => { setAddingTarea(false); setNuevaTarea({ titulo: '', descripcion: '', area_id: '', plantilla_id: '', requiere_foto: false }) }}
                                style={{ padding: '8px 14px', background: 'var(--at-surface)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Resumen del turno si está cerrado */}
                    {(bloque.estado === 'completado' || bloque.estado === 'incompleto') && bloque.puntaje_completitud !== null && bloque.puntaje_completitud !== undefined && (
                      <div style={{ marginTop: '14px', padding: '14px', background: bloque.puntaje_completitud >= 80 ? 'var(--at-success-tint)' : bloque.puntaje_completitud >= 50 ? 'var(--at-warning-tint)' : 'var(--at-danger-tint)', borderRadius: '10px', border: `1px solid ${bloque.puntaje_completitud >= 80 ? 'var(--at-success-border)' : bloque.puntaje_completitud >= 50 ? 'var(--at-warning-border)' : 'var(--at-danger-border)'}` }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: bloque.puntaje_completitud >= 80 ? 'var(--at-success)' : bloque.puntaje_completitud >= 50 ? 'var(--at-warning)' : 'var(--at-danger)' }}>
                          {bloque.puntaje_completitud >= 80 ? '🏆 Excelente desempeño' : bloque.puntaje_completitud >= 50 ? '⚠️ Desempeño aceptable' : '❌ Turno incompleto'}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginTop: '4px' }}>
                          Completitud: {bloque.puntaje_completitud}% · {completadas}/{ts.length} tareas
                          {bloque.cerrado_en && ` · Cerrado a las ${new Date(bloque.cerrado_en).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`}
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
    </div>
  )
}

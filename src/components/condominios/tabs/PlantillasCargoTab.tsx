// Catálogo de ACTIVIDADES operativas (plantillas_tarea_cargo, extendida en
// 20260904000100) — la misma pantalla de plantillas de siempre, ahora con las
// propiedades que el flujo de limpieza necesita: servicio (familia de la
// actividad — no confundir con `cargo`, el puesto que la desempeña), duración
// estimada, checklist de pasos, instrucciones de seguridad, evidencias
// obligatorias, y los recursos planificados (insumos de suministros_condominio
// y herramientas de inventario_condominio, tablas puente de 20260904000200).
//
// Los recursos NO viajan por el loader global de sectionData: solo esta
// pantalla los usa, así que se cargan aquí con fetchRecursosPlantillas
// (tabQueries) y sus estados de carga/error viven en el tab.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EmptyState } from '../../shared/EmptyState'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchRecursosPlantillas } from '../../../domain/condominios/tabQueries'
import type {
  AreaCondominio,
  ItemInventario,
  PlantillaTareaCargo,
  PlantillaTareaHerramienta,
  PlantillaTareaSuministro,
  ServicioOperativo,
  SuministroCondominio,
} from '../../../types'

interface Props {
  plantillas: PlantillaTareaCargo[]
  areas: AreaCondominio[]
  suministros: SuministroCondominio[]
  inventario: ItemInventario[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

export const SERVICIO_LABEL: Record<ServicioOperativo, string> = {
  limpieza: '🧹 Limpieza',
  mantenimiento: '🔧 Mantenimiento',
  seguridad: '🛡️ Seguridad',
  jardineria: '🌿 Jardinería',
  administracion: '🗂️ Administración',
  otro: '📌 Otro',
}
const SERVICIOS = Object.keys(SERVICIO_LABEL) as ServicioOperativo[]

const ICONOS = ['✅','🧹','🔧','🌿','💡','🚿','🪟','🚪','🏊','🗑','🧴','🔑','📦','🛗','⚡','💧','🖨','🪣','🧽','🔐','📋','🏋️','🎭','🌊','🛠']

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  background: 'var(--at-surface-2)',
} as const
const labelStyle = {
  fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)',
  display: 'block', marginBottom: '4px',
} as const

function blankForm() {
  return {
    cargo: '', titulo: '', descripcion: '', icono: '✅', orden: 0, area_id: '',
    requiere_foto: false, requiere_comentario: false, requiere_checklist: false,
    servicio: '' as '' | ServicioOperativo,
    duracion: '', instrucciones_seguridad: '',
    checklist: [] as string[],
  }
}

export function PlantillasCargoTab({ plantillas, areas, suministros, inventario, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [nuevoPaso, setNuevoPaso] = useState('')
  const [filtroCargo, setFiltroCargo] = useState<string>('todos')
  const [filtroServicio, setFiltroServicio] = useState<string>('todos')
  const [filtroEstado, setFiltroEstado] = useState<'todas' | 'activas' | 'inactivas'>('todas')

  // ── Recursos planificados (insumos + herramientas) ─────────────────────────
  const [recSuministros, setRecSuministros] = useState<PlantillaTareaSuministro[]>([])
  const [recHerramientas, setRecHerramientas] = useState<PlantillaTareaHerramienta[]>([])
  const [recCargando, setRecCargando] = useState(true)
  const [recError, setRecError] = useState<string | null>(null)

  const cargarRecursos = useCallback(async () => {
    setRecCargando(true)
    const { suministros: s, herramientas: h, error } = await fetchRecursosPlantillas(proyectoId, companyId)
    setRecSuministros(s)
    setRecHerramientas(h)
    setRecError(error ? error.message : null)
    setRecCargando(false)
  }, [proyectoId, companyId])

  useEffect(() => { void cargarRecursos() }, [cargarRecursos])

  const sumPorPlantilla = useMemo(() => {
    const m = new Map<string, PlantillaTareaSuministro[]>()
    for (const r of recSuministros) m.set(r.plantilla_tarea_id, [...(m.get(r.plantilla_tarea_id) ?? []), r])
    return m
  }, [recSuministros])
  const herPorPlantilla = useMemo(() => {
    const m = new Map<string, PlantillaTareaHerramienta[]>()
    for (const r of recHerramientas) m.set(r.plantilla_tarea_id, [...(m.get(r.plantilla_tarea_id) ?? []), r])
    return m
  }, [recHerramientas])

  // ── Filtros y agrupación ───────────────────────────────────────────────────
  const cargos = Array.from(new Set(plantillas.map(p => p.cargo))).sort()
  const filtradas = [...plantillas]
    .filter(p => filtroCargo === 'todos' || p.cargo === filtroCargo)
    .filter(p => filtroServicio === 'todos'
      || (filtroServicio === 'pendiente' ? !p.servicio : p.servicio === filtroServicio))
    .filter(p => filtroEstado === 'todas' || (filtroEstado === 'activas' ? p.activo : !p.activo))
    .sort((a, b) => a.cargo.localeCompare(b.cargo) || a.orden - b.orden)

  const cargosPorGrupo = Array.from(
    filtradas.reduce((m, p) => { m.set(p.cargo, [...(m.get(p.cargo) ?? []), p]); return m }, new Map<string, PlantillaTareaCargo[]>())
  )

  // ── Form ───────────────────────────────────────────────────────────────────
  function startEdit(p: PlantillaTareaCargo) {
    setEditId(p.id)
    setForm({
      cargo: p.cargo, titulo: p.titulo, descripcion: p.descripcion ?? '', icono: p.icono,
      orden: p.orden, area_id: p.area_id ?? '', requiere_foto: p.requiere_foto,
      requiere_comentario: p.requiere_comentario ?? false,
      requiere_checklist: p.requiere_checklist ?? false,
      servicio: p.servicio ?? '',
      duracion: p.duracion_estimada_min != null ? String(p.duracion_estimada_min) : '',
      instrucciones_seguridad: p.instrucciones_seguridad ?? '',
      checklist: Array.isArray(p.checklist) ? p.checklist.map(String) : [],
    })
    setShowForm(true)
  }

  function resetForm() { setForm(blankForm()); setNuevoPaso(''); setEditId(null); setShowForm(false) }

  async function save() {
    if (!form.cargo.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el cargo.' }); return }
    if (!form.titulo.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el título de la actividad.' }); return }
    // Capturas nuevas con opciones controladas: el servicio es obligatorio (los
    // registros legados quedan NULL hasta que alguien los edite y clasifique).
    if (!form.servicio) { notify({ variant: 'error', title: 'Error', text: 'Selecciona el servicio (familia de la actividad).' }); return }
    const duracion = form.duracion.trim() === '' ? null : Number(form.duracion)
    if (duracion !== null && (!Number.isInteger(duracion) || duracion <= 0)) {
      notify({ variant: 'error', title: 'Error', text: 'La duración estimada debe ser un número entero de minutos mayor que cero.' })
      return
    }
    if (form.requiere_checklist && form.checklist.length === 0) {
      notify({ variant: 'error', title: 'Error', text: 'El checklist está marcado como obligatorio pero no tiene pasos.' })
      return
    }
    setSaving(true)
    const payload = {
      cargo: form.cargo.trim(),
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      icono: form.icono,
      orden: form.orden,
      area_id: form.area_id || null,
      requiere_foto: form.requiere_foto,
      servicio: form.servicio,
      duracion_estimada_min: duracion,
      checklist: form.checklist,
      instrucciones_seguridad: form.instrucciones_seguridad.trim() || null,
      requiere_comentario: form.requiere_comentario,
      requiere_checklist: form.requiere_checklist,
    }
    if (editId) {
      const { error } = await updateCondominioRow('plantillas_tarea_cargo', editId, payload)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    } else {
      const { error } = await createCondominioRow('plantillas_tarea_cargo', { ...payload, company_id: companyId, project_id: proyectoId })
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    }
    setSaving(false); resetForm(); onRefresh()
  }

  async function deletePlantilla(id: string) {
    const r = await confirm({ title: '¿Eliminar plantilla?', text: 'También se quitan sus insumos y herramientas planificados. Las tareas ya generadas no se tocan.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('plantillas_tarea_cargo', id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh(); void cargarRecursos()
  }

  async function toggleActivo(p: PlantillaTareaCargo) {
    await updateCondominioRow('plantillas_tarea_cargo', p.id, { activo: !p.activo })
    onRefresh()
  }

  // ── Checklist (editor de pasos) ────────────────────────────────────────────
  function agregarPaso() {
    const paso = nuevoPaso.trim()
    if (!paso) return
    setForm(f => ({ ...f, checklist: [...f.checklist, paso] }))
    setNuevoPaso('')
  }
  function quitarPaso(idx: number) {
    setForm(f => ({ ...f, checklist: f.checklist.filter((_, i) => i !== idx) }))
  }

  // ── Recursos de la plantilla en edición ────────────────────────────────────
  const [sumSel, setSumSel] = useState('')
  const [sumCant, setSumCant] = useState('1')
  const [herSel, setHerSel] = useState('')
  const [herCant, setHerCant] = useState('1')
  const [herObligatoria, setHerObligatoria] = useState(false)

  const misSuministros = editId ? (sumPorPlantilla.get(editId) ?? []) : []
  const misHerramientas = editId ? (herPorPlantilla.get(editId) ?? []) : []

  // El select de agregar solo ofrece recursos vigentes y aún no vinculados; los
  // vínculos con recursos ya dados de baja siguen visibles abajo, marcados.
  const suministrosDisponibles = suministros
    .filter(s => s.activo && !misSuministros.some(r => r.suministro_id === s.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  const inventarioDisponible = inventario
    .filter(i => i.estado !== 'dado_de_baja' && !misHerramientas.some(r => r.inventario_id === i.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  async function agregarInsumo() {
    if (!editId || !sumSel) return
    const cantidad = Number(sumCant)
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      notify({ variant: 'error', title: 'Error', text: 'La cantidad planificada debe ser mayor que cero.' })
      return
    }
    const { error } = await createCondominioRow('plantilla_tarea_suministros', {
      company_id: companyId, project_id: proyectoId,
      plantilla_tarea_id: editId, suministro_id: sumSel, cantidad,
    })
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.code === '23505' ? 'Ese insumo ya está en la actividad: edita su cantidad en lugar de repetirlo.' : error.message })
      return
    }
    setSumSel(''); setSumCant('1'); void cargarRecursos()
  }

  async function agregarHerramienta() {
    if (!editId || !herSel) return
    const cantidad = Number(herCant)
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      notify({ variant: 'error', title: 'Error', text: 'La cantidad debe ser un entero mayor que cero.' })
      return
    }
    const { error } = await createCondominioRow('plantilla_tarea_herramientas', {
      company_id: companyId, project_id: proyectoId,
      plantilla_tarea_id: editId, inventario_id: herSel, cantidad, obligatoria: herObligatoria,
    })
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.code === '23505' ? 'Esa herramienta ya está en la actividad: edita su cantidad en lugar de repetirla.' : error.message })
      return
    }
    setHerSel(''); setHerCant('1'); setHerObligatoria(false); void cargarRecursos()
  }

  async function editarCantidad(tabla: 'plantilla_tarea_suministros' | 'plantilla_tarea_herramientas', recurso: { id: string; cantidad: number }, entero: boolean) {
    const res = await openPromptDialog({
      title: 'Cantidad planificada',
      fields: [{ name: 'cantidad', label: entero ? 'Cantidad (entera)' : 'Cantidad', type: 'number', initialValue: String(recurso.cantidad) }],
      validate: d => {
        const n = Number(d.cantidad)
        if (!Number.isFinite(n) || n <= 0) return 'La cantidad debe ser mayor que cero.'
        if (entero && !Number.isInteger(n)) return 'La cantidad debe ser un número entero.'
        return null
      },
    })
    if (!res) return
    const { error } = await updateCondominioRow(tabla, recurso.id, { cantidad: Number(res.cantidad) })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargarRecursos()
  }

  async function quitarRecurso(tabla: 'plantilla_tarea_suministros' | 'plantilla_tarea_herramientas', id: string) {
    const { error } = await deleteCondominioRow(tabla, id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargarRecursos()
  }

  async function toggleObligatoria(r: PlantillaTareaHerramienta) {
    const { error } = await updateCondominioRow('plantilla_tarea_herramientas', r.id, { obligatoria: !r.obligatoria })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargarRecursos()
  }

  const recursoInactivo = (p: PlantillaTareaCargo) =>
    (sumPorPlantilla.get(p.id) ?? []).some(r => r.suministro_activo === false)
    || (herPorPlantilla.get(p.id) ?? []).some(r => r.inventario_estado === 'dado_de_baja')

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Catálogo de actividades</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {plantillas.filter(p => p.activo).length} activas · {cargos.length} cargo{cargos.length !== 1 ? 's' : ''}
            {plantillas.some(p => !p.servicio) && ` · ${plantillas.filter(p => !p.servicio).length} sin clasificar`}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => { resetForm(); setShowForm(true) }}
            style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
            + Nueva actividad
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editId ? 'Editar actividad' : 'Nueva actividad'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Servicio *</label>
              <select value={form.servicio} onChange={e => setForm(f => ({ ...f, servicio: e.target.value as '' | ServicioOperativo }))} style={inputStyle} aria-label="Servicio de la actividad">
                <option value="">— Selecciona la familia —</option>
                {SERVICIOS.map(s => <option key={s} value={s}>{SERVICIO_LABEL[s]}</option>)}
              </select>
              {editId && !form.servicio && (
                <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', marginTop: '4px' }}>
                  ⚠ Registro anterior sin clasificar: elegí el servicio para normalizarlo.
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Cargo que la desempeña *</label>
              <input value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))} placeholder="Ej. Limpieza, Mantenimiento, Jardinería..."
                list="cargos-list" style={inputStyle} />
              <datalist id="cargos-list">
                {cargos.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Título de la actividad *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Limpiar lobby, Revisar bomba..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Duración estimada (min)</label>
              <input type="number" min={1} value={form.duracion} onChange={e => setForm(f => ({ ...f, duracion: e.target.value }))} placeholder="Ej. 45" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Ícono</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1.5px solid var(--at-line)' }}>
                {ICONOS.map(ic => (
                  <button key={ic} onClick={() => setForm(f => ({ ...f, icono: ic }))}
                    style={{ width: '34px', height: '34px', fontSize: '18px', borderRadius: '7px', border: '2px solid', borderColor: form.icono === ic ? 'var(--at-warning)' : 'transparent', background: form.icono === ic ? 'var(--at-warning-tint)' : 'transparent', cursor: 'pointer' }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={labelStyle}>Área (opcional)</label>
                <select value={form.area_id} onChange={e => setForm(f => ({ ...f, area_id: e.target.value }))} style={inputStyle}>
                  <option value="">Sin área específica</option>
                  {areas.filter(a => a.activo).sort((a, b) => a.orden - b.orden).map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Orden</label>
                <input type="number" value={form.orden} onChange={e => setForm(f => ({ ...f, orden: parseInt(e.target.value) || 0 }))} min={0} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Evidencias obligatorias al ejecutar</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.requiere_foto} onChange={e => setForm(f => ({ ...f, requiere_foto: e.target.checked }))} />
                    📷 Fotografía obligatoria
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.requiere_comentario} onChange={e => setForm(f => ({ ...f, requiere_comentario: e.target.checked }))} />
                    💬 Comentario obligatorio
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.requiere_checklist} onChange={e => setForm(f => ({ ...f, requiere_checklist: e.target.checked }))} />
                    ☑️ Checklist obligatorio
                  </label>
                </div>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción / instrucciones</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle de cómo realizar la actividad..." rows={2}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Instrucciones de seguridad</label>
              <textarea value={form.instrucciones_seguridad} onChange={e => setForm(f => ({ ...f, instrucciones_seguridad: e.target.value }))} placeholder="EPP requerido, bloqueo de área, manejo de químicos..." rows={2}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            {/* Checklist de pasos */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Checklist ({form.checklist.length} paso{form.checklist.length !== 1 ? 's' : ''})</label>
              {form.checklist.length > 0 && (
                <ol style={{ margin: '0 0 8px', paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {form.checklist.map((paso, i) => (
                    <li key={`${i}-${paso}`} style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>
                      {paso}
                      <button onClick={() => quitarPaso(i)} aria-label={`Quitar paso ${paso}`}
                        style={{ marginLeft: '8px', padding: '1px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', color: 'var(--at-danger)' }}>✕</button>
                    </li>
                  ))}
                </ol>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input value={nuevoPaso} onChange={e => setNuevoPaso(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarPaso() } }}
                  placeholder="Ej. Barrer y trapear el piso" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={agregarPaso} style={{ padding: '9px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>+ Paso</button>
              </div>
            </div>

            {/* Recursos planificados (solo al editar: el vínculo necesita el id) */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--at-line)', paddingTop: '14px' }}>
              <label style={labelStyle}>Recursos planificados</label>
              {!editId ? (
                <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                  Guarda la actividad primero; después podrás agregarle insumos y herramientas.
                </p>
              ) : recCargando ? (
                <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--at-ink-3)' }}>Cargando recursos…</p>
              ) : recError ? (
                <div style={{ fontSize: '12.5px', color: 'var(--at-danger)' }}>
                  No se pudieron cargar los recursos: {recError}{' '}
                  <button onClick={() => void cargarRecursos()} style={{ padding: '2px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Reintentar</button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  {/* Insumos */}
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '6px' }}>🧴 Insumos</div>
                    {misSuministros.length === 0 && <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--at-ink-3)' }}>Sin insumos planificados.</p>}
                    {misSuministros.map(r => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', marginBottom: '4px' }}>
                        <span style={{ flex: 1 }}>
                          {r.suministro_nombre ?? 'Insumo'} — {r.cantidad} {r.unidad_medida ?? ''}
                          {r.suministro_activo === false && <span style={{ color: 'var(--at-warning-strong)', fontWeight: 700 }}> · ⚠ inactivo</span>}
                        </span>
                        {canEdit && <button onClick={() => void editarCantidad('plantilla_tarea_suministros', r, false)} aria-label={`Editar cantidad de ${r.suministro_nombre}`} style={{ padding: '2px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>✏️</button>}
                        {canEdit && <button onClick={() => void quitarRecurso('plantilla_tarea_suministros', r.id)} aria-label={`Quitar ${r.suministro_nombre}`} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', color: 'var(--at-danger)' }}>✕</button>}
                      </div>
                    ))}
                    {canEdit && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                        <select value={sumSel} onChange={e => setSumSel(e.target.value)} style={{ ...inputStyle, flex: 1, padding: '6px 8px', fontSize: '12.5px' }} aria-label="Insumo a agregar">
                          <option value="">— Insumo —</option>
                          {suministrosDisponibles.map(s => <option key={s.id} value={s.id}>{s.nombre} ({s.unidad_medida})</option>)}
                        </select>
                        <input type="number" min={0.01} step="any" value={sumCant} onChange={e => setSumCant(e.target.value)} style={{ ...inputStyle, width: '74px', padding: '6px 8px', fontSize: '12.5px' }} aria-label="Cantidad planificada" />
                        <button onClick={() => void agregarInsumo()} disabled={!sumSel} style={{ padding: '6px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Agregar</button>
                      </div>
                    )}
                  </div>
                  {/* Herramientas */}
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '6px' }}>🔧 Herramientas y equipo</div>
                    {misHerramientas.length === 0 && <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--at-ink-3)' }}>Sin herramientas planificadas.</p>}
                    {misHerramientas.map(r => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', marginBottom: '4px' }}>
                        <span style={{ flex: 1 }}>
                          {r.inventario_nombre ?? 'Herramienta'} — {r.cantidad}
                          {r.inventario_estado === 'dado_de_baja' && <span style={{ color: 'var(--at-warning-strong)', fontWeight: 700 }}> · ⚠ dada de baja</span>}
                        </span>
                        {canEdit && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', cursor: 'pointer' }} title="La ejecución no debería iniciarse sin esta herramienta">
                            <input type="checkbox" checked={r.obligatoria} onChange={() => void toggleObligatoria(r)} />
                            Obligatoria
                          </label>
                        )}
                        {!canEdit && r.obligatoria && <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Obligatoria</span>}
                        {canEdit && <button onClick={() => void editarCantidad('plantilla_tarea_herramientas', r, true)} aria-label={`Editar cantidad de ${r.inventario_nombre}`} style={{ padding: '2px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>✏️</button>}
                        {canEdit && <button onClick={() => void quitarRecurso('plantilla_tarea_herramientas', r.id)} aria-label={`Quitar ${r.inventario_nombre}`} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', color: 'var(--at-danger)' }}>✕</button>}
                      </div>
                    ))}
                    {canEdit && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={herSel} onChange={e => setHerSel(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: '140px', padding: '6px 8px', fontSize: '12.5px' }} aria-label="Herramienta a agregar">
                          <option value="">— Herramienta —</option>
                          {inventarioDisponible.map(i => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                        </select>
                        <input type="number" min={1} step={1} value={herCant} onChange={e => setHerCant(e.target.value)} style={{ ...inputStyle, width: '64px', padding: '6px 8px', fontSize: '12.5px' }} aria-label="Cantidad de herramientas" />
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={herObligatoria} onChange={e => setHerObligatoria(e.target.checked)} />
                          Obligatoria
                        </label>
                        <button onClick={() => void agregarHerramienta()} disabled={!herSel} style={{ padding: '6px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Agregar</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={save} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Filtros: servicio + estado + cargo */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
        <select value={filtroServicio} onChange={e => setFiltroServicio(e.target.value)} style={{ ...inputStyle, width: '210px' }} aria-label="Filtrar por servicio">
          <option value="todos">Todos los servicios</option>
          {SERVICIOS.map(s => <option key={s} value={s}>{SERVICIO_LABEL[s]}</option>)}
          <option value="pendiente">⚠ Sin clasificar</option>
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as 'todas' | 'activas' | 'inactivas')} style={{ ...inputStyle, width: '130px' }} aria-label="Filtrar por estado">
          <option value="todas">Todas</option>
          <option value="activas">Activas</option>
          <option value="inactivas">Inactivas</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {(['todos', ...cargos] as string[]).map(c => (
          <button key={c} onClick={() => setFiltroCargo(c)}
            style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: 'none',
              background: filtroCargo === c ? 'var(--at-warning-tint)' : 'var(--at-chip)', color: filtroCargo === c ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>
            {c === 'todos' ? `Todos (${plantillas.length})` : `${c} (${plantillas.filter(p => p.cargo === c).length})`}
          </button>
        ))}
      </div>

      {recError && !showForm && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: 'var(--at-danger)' }}>
          No se pudieron cargar los recursos planificados: {recError}{' '}
          <button onClick={() => void cargarRecursos()} style={{ padding: '2px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Reintentar</button>
        </div>
      )}

      {plantillas.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Sin actividades"
          description="Crea actividades predefinidas por servicio y cargo, con su duración, checklist y recursos, para asignarlas rápidamente."
        />
      ) : filtradas.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="Nada con esos filtros"
          description="Ninguna actividad coincide con el servicio, cargo o estado seleccionados."
          compact
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {cargosPorGrupo.map(([cargo, tareas]) => (
            <div key={cargo}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--at-warning-strong)', background: 'var(--at-warning-tint)', padding: '4px 12px', borderRadius: '20px' }}>
                  {cargo}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{tareas.length} actividad{tareas.length !== 1 ? 'es' : ''}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                {tareas.map(p => {
                  const areaNombre = areas.find(a => a.id === p.area_id)?.nombre
                  const nSum = (sumPorPlantilla.get(p.id) ?? []).length
                  const nHer = (herPorPlantilla.get(p.id) ?? []).length
                  return (
                    <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${p.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '12px', padding: '14px', opacity: p.activo ? 1 : 0.55 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <span style={{ fontSize: '24px', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--at-warning-tint)', borderRadius: '9px', flexShrink: 0 }}>{p.icono}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)' }}>{p.titulo}</div>
                          {p.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{p.descripcion}</div>}
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '5px' }}>
                            {p.servicio
                              ? <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-accent-hover)' }}>{SERVICIO_LABEL[p.servicio]}</span>
                              : <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-warning-strong)' }} title="Registro anterior: edítalo y elegí su servicio.">⚠ Sin clasificar</span>}
                            {p.duracion_estimada_min != null && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>⏱ {p.duracion_estimada_min} min</span>}
                            {areaNombre && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>📍 {areaNombre}</span>}
                            {nSum > 0 && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>🧴 {nSum} insumo{nSum !== 1 ? 's' : ''}</span>}
                            {nHer > 0 && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>🔧 {nHer} herramienta{nHer !== 1 ? 's' : ''}</span>}
                            {recursoInactivo(p) && <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-warning-strong)' }} title="Tiene insumos inactivos o herramientas dadas de baja: revisa sus recursos.">⚠ Recursos por revisar</span>}
                            {p.requiere_foto && <span style={{ fontSize: '11.5px', color: 'var(--at-accent-hover)' }}>📷 Foto</span>}
                            {p.requiere_comentario && <span style={{ fontSize: '11.5px', color: 'var(--at-accent-hover)' }}>💬 Comentario</span>}
                            {p.requiere_checklist && <span style={{ fontSize: '11.5px', color: 'var(--at-accent-hover)' }}>☑️ Checklist{(p.checklist?.length ?? 0) > 0 ? ` (${p.checklist!.length})` : ''}</span>}
                            <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>#{p.orden}</span>
                          </div>
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                          <button onClick={() => startEdit(p)} style={{ flex: 1, padding: '5px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️ Editar</button>
                          <button onClick={() => toggleActivo(p)} style={{ padding: '5px 10px', background: p.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: `1px solid ${p.activo ? 'var(--at-warning-border)' : 'var(--at-success-border)'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: p.activo ? 'var(--at-warning-strong)' : 'var(--at-success)' }}>
                            {p.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button onClick={() => deletePlantilla(p.id)} aria-label={`Eliminar ${p.titulo}`} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>
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

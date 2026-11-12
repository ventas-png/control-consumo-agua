// Catálogo compartido de ACTIVIDADES operativas (plantillas_tarea_cargo,
// serie 20260904*) — UNA sola implementación con dos consumidores:
//   · Seguridad → Plantillas (PlantillasCargoTab): edición completa.
//   · Limpieza → Actividades: el mismo catálogo en consulta, filtrado
//     inicialmente por servicio = limpieza (soloLectura: la administración
//     vive en Plantillas; el SELECT de BD acepta prog_limpieza desde
//     20260904000200, así que un operador de Limpieza lo lee sin permisos del
//     módulo Seguridad).
//
// RECURSOS: los insumos salen de Suministros y las herramientas y el equipo
// salen de EQUIPOS (Operaciones → Equipos, equipos_comunes; antes, de Inventario:
// 20261122000000). Las filas vinculadas antes de ese cambio siguen apuntando a
// Inventario y se muestran igual.
//
// GUARDADO: el formulario de la actividad es un BORRADOR (nada persiste hasta
// "Guardar") y abre en ventana emergente (EditModal) sobre el catálogo, tanto
// para crear como para editar; cerrarla descarta el borrador. Los recursos
// (insumos/herramientas) viven FUERA del formulario, en el panel expandible de
// cada tarjeta, y cada cambio ahí se guarda al instante — el panel lo dice. Así
// cancelar el formulario nunca deja cambios ocultos ya persistidos.
//
// BUSCADOR: con muchas actividades el scroll no alcanza; el cuadro «Buscar
// actividad» acota las tarjetas por título o descripción sin distinguir
// mayúsculas ni acentos, y se combina con los filtros de servicio, estado y
// cargo (también acota «Seleccionar todas»).
//
// EN BLOQUE (20261031000200): «⬆️ Carga masiva» crea actividades desde un archivo
// (con sus recursos por nombre) y las casillas de las tarjetas + «Recursos en
// bloque» agregan o quitan insumos, herramientas y equipo a varias actividades
// en una sola llamada atómica al servidor. Ambas solo con permiso de crear /
// editar, nunca en consulta ni en modo selector.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notify, confirm } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { EmptyState } from '../shared/EmptyState'
import { EditModal } from '../shared/EditModal'
import { SelectionToolbar } from '../shared/SelectionToolbar'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import { ImportarActividadesModal } from './tabs/ImportarActividadesModal'
import { RecursosEnBloqueModal } from './RecursosEnBloqueModal'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../domain/condominios/tabMutations'
import { fetchRecursosPlantillas } from '../../domain/condominios/tabQueries'
import { herramientaDeBaja, herramientaId, herramientaNombre } from '../../domain/condominios/plantillasRecursos'
import { etiquetaCargo, opcionesSelect } from '../../domain/condominios/rrhhCatalogos'
import type {
  AreaCondominio,
  CargoCatalogo,
  EquipoComun,
  PlantillaTareaCargo,
  PlantillaTareaHerramienta,
  PlantillaTareaSuministro,
  ServicioOperativo,
  SuministroCondominio,
} from '../../types'

interface Props {
  plantillas: PlantillaTareaCargo[]
  /** Cargos del condominio (Recursos Humanos → Configuración); sin catálogo, los seis de siempre. */
  cargos?: CargoCatalogo[]
  areas: AreaCondominio[]
  suministros: SuministroCondominio[]
  /** Equipos del condominio (Operaciones → Equipos): de aquí salen las herramientas y el equipo. */
  equipos: EquipoComun[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
  /** Filtro de servicio con el que abre (el usuario puede cambiarlo). */
  servicioInicial?: ServicioOperativo
  /** Consulta sin edición (Limpieza): oculta toda acción de escritura. */
  soloLectura?: boolean
  /**
   * Modo SELECTOR (armado de rutinas): cambia las acciones de la tarjeta por un
   * botón de elegir y apaga toda escritura. Existe para que quien arma una
   * rutina herede los filtros por cargo/servicio/estado de este catálogo en vez
   * de que el armador se fabrique un listado propio que iría divergiendo.
   */
  seleccion?: {
    /** Ids ya elegidos: sus tarjetas quedan marcadas y sin botón. */
    yaElegidas: Set<string>
    onElegir: (plantilla: PlantillaTareaCargo) => void
  }
  titulo?: string
  subtitulo?: string
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

const idDePlantilla = (p: PlantillaTareaCargo) => p.id

/** Para el buscador: minúsculas y sin tildes, así «baño» encuentra «BANO» y viceversa. */
const sinAcentos = (t: string | null | undefined) =>
  (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function blankForm() {
  return {
    cargo: '', titulo: '', descripcion: '', icono: '✅', orden: 0, area_id: '',
    requiere_foto: false, requiere_comentario: false, requiere_checklist: false,
    servicio: '' as '' | ServicioOperativo,
    duracion: '', instrucciones_seguridad: '',
    checklist: [] as string[],
  }
}

export function ActividadesCatalog({
  plantillas, cargos = [], areas, suministros, equipos, proyectoId, companyId,
  canCreate, canEdit, canDelete, onRefresh,
  servicioInicial, soloLectura = false, seleccion, titulo, subtitulo,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [nuevoPaso, setNuevoPaso] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtroCargo, setFiltroCargo] = useState<string>('todos')
  const [filtroServicio, setFiltroServicio] = useState<string>(servicioInicial ?? 'todos')
  const [filtroEstado, setFiltroEstado] = useState<'todas' | 'activas' | 'inactivas'>('todas')
  // Panel de recursos abierto (uno a la vez); vive FUERA del formulario.
  const [recursosDe, setRecursosDe] = useState<string | null>(null)
  const [showImportar, setShowImportar] = useState(false)
  const [showBloque, setShowBloque] = useState(false)

  // En modo selector no se administra el catálogo: se elige de él.
  const enSeleccion = seleccion != null
  const puedeCrear = canCreate && !soloLectura && !enSeleccion
  const puedeEditar = canEdit && !soloLectura && !enSeleccion
  const puedeBorrar = canDelete && !soloLectura && !enSeleccion

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
  const cargosUsados = Array.from(new Set(plantillas.map(p => p.cargo))).sort()
  const termino = sinAcentos(busqueda)
  const filtradas = useMemo(() => [...plantillas]
    .filter(p => !termino || sinAcentos(p.titulo).includes(termino) || sinAcentos(p.descripcion).includes(termino))
    .filter(p => filtroCargo === 'todos' || p.cargo === filtroCargo)
    .filter(p => filtroServicio === 'todos'
      || (filtroServicio === 'pendiente' ? !p.servicio : p.servicio === filtroServicio))
    .filter(p => filtroEstado === 'todas' || (filtroEstado === 'activas' ? p.activo : !p.activo))
    .sort((a, b) => a.cargo.localeCompare(b.cargo) || a.orden - b.orden),
  [plantillas, termino, filtroCargo, filtroServicio, filtroEstado])

  // Selección para «Recursos en bloque»: sobre las tarjetas VISIBLES (los filtros
  // acotan «Seleccionar todas»). Solo con permiso de editar.
  const bloque = useBulkSelection(filtradas, idDePlantilla)
  const puedeBloque = puedeEditar
  const seleccionadas = bloque.selectedItems

  const cargosPorGrupo = Array.from(
    filtradas.reduce((m, p) => { m.set(p.cargo, [...(m.get(p.cargo) ?? []), p]); return m }, new Map<string, PlantillaTareaCargo[]>())
  )

  // Cargo con valores controlados: los ACTIVOS del catálogo del condominio
  // (rrhh_cargos). Al editar una actividad con un cargo apagado o legado, su
  // valor actual se ofrece marcado — conservarlo es válido (el trigger de BD
  // sólo valida cuando el valor CAMBIA); cambiar es elegir uno activo.
  const etiquetaDe = (c: string) => etiquetaCargo(c, cargos)
  const opcionesCargo = opcionesSelect(cargos, form.cargo)
  const cargoEsHistorico = form.cargo !== '' && !opcionesCargo.some(o => o.value === form.cargo && !o.inactivo && !o.historico)

  // ── Form (borrador: nada persiste hasta Guardar) ───────────────────────────
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
  /** Cerrar la ventana (Cancelar, ×, Escape, clic fuera) descarta el borrador; mientras guarda no se cierra. */
  function cerrarForm() { if (saving) return; resetForm() }

  async function save() {
    if (!form.cargo.trim()) { notify({ variant: 'error', title: 'Error', text: 'Selecciona el cargo que desempeña la actividad.' }); return }
    if (!form.titulo.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el título de la actividad.' }); return }
    // Capturas nuevas con opciones controladas: el servicio es obligatorio (los
    // registros legados quedan NULL hasta que alguien los edite y clasifique).
    if (!form.servicio) { notify({ variant: 'error', title: 'Error', text: 'Selecciona el servicio (familia de la actividad).' }); return }
    const duracion = form.duracion.trim() === '' ? null : Number(form.duracion)
    if (duracion !== null && (!Number.isInteger(duracion) || duracion <= 0)) {
      notify({ variant: 'error', title: 'Error', text: 'La duración estimada debe ser un número entero de minutos mayor que cero.' })
      return
    }
    // Las actividades NUEVAS de limpieza llevan tiempo estimado obligatorio:
    // son la base de las rutinas y los bloques de turno de los PRs siguientes.
    if (!editId && form.servicio === 'limpieza' && duracion === null) {
      notify({ variant: 'error', title: 'Error', text: 'Las actividades nuevas de limpieza requieren duración estimada en minutos.' })
      return
    }
    if (form.requiere_checklist && !form.checklist.some(p => p.trim() !== '')) {
      notify({ variant: 'error', title: 'Error', text: 'El checklist está marcado como obligatorio pero no tiene pasos con texto.' })
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
    if (recursosDe === id) setRecursosDe(null)
    onRefresh(); void cargarRecursos()
  }

  async function toggleActivo(p: PlantillaTareaCargo) {
    await updateCondominioRow('plantillas_tarea_cargo', p.id, { activo: !p.activo })
    onRefresh()
  }

  // ── Checklist (editor de pasos, parte del borrador) ────────────────────────
  function agregarPaso() {
    const paso = nuevoPaso.trim()
    if (!paso) return
    setForm(f => ({ ...f, checklist: [...f.checklist, paso] }))
    setNuevoPaso('')
  }
  function quitarPaso(idx: number) {
    setForm(f => ({ ...f, checklist: f.checklist.filter((_, i) => i !== idx) }))
  }

  // ── Recursos: panel por tarjeta, FUERA del formulario, guardado inmediato ──
  const [sumSel, setSumSel] = useState('')
  const [sumCant, setSumCant] = useState('1')
  const [herSel, setHerSel] = useState('')
  const [herCant, setHerCant] = useState('1')
  const [herObligatoria, setHerObligatoria] = useState(false)

  function abrirRecursos(id: string) {
    setRecursosDe(actual => (actual === id ? null : id))
    setSumSel(''); setSumCant('1'); setHerSel(''); setHerCant('1'); setHerObligatoria(false)
  }

  async function agregarInsumo(plantillaId: string) {
    if (!sumSel) return
    const cantidad = Number(sumCant)
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      notify({ variant: 'error', title: 'Error', text: 'La cantidad planificada debe ser mayor que cero.' })
      return
    }
    const { error } = await createCondominioRow('plantilla_tarea_suministros', {
      company_id: companyId, project_id: proyectoId,
      plantilla_tarea_id: plantillaId, suministro_id: sumSel, cantidad,
    })
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.code === '23505' ? 'Ese insumo ya está en la actividad: edita su cantidad en lugar de repetirlo.' : error.message })
      return
    }
    setSumSel(''); setSumCant('1'); void cargarRecursos()
  }

  async function agregarHerramienta(plantillaId: string) {
    if (!herSel) return
    const cantidad = Number(herCant)
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      notify({ variant: 'error', title: 'Error', text: 'La cantidad debe ser un entero mayor que cero.' })
      return
    }
    const { error } = await createCondominioRow('plantilla_tarea_herramientas', {
      company_id: companyId, project_id: proyectoId,
      plantilla_tarea_id: plantillaId, equipo_id: herSel, cantidad, obligatoria: herObligatoria,
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
    || (herPorPlantilla.get(p.id) ?? []).some(herramientaDeBaja)

  function panelRecursos(p: PlantillaTareaCargo) {
    const misSuministros = sumPorPlantilla.get(p.id) ?? []
    const misHerramientas = herPorPlantilla.get(p.id) ?? []
    const suministrosDisponibles = suministros
      .filter(s => s.activo && !misSuministros.some(r => r.suministro_id === s.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
    const equiposDisponibles = equipos
      .filter(e => e.estado !== 'baja' && !misHerramientas.some(r => herramientaId(r) === e.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
    return (
      <div style={{ marginTop: '10px', borderTop: '1px dashed var(--at-line)', paddingTop: '10px' }}>
        {puedeEditar && (
          <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', fontWeight: 600, marginBottom: '8px' }}>
            ⚡ Los cambios en recursos se guardan al instante (no dependen del botón Guardar de la actividad).
          </div>
        )}
        {recCargando ? (
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--at-ink-3)' }}>Cargando recursos…</p>
        ) : recError ? (
          <div style={{ fontSize: '12.5px', color: 'var(--at-danger)' }}>
            No se pudieron cargar los recursos: {recError}{' '}
            <button onClick={() => void cargarRecursos()} style={{ padding: '2px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Reintentar</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '4px' }}>🧴 Insumos</div>
              {misSuministros.length === 0 && <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--at-ink-3)' }}>Sin insumos planificados.</p>}
              {misSuministros.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', marginBottom: '4px' }}>
                  <span style={{ flex: 1 }}>
                    {r.suministro_nombre ?? 'Insumo'} — {r.cantidad} {r.unidad_medida ?? ''}
                    {r.suministro_activo === false && <span style={{ color: 'var(--at-warning-strong)', fontWeight: 700 }}> · ⚠ inactivo</span>}
                  </span>
                  {puedeEditar && <button onClick={() => void editarCantidad('plantilla_tarea_suministros', r, false)} aria-label={`Editar cantidad de ${r.suministro_nombre}`} style={{ padding: '2px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>✏️</button>}
                  {puedeEditar && <button onClick={() => void quitarRecurso('plantilla_tarea_suministros', r.id)} aria-label={`Quitar ${r.suministro_nombre}`} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', color: 'var(--at-danger)' }}>✕</button>}
                </div>
              ))}
              {puedeEditar && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                  <select value={sumSel} onChange={e => setSumSel(e.target.value)} style={{ ...inputStyle, flex: 1, padding: '6px 8px', fontSize: '12.5px' }} aria-label="Insumo a agregar">
                    <option value="">— Insumo —</option>
                    {suministrosDisponibles.map(s => <option key={s.id} value={s.id}>{s.nombre} ({s.unidad_medida})</option>)}
                  </select>
                  <input type="number" min={0.01} step="any" value={sumCant} onChange={e => setSumCant(e.target.value)} style={{ ...inputStyle, width: '74px', padding: '6px 8px', fontSize: '12.5px' }} aria-label="Cantidad planificada" />
                  <button onClick={() => void agregarInsumo(p.id)} disabled={!sumSel} style={{ padding: '6px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Agregar</button>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '4px' }}>🔧 Herramientas y equipo</div>
              {misHerramientas.length === 0 && <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--at-ink-3)' }}>Sin herramientas planificadas.</p>}
              {misHerramientas.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', marginBottom: '4px' }}>
                  <span style={{ flex: 1 }}>
                    {herramientaNombre(r) ?? 'Herramienta'} — {r.cantidad}
                    {herramientaDeBaja(r) && <span style={{ color: 'var(--at-warning-strong)', fontWeight: 700 }}> · ⚠ de baja</span>}
                  </span>
                  {puedeEditar ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', cursor: 'pointer' }} title="La ejecución no debería iniciarse sin esta herramienta">
                      <input type="checkbox" checked={r.obligatoria} onChange={() => void toggleObligatoria(r)} />
                      Obligatoria
                    </label>
                  ) : r.obligatoria && <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Obligatoria</span>}
                  {puedeEditar && <button onClick={() => void editarCantidad('plantilla_tarea_herramientas', r, true)} aria-label={`Editar cantidad de ${herramientaNombre(r)}`} style={{ padding: '2px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>✏️</button>}
                  {puedeEditar && <button onClick={() => void quitarRecurso('plantilla_tarea_herramientas', r.id)} aria-label={`Quitar ${herramientaNombre(r)}`} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', color: 'var(--at-danger)' }}>✕</button>}
                </div>
              ))}
              {puedeEditar && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={herSel} onChange={e => setHerSel(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: '140px', padding: '6px 8px', fontSize: '12.5px' }} aria-label="Herramienta a agregar">
                    <option value="">— Equipo o herramienta —</option>
                    {equiposDisponibles.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                  <input type="number" min={1} step={1} value={herCant} onChange={e => setHerCant(e.target.value)} style={{ ...inputStyle, width: '64px', padding: '6px 8px', fontSize: '12.5px' }} aria-label="Cantidad de herramientas" />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={herObligatoria} onChange={e => setHerObligatoria(e.target.checked)} />
                    Obligatoria
                  </label>
                  <button onClick={() => void agregarHerramienta(p.id)} disabled={!herSel} style={{ padding: '6px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Agregar</button>
                </div>
              )}
              {puedeEditar && equipos.length === 0 && (
                <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
                  Las herramientas y el equipo salen de Operaciones → Equipos; aún no hay ninguno registrado.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>{titulo ?? 'Catálogo de actividades'}</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {subtitulo ?? (
              <>
                {plantillas.filter(p => p.activo).length} activas · {cargosUsados.length} cargo{cargosUsados.length !== 1 ? 's' : ''}
                {plantillas.some(p => !p.servicio) && ` · ${plantillas.filter(p => !p.servicio).length} sin clasificar`}
              </>
            )}
          </p>
        </div>
        {puedeCrear && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setShowImportar(true)}
              style={{ padding: '9px 16px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
              ⬆️ Carga masiva
            </button>
            <button onClick={() => { resetForm(); setShowForm(true) }}
              style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
              + Nueva actividad
            </button>
          </div>
        )}
      </div>

      {showImportar && (
        <ImportarActividadesModal
          proyectoId={proyectoId}
          onClose={() => setShowImportar(false)}
          onImportado={() => { onRefresh(); void cargarRecursos() }}
        />
      )}
      {showBloque && seleccionadas.length > 0 && (
        <RecursosEnBloqueModal
          proyectoId={proyectoId}
          plantillas={seleccionadas}
          suministros={suministros}
          equipos={equipos}
          onClose={() => setShowBloque(false)}
          onAplicado={() => { bloque.clear(); void cargarRecursos() }}
        />
      )}

      {soloLectura && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
          📖 Vista de consulta: el catálogo de actividades se administra en Seguridad → Plantillas.
        </div>
      )}

      {/* Form — BORRADOR en ventana emergente: nada persiste hasta Guardar */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar actividad' : 'Nueva actividad'}
          onClose={cerrarForm}
          size="lg"
          fullScreenOnMobile
          footer={
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={cerrarForm} disabled={saving} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              <button type="button" onClick={save} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Guardar'}
              </button>
            </div>
          }
        >
          {/* auto-fit: dos columnas en escritorio, una sola en el teléfono (hoja a pantalla completa). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '14px' }}>
            <div>
              <label style={labelStyle} htmlFor="act-servicio">Servicio *</label>
              <select id="act-servicio" value={form.servicio} autoFocus onChange={e => setForm(f => ({ ...f, servicio: e.target.value as '' | ServicioOperativo }))} style={inputStyle} aria-label="Servicio de la actividad">
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
              <label style={labelStyle} htmlFor="act-cargo">Cargo que la desempeña *</label>
              <select id="act-cargo" value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))} style={inputStyle} aria-label="Cargo que desempeña la actividad">
                <option value="">— Selecciona el cargo —</option>
                {opcionesCargo.map(o => <option key={o.value} value={o.value}>{o.historico ? `${o.value} (valor histórico)` : o.label}</option>)}
              </select>
              {cargoEsHistorico && (
                <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', marginTop: '4px' }}>
                  ⚠ Este cargo ya no está activo en Configuración. Podés conservarlo o elegir uno activo.
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle} htmlFor="act-titulo">Título de la actividad *</label>
              <input id="act-titulo" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Limpiar lobby, Revisar bomba..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="act-duracion">Duración estimada (min){form.servicio === 'limpieza' ? ' *' : ''}</label>
              <input id="act-duracion" type="number" min={1} value={form.duracion} onChange={e => setForm(f => ({ ...f, duracion: e.target.value }))} placeholder="Ej. 45" style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle} id="act-icono-lbl">Ícono</div>
              <div role="group" aria-labelledby="act-icono-lbl" style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1.5px solid var(--at-line)' }}>
                {ICONOS.map(ic => (
                  <button key={ic} type="button" onClick={() => setForm(f => ({ ...f, icono: ic }))} aria-pressed={form.icono === ic}
                    style={{ width: '34px', height: '34px', fontSize: '18px', borderRadius: '7px', border: '2px solid', borderColor: form.icono === ic ? 'var(--at-warning)' : 'transparent', background: form.icono === ic ? 'var(--at-warning-tint)' : 'transparent', cursor: 'pointer' }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={labelStyle} htmlFor="act-area">Área (opcional)</label>
                <select id="act-area" value={form.area_id} onChange={e => setForm(f => ({ ...f, area_id: e.target.value }))} style={inputStyle}>
                  <option value="">Sin área específica</option>
                  {areas.filter(a => a.activo).sort((a, b) => a.orden - b.orden).map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="act-orden">Orden</label>
                <input id="act-orden" type="number" value={form.orden} onChange={e => setForm(f => ({ ...f, orden: parseInt(e.target.value) || 0 }))} min={0} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Evidencias obligatorias al ejecutar</div>
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
              <label style={labelStyle} htmlFor="act-descripcion">Descripción / instrucciones</label>
              <textarea id="act-descripcion" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle de cómo realizar la actividad..." rows={2}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor="act-seguridad">Instrucciones de seguridad</label>
              <textarea id="act-seguridad" value={form.instrucciones_seguridad} onChange={e => setForm(f => ({ ...f, instrucciones_seguridad: e.target.value }))} placeholder="EPP requerido, bloqueo de área, manejo de químicos..." rows={2}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            {/* Checklist de pasos */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor="act-paso">Checklist ({form.checklist.length} paso{form.checklist.length !== 1 ? 's' : ''})</label>
              {form.checklist.length > 0 && (
                <ol style={{ margin: '0 0 8px', paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {form.checklist.map((paso, i) => (
                    <li key={`${i}-${paso}`} style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>
                      {paso}
                      <button type="button" onClick={() => quitarPaso(i)} aria-label={`Quitar paso ${paso}`}
                        style={{ marginLeft: '8px', padding: '1px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', color: 'var(--at-danger)' }}>✕</button>
                    </li>
                  ))}
                </ol>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input id="act-paso" value={nuevoPaso} onChange={e => setNuevoPaso(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarPaso() } }}
                  placeholder="Ej. Barrer y trapear el piso" style={{ ...inputStyle, flex: 1 }} />
                <button type="button" onClick={agregarPaso} style={{ padding: '9px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>+ Paso</button>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1', fontSize: '12px', color: 'var(--at-ink-3)' }}>
              🧰 Los insumos y herramientas se gestionan desde el botón «Recursos» de la tarjeta, una vez guardada la actividad.
            </div>
          </div>
        </EditModal>
      )}

      {/* Filtros: buscador + servicio + estado + cargo */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
        <input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar actividad…" aria-label="Buscar actividad"
          style={{ ...inputStyle, flex: '1 1 220px', minWidth: '180px', maxWidth: '360px' }} />
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
        {puedeBloque && filtradas.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={bloque.isAllSelected} onChange={bloque.toggleAll} aria-label="Seleccionar todas las actividades visibles" />
            {bloque.isAllSelected ? 'Quitar selección' : `Seleccionar todas (${filtradas.length})`}
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {(['todos', ...cargosUsados] as string[]).map(c => (
          <button key={c} onClick={() => setFiltroCargo(c)}
            style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: 'none',
              background: filtroCargo === c ? 'var(--at-warning-tint)' : 'var(--at-chip)', color: filtroCargo === c ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>
            {c === 'todos' ? `Todos (${plantillas.length})` : `${etiquetaDe(c)} (${plantillas.filter(p => p.cargo === c).length})`}
          </button>
        ))}
      </div>

      {recError && !recursosDe && (
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
          description={termino
            ? `Ninguna actividad coincide con «${busqueda.trim()}» y los filtros de servicio, cargo o estado.`
            : 'Ninguna actividad coincide con el servicio, cargo o estado seleccionados.'}
          compact
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {cargosPorGrupo.map(([cargo, tareas]) => (
            <div key={cargo}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--at-warning-strong)', background: 'var(--at-warning-tint)', padding: '4px 12px', borderRadius: '20px' }}>
                  {etiquetaDe(cargo)}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{tareas.length} actividad{tareas.length !== 1 ? 'es' : ''}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                {tareas.map(p => {
                  const areaNombre = areas.find(a => a.id === p.area_id)?.nombre
                  const nSum = (sumPorPlantilla.get(p.id) ?? []).length
                  const nHer = (herPorPlantilla.get(p.id) ?? []).length
                  return (
                    <div key={p.id} data-testid={`actividad-${p.id}`} data-seleccionada={puedeBloque && bloque.isSelected(p.id) ? 'si' : undefined}
                      style={{ background: 'var(--at-surface)', border: `1.5px solid ${puedeBloque && bloque.isSelected(p.id) ? 'var(--at-primary)' : p.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '12px', padding: '14px', opacity: p.activo ? 1 : 0.55 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        {puedeBloque && (
                          <input type="checkbox" checked={bloque.isSelected(p.id)} onChange={() => bloque.toggle(p.id)} aria-label={`Seleccionar ${p.titulo}`}
                            style={{ marginTop: '11px', flexShrink: 0 }} />
                        )}
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
                      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                        <button onClick={() => abrirRecursos(p.id)} aria-label={`Recursos de ${p.titulo}`} style={{ flex: 1, padding: '5px', background: recursosDe === p.id ? 'var(--at-primary-soft)' : 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>
                          🧰 Recursos ({nSum + nHer})
                        </button>
                        {enSeleccion && (
                          seleccion.yaElegidas.has(p.id)
                            ? <span style={{ flex: 1, padding: '5px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--at-success)' }}>✓ En la rutina</span>
                            : <button onClick={() => seleccion.onElegir(p)} aria-label={`Agregar ${p.titulo} a la rutina`} style={{ flex: 1, padding: '5px', background: 'var(--at-primary-soft)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-primary)', fontWeight: 700 }}>
                                ➕ Agregar
                              </button>
                        )}
                        {puedeEditar && <button onClick={() => startEdit(p)} style={{ flex: 1, padding: '5px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️ Editar</button>}
                        {puedeEditar && (
                          <button onClick={() => toggleActivo(p)} style={{ padding: '5px 10px', background: p.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: `1px solid ${p.activo ? 'var(--at-warning-border)' : 'var(--at-success-border)'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: p.activo ? 'var(--at-warning-strong)' : 'var(--at-success)' }}>
                            {p.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        )}
                        {puedeBorrar && <button onClick={() => deletePlantilla(p.id)} aria-label={`Eliminar ${p.titulo}`} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>}
                      </div>
                      {recursosDe === p.id && panelRecursos(p)}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {puedeBloque && (
        <SelectionToolbar
          count={bloque.count}
          entityLabel={{ one: 'actividad', many: 'actividades' }}
          onClear={bloque.clear}
          actions={[
            { id: 'recursos-bloque', label: 'Recursos en bloque', icon: '🧰', variant: 'primary', onClick: () => setShowBloque(true) },
          ]}
        />
      )}
    </div>
  )
}

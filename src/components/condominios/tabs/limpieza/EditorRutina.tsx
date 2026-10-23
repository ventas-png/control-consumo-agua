// Editor de una rutina de limpieza como RECORRIDO (20261102000000).
//
// CÓMO SE ARMA. Primero las áreas, en el orden en que se van a intervenir:
// se arrastran desde la paleta al recorrido y se reordenan arrastrándolas. Después
// a cada área se le sueltan encima las actividades del catálogo que se hacen
// ahí, también en orden. Es el orden que va a seguir quien reciba la rutina en
// su turno: la materialización respeta rutina → área → actividad.
//
// EL TIEMPO SE VA ACUMULANDO. Cada área suma las duraciones de sus actividades
// y arranca donde terminó la anterior; si la rutina tiene jornada, eso se lee
// como hora estimada («07:00 → 07:07»), y el total se compara con lo que dura la
// jornada. Las actividades sin duración se cuentan aparte: sin ese aviso el
// total se queda corto en silencio.
//
// SIN ARRASTRE TAMBIÉN. El arrastre nativo de HTML no existe en muchas pantallas
// táctiles ni con teclado, así que cada gesto tiene su botón: «＋» en la paleta
// (las actividades van al área SELECCIONADA), ↑ ↓ para reordenar —en el borde de
// un área la actividad cruza a la vecina— y ✕ para quitar.
//
// VARIAS DE UNA VEZ. «＋ Agregar áreas» (arriba del recorrido) y «＋ Actividades»
// (en cada área) abren una ventana para marcar muchas juntas (`SelectorVarios`):
// entran al final, en el orden en que se marcaron, y se acomodan con ↑ ↓.
//
// BORRADOR HASTA «GUARDAR». Nada persiste mientras se arma: la cabecera y el
// recorrido se guardan juntos, el recorrido en UNA transacción
// (`guardar_recorrido_rutina`). Cancelar nunca deja cambios a medias, y un
// arrastre que reordena todo no queda nunca medio aplicado.
//
// EN VENTANA. El editor se abre en su propia ventana (a pantalla completa en el
// teléfono) en vez de empujar la lista hacia abajo; cerrarla es «Cancelar» —con
// la misma confirmación si hay cambios— y mientras guarda no se cierra.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { notify, confirm } from '../../../shared/Dialog'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import {
  createCondominioRowReturning,
  guardarRecorridoRutina,
  updateCondominioRow,
} from '../../../../domain/condominios/tabMutations'
import { etiquetaCargo } from '../../../../domain/condominios/rrhhCatalogos'
import {
  alternarObligatoria, destinoVecino, formatearMinutos, horaMas, insertarActividad, insertarActividades,
  insertarParada, insertarParadas, minutosJornada, mismoRecorrido, moverActividad, moverParada,
  quitarActividad, quitarParada, tieneArea, tiempoRecorrido, type PosicionPaso, type Recorrido,
} from '../../../../domain/condominios/rutinasRecorrido'
import { SERVICIO_LABEL } from '../../ActividadesCatalog'
import { SelectorVarios } from './SelectorVarios'
import type {
  AreaCondominio, CargoCatalogo, PlantillaTareaCargo, RutinaLimpieza, ServicioOperativo,
} from '../../../../types'

export interface Jornada { id: string; nombre: string; hora_inicio: string; hora_fin: string }

interface Props {
  /** null = rutina nueva. */
  rutina: RutinaLimpieza | null
  recorridoInicial: Recorrido
  areas: AreaCondominio[]
  plantillas: PlantillaTareaCargo[]
  horarios: Jornada[]
  cargos?: CargoCatalogo[]
  proyectoId: string
  companyId: string
  /** Sin permiso de edición el editor es sólo una vista del recorrido. */
  soloLectura?: boolean
  onGuardado: () => void
  onCerrar: () => void
}

/** Lo que se está arrastrando: algo nuevo de la paleta, o algo ya puesto. */
type Arrastre =
  | { tipo: 'area'; areaId: string }
  | { tipo: 'parada'; indice: number }
  | { tipo: 'actividad'; plantillaId: string }
  | { tipo: 'paso'; desde: PosicionPaso }

/** Dónde caería: antes de la parada `indice`, o antes del paso `indice` de una parada. */
type Destino =
  | { tipo: 'parada'; indice: number }
  | { tipo: 'paso'; parada: number; indice: number }

/** La ventana de «agregar varias» abierta: áreas al recorrido, o actividades a un área. */
type Ventana = { tipo: 'areas' } | { tipo: 'actividades'; areaId: string }

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  background: 'var(--at-surface-2)',
}
const labelStyle: CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)',
  display: 'block', marginBottom: '4px',
}
const botonMini: CSSProperties = {
  padding: '2px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
  borderRadius: '6px', cursor: 'pointer', fontSize: '11.5px', lineHeight: 1.4,
}
const botonVarios: CSSProperties = {
  padding: '5px 10px', background: 'var(--at-primary-soft)', border: '1px solid var(--at-primary)',
  borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: 'var(--at-primary)',
  whiteSpace: 'nowrap',
}
const lineaInsercion: CSSProperties = {
  height: '3px', borderRadius: '2px', background: 'var(--at-primary)', margin: '2px 0',
}

/**
 * Ancho desde el que paleta y recorrido caben uno al lado del otro: la suma de
 * sus `flex-basis` (260 + 360) más el hueco (14). Por debajo se apilan.
 */
const ANCHO_AL_LADO = 634

/** Arriba o abajo de la mitad del elemento sobre el que se arrastra. */
function mitadSuperior(e: DragEvent<HTMLElement>): boolean {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY < r.top + r.height / 2
}

export function EditorRutina({
  rutina, recorridoInicial, areas, plantillas, horarios, cargos = [],
  proyectoId, companyId, soloLectura = false, onGuardado, onCerrar,
}: Props) {
  const cabeceraInicial = useMemo(() => ({
    nombre: rutina?.nombre ?? '',
    descripcion: rutina?.descripcion ?? '',
    plantilla_horario_id: rutina?.plantilla_horario_id ?? '',
    orden: rutina?.orden ?? 0,
  }), [rutina])
  const [cabecera, setCabecera] = useState(cabeceraInicial)
  const [rec, setRec] = useState<Recorrido>(recorridoInicial)
  /** Si la cabecera nueva ya se creó pero el recorrido falló, reintentar no la duplica. */
  const [rutinaId, setRutinaId] = useState<string | null>(rutina?.id ?? null)
  const [saving, setSaving] = useState(false)

  /** Área seleccionada: a dónde van las actividades que se agregan con «＋». */
  const [activa, setActiva] = useState<string | null>(
    recorridoInicial.find(p => p.area_id !== null)?.area_id ?? null,
  )
  const [paleta, setPaleta] = useState<'areas' | 'actividades'>(recorridoInicial.length === 0 ? 'areas' : 'actividades')
  const [busqueda, setBusqueda] = useState('')
  const [servicio, setServicio] = useState<ServicioOperativo | ''>('limpieza')
  const [aviso, setAviso] = useState('')
  const [ventana, setVentana] = useState<Ventana | null>(null)

  // La paleta acompaña el scroll (sticky) sólo cuando va AL LADO del recorrido:
  // apilada encima, en pantallas angostas, se quedaría pegada tapándolo. Se mide
  // la fila y no la ventana, porque lo que decide si se apilan es el ancho que le
  // deja el resto de la pantalla.
  const filaRef = useRef<HTMLDivElement>(null)
  const [alLado, setAlLado] = useState(false)
  useEffect(() => {
    const el = filaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => setAlLado(el.clientWidth >= ANCHO_AL_LADO)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const arrastre = useRef<Arrastre | null>(null)
  const [arrastrando, setArrastrando] = useState<Arrastre['tipo'] | null>(null)
  const [destino, setDestino] = useState<Destino | null>(null)

  const porArea = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])
  const porPlantilla = useMemo(() => new Map(plantillas.map(p => [p.id, p])), [plantillas])
  const jornada = horarios.find(h => h.id === cabecera.plantilla_horario_id) ?? null
  const tiempo = useMemo(() => tiempoRecorrido(rec, porPlantilla), [rec, porPlantilla])
  const minutosDeJornada = jornada ? minutosJornada(jornada.hora_inicio, jornada.hora_fin) : 0
  const indiceActiva = activa ? rec.findIndex(p => p.area_id === activa) : -1

  const sucio = !mismoRecorrido(rec, recorridoInicial)
    || JSON.stringify(cabecera) !== JSON.stringify(cabeceraInicial)

  const nombreArea = (id: string | null) =>
    id === null ? 'Actividades sin área' : porArea.get(id)?.nombre ?? '(área no encontrada)'
  const nombreActividad = (id: string) => porPlantilla.get(id)?.titulo ?? '(actividad no encontrada)'

  // ── Gestos ─────────────────────────────────────────────────────────────────

  /** Aplica un cambio; si no cambió nada, explica por qué en vez de callar. */
  function aplicar(nuevo: Recorrido, siNada: string, hecho: string) {
    if (nuevo === rec) { setAviso(siNada); return false }
    setRec(nuevo); setAviso(hecho); return true
  }

  function agregarArea(areaId: string, en?: number) {
    if (aplicar(insertarParada(rec, areaId, en), `«${nombreArea(areaId)}» ya está en el recorrido.`,
      `«${nombreArea(areaId)}» agregada al recorrido.`)) {
      setActiva(areaId)
    }
  }

  function agregarActividad(plantillaId: string, parada: number, en?: number) {
    const area = rec[parada]?.area_id ?? null
    aplicar(insertarActividad(rec, parada, plantillaId, en),
      `«${nombreActividad(plantillaId)}» ya está en «${nombreArea(area)}».`,
      `«${nombreActividad(plantillaId)}» agregada a «${nombreArea(area)}».`)
    if (area) setActiva(area)
  }

  /** Lo marcado en la ventana «＋ Agregar áreas»: al final, en el orden marcado. */
  function agregarAreas(ids: string[]) {
    setVentana(null)
    const nuevas = ids.filter(id => !tieneArea(rec, id))
    if (aplicar(insertarParadas(rec, ids), 'Esas áreas ya están en el recorrido.',
      nuevas.length === 1
        ? `«${nombreArea(nuevas[0])}» agregada al recorrido.`
        : `${nuevas.length} áreas agregadas al final del recorrido. Ordenalas con ↑ ↓ o arrastrándolas.`)) {
      setActiva(nuevas[0])
    }
  }

  /** Lo marcado en la ventana «＋ Actividades» de un área: al final de ella. */
  function agregarActividades(areaId: string, ids: string[]) {
    setVentana(null)
    const parada = rec.findIndex(p => p.area_id === areaId)
    const ya = new Set(rec[parada]?.actividades.map(a => a.plantilla_tarea_id) ?? [])
    const nuevas = ids.filter(id => !ya.has(id))
    aplicar(insertarActividades(rec, parada, ids), `Esas actividades ya están en «${nombreArea(areaId)}».`,
      nuevas.length === 1
        ? `«${nombreActividad(nuevas[0])}» agregada a «${nombreArea(areaId)}».`
        : `${nuevas.length} actividades agregadas a «${nombreArea(areaId)}». Ordenalas con ↑ ↓.`)
    setActiva(areaId)
  }

  function moverPaso(desde: PosicionPaso, hasta: PosicionPaso) {
    const id = rec[desde.parada]?.actividades[desde.indice]?.plantilla_tarea_id ?? ''
    const area = rec[hasta.parada]?.area_id ?? null
    aplicar(moverActividad(rec, desde, hasta),
      desde.parada === hasta.parada ? '' : `«${nombreActividad(id)}» ya está en «${nombreArea(area)}».`,
      `«${nombreActividad(id)}» movida.`)
  }

  function quitarArea(indice: number) {
    const area = rec[indice]?.area_id ?? null
    setRec(quitarParada(rec, indice))
    setAviso(`«${nombreArea(area)}» quitada del recorrido.`)
    if (area === activa) setActiva(null)
  }

  // ── Arrastre ───────────────────────────────────────────────────────────────

  function empezar(e: DragEvent<HTMLElement>, a: Arrastre, texto: string) {
    e.stopPropagation()
    arrastre.current = a
    setArrastrando(a.tipo)
    // Firefox no arranca un arrastre sin datos.
    e.dataTransfer?.setData('text/plain', texto)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = a.tipo === 'area' || a.tipo === 'actividad' ? 'copy' : 'move'
  }

  function terminar() {
    arrastre.current = null
    setArrastrando(null)
    setDestino(null)
  }

  const arrastraArea = () => arrastre.current?.tipo === 'area' || arrastre.current?.tipo === 'parada'
  const arrastraActividad = () => arrastre.current?.tipo === 'actividad' || arrastre.current?.tipo === 'paso'

  /** Sobre una parada: si se arrastra un área, la línea va antes o después de ella. */
  function sobreParada(e: DragEvent<HTMLElement>, indice: number) {
    if (!arrastraArea()) return
    e.preventDefault()
    const d: Destino = { tipo: 'parada', indice: mitadSuperior(e) ? indice : indice + 1 }
    if (destino?.tipo !== d.tipo || destino.indice !== d.indice) setDestino(d)
  }

  /** Sobre una actividad ya puesta: la línea va antes o después de ella. */
  function sobrePaso(e: DragEvent<HTMLElement>, parada: number, indice: number) {
    if (!arrastraActividad() || rec[parada]?.area_id === null) return
    e.preventDefault()
    e.stopPropagation()
    const d: Destino = { tipo: 'paso', parada, indice: mitadSuperior(e) ? indice : indice + 1 }
    if (destino?.tipo !== 'paso' || destino.parada !== parada || destino.indice !== d.indice) setDestino(d)
  }

  /** Sobre el cuerpo de una parada (vacío o fuera de las filas): al final de ella. */
  function sobreCuerpo(e: DragEvent<HTMLElement>, parada: number) {
    if (!arrastraActividad() || rec[parada]?.area_id === null) return
    e.preventDefault()
    e.stopPropagation()
    const indice = rec[parada].actividades.length
    if (destino?.tipo !== 'paso' || destino.parada !== parada || destino.indice !== indice) {
      setDestino({ tipo: 'paso', parada, indice })
    }
  }

  function soltar(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    const a = arrastre.current
    const d = destino
    terminar()
    if (!a || !d) return
    if (d.tipo === 'parada') {
      if (a.tipo === 'area') agregarArea(a.areaId, d.indice)
      else if (a.tipo === 'parada') setRec(moverParada(rec, a.indice, d.indice))
      return
    }
    if (a.tipo === 'actividad') agregarActividad(a.plantillaId, d.parada, d.indice)
    else if (a.tipo === 'paso') moverPaso(a.desde, { parada: d.parada, indice: d.indice })
  }

  // ── Guardar ────────────────────────────────────────────────────────────────

  async function guardar() {
    const nombre = cabecera.nombre.trim()
    if (!nombre) { notify({ variant: 'error', title: 'Error', text: 'La rutina necesita un nombre.' }); return }

    setSaving(true)
    const payload = {
      nombre,
      descripcion: cabecera.descripcion.trim() || null,
      plantilla_horario_id: cabecera.plantilla_horario_id || null,
      orden: Number(cabecera.orden) || 0,
    }
    let id = rutinaId
    const { data, error } = id
      ? { data: null, ...(await updateCondominioRow('rutinas_limpieza', id, payload)) }
      : await createCondominioRowReturning('rutinas_limpieza', {
          ...payload, company_id: companyId, project_id: proyectoId, servicio: 'limpieza',
        }, 'id')
    if (error) {
      setSaving(false)
      // 23505 = el índice único por nombre normalizado. El mensaje crudo de
      // Postgres no le dice nada a quien está capturando.
      notify({
        variant: 'error',
        title: error.code === '23505' ? 'Nombre repetido' : 'Error',
        text: error.code === '23505'
          ? 'Ya existe una rutina con ese nombre en este proyecto. Editá la que existe o elegí otro nombre.'
          : error.message,
      })
      return
    }
    if (!id) {
      id = (data?.id as string | undefined) ?? null
      setRutinaId(id)
    }
    if (!id) {
      setSaving(false)
      notify({ variant: 'error', title: 'Error', text: 'La rutina se creó pero no se pudo leer su identificador. Recargá la vista.' })
      return
    }

    const res = await guardarRecorridoRutina(id, rec)
    setSaving(false)
    if (res.error) {
      // La cabecera ya quedó: el editor sigue abierto sobre ESA rutina, y
      // volver a guardar reintenta sólo el recorrido.
      notify({
        variant: 'error',
        title: 'No se pudo guardar el recorrido',
        text: `${res.error.message}${rutina ? '' : ' La rutina quedó creada: volvé a guardar para reintentar el recorrido.'}`,
      })
      return
    }
    onGuardado()
  }

  async function cancelar() {
    // A mitad del guardado no se cierra: cerrar ahí escondería el resultado.
    if (saving) return
    if (sucio && !soloLectura) {
      const r = await confirm({
        title: '¿Descartar los cambios?',
        text: 'El recorrido y la cabecera vuelven a como estaban; nada se guardó todavía.',
        icon: 'warning', variant: 'danger', confirmText: 'Descartar',
      })
      if (!r.isConfirmed) return
    }
    onCerrar()
  }

  // ── Paleta ─────────────────────────────────────────────────────────────────

  const areasActivas = useMemo(() => areas
    .filter(a => a.activo !== false)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)), [areas])
  const actividadesActivas = useMemo(() => plantillas
    .filter(p => p.activo !== false)
    .sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo)), [plantillas])

  const q = busqueda.trim().toLowerCase()
  const areasPaleta = areasActivas.filter(a => !q || a.nombre.toLowerCase().includes(q))
  const actividadesPaleta = actividadesActivas
    .filter(p => !servicio || p.servicio === servicio)
    .filter(p => !q || p.titulo.toLowerCase().includes(q))
  const enActiva = new Set(rec[indiceActiva]?.actividades.map(a => a.plantilla_tarea_id) ?? [])

  /** Duración y cargo de una actividad del catálogo, igual en la paleta y en la ventana. */
  const detalleActividad = (p: PlantillaTareaCargo) => (
    <>
      {p.duracion_estimada_min != null
        ? `⏱ ${p.duracion_estimada_min} min`
        : <span style={{ color: 'var(--at-warning-strong)' }}>⚠ sin duración</span>}
      {' · '}{etiquetaCargo(p.cargo, cargos)}
    </>
  )

  function renderPaleta() {
    const tab = (id: 'areas' | 'actividades', texto: string) => (
      <button
        role="tab"
        aria-selected={paleta === id}
        onClick={() => { setPaleta(id); setBusqueda('') }}
        style={{
          flex: 1, padding: '7px', border: 'none', borderRadius: '7px', cursor: 'pointer',
          fontSize: '12.5px', fontWeight: 700, whiteSpace: 'nowrap',
          background: paleta === id ? 'var(--at-primary)' : 'transparent',
          color: paleta === id ? 'white' : 'var(--at-ink-2)',
        }}
      >{texto}</button>
    )
    return (
      <aside
        aria-label="Paleta de áreas y actividades"
        style={{
          flex: '1 1 260px', maxWidth: '100%', minWidth: 0, alignSelf: 'flex-start',
          position: alLado ? 'sticky' : 'static', top: '12px', background: 'var(--at-surface)',
          border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '10px',
        }}
      >
        <div role="tablist" aria-label="Qué agregar" style={{ display: 'flex', gap: '4px', background: 'var(--at-surface-2)', borderRadius: '9px', padding: '3px', marginBottom: '8px' }}>
          {tab('areas', '📍 Áreas')}
          {tab('actividades', '📋 Actividades')}
        </div>
        <input
          aria-label={paleta === 'areas' ? 'Buscar área' : 'Buscar actividad'}
          placeholder={paleta === 'areas' ? 'Buscar área…' : 'Buscar actividad…'}
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ ...inputStyle, padding: '7px 10px', fontSize: '13px', marginBottom: '8px' }}
        />

        {paleta === 'areas' ? (
          <>
            <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginBottom: '6px' }}>
              Arrastrá las áreas al recorrido en el orden en que se van a intervenir.
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '5px', maxHeight: '55vh', overflowY: 'auto' }}>
              {areasPaleta.map(a => {
                const puesta = tieneArea(rec, a.id)
                return (
                  <li
                    key={a.id}
                    draggable={!puesta && !soloLectura}
                    onDragStart={e => empezar(e, { tipo: 'area', areaId: a.id }, a.nombre)}
                    onDragEnd={terminar}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px',
                      border: '1px solid var(--at-line)', borderRadius: '9px',
                      background: puesta ? 'var(--at-surface-2)' : 'var(--at-surface)',
                      opacity: puesta ? 0.6 : 1, cursor: puesta || soloLectura ? 'default' : 'grab',
                    }}
                  >
                    <span aria-hidden style={{ fontSize: '18px' }}>{a.icono}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</span>
                    {puesta
                      ? <span style={{ fontSize: '11px', color: 'var(--at-success)', fontWeight: 700 }}>✓ En el recorrido</span>
                      : !soloLectura && (
                        <button onClick={() => agregarArea(a.id)} aria-label={`Agregar ${a.nombre} al recorrido`} style={{ ...botonMini, fontWeight: 700, color: 'var(--at-primary)' }}>＋</button>
                      )}
                  </li>
                )
              })}
            </ul>
            {areasPaleta.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', padding: '8px 2px' }}>
                {q ? 'Ninguna área coincide.' : 'No hay áreas activas. Se crean en el tab Áreas.'}
              </div>
            )}
          </>
        ) : (
          <>
            <select
              aria-label="Servicio"
              value={servicio}
              onChange={e => setServicio(e.target.value as ServicioOperativo | '')}
              style={{ ...inputStyle, padding: '6px 10px', fontSize: '12.5px', marginBottom: '6px' }}
            >
              <option value="">Todos los servicios</option>
              {(Object.keys(SERVICIO_LABEL) as ServicioOperativo[]).map(s => (
                <option key={s} value={s}>{SERVICIO_LABEL[s]}</option>
              ))}
            </select>
            <div style={{ fontSize: '11.5px', color: indiceActiva >= 0 ? 'var(--at-ink-3)' : 'var(--at-warning-strong)', marginBottom: '6px' }}>
              {indiceActiva >= 0
                ? <>Soltalas sobre un área, o con ＋ van a <strong>{nombreArea(activa)}</strong>.</>
                : 'Soltalas sobre un área del recorrido, o seleccioná un área para agregarlas con ＋.'}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '5px', maxHeight: '55vh', overflowY: 'auto' }}>
              {actividadesPaleta.map(p => {
                const ya = enActiva.has(p.id)
                return (
                  <li
                    key={p.id}
                    draggable={!soloLectura}
                    onDragStart={e => empezar(e, { tipo: 'actividad', plantillaId: p.id }, p.titulo)}
                    onDragEnd={terminar}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px',
                      border: '1px solid var(--at-line)', borderRadius: '9px', background: 'var(--at-surface)',
                      cursor: soloLectura ? 'default' : 'grab',
                    }}
                  >
                    <span aria-hidden style={{ fontSize: '17px' }}>{p.icono || '✅'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.titulo}</span>
                      <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{detalleActividad(p)}</span>
                    </span>
                    {!soloLectura && (ya
                      ? <span style={{ fontSize: '11px', color: 'var(--at-success)', fontWeight: 700 }} title={`Ya está en ${nombreArea(activa)}`}>✓</span>
                      : (
                        <button
                          onClick={() => agregarActividad(p.id, indiceActiva)}
                          disabled={indiceActiva < 0}
                          aria-label={indiceActiva >= 0 ? `Agregar ${p.titulo} a ${nombreArea(activa)}` : `Agregar ${p.titulo} (primero seleccioná un área)`}
                          style={{ ...botonMini, fontWeight: 700, color: 'var(--at-primary)', opacity: indiceActiva < 0 ? 0.4 : 1, cursor: indiceActiva < 0 ? 'default' : 'pointer' }}
                        >＋</button>
                      ))}
                  </li>
                )
              })}
            </ul>
            {actividadesPaleta.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', padding: '8px 2px' }}>
                {q || servicio ? 'Ninguna actividad coincide con el filtro.' : 'El catálogo de actividades está vacío (se administra en Plantillas).'}
              </div>
            )}
          </>
        )}
      </aside>
    )
  }

  // ── Recorrido ──────────────────────────────────────────────────────────────

  function renderParada(i: number) {
    const parada = rec[i]
    const legado = parada.area_id === null
    const area = parada.area_id ? porArea.get(parada.area_id) : undefined
    const t = tiempo.porParada[i]
    const seleccionada = !legado && parada.area_id === activa
    const numero = rec.slice(0, i + 1).filter(p => p.area_id !== null).length
    const recibeActividad = arrastrando === 'actividad' || arrastrando === 'paso'
    const primerReal = rec[0]?.area_id === null ? 1 : 0

    return (
      <div key={parada.area_id ?? 'legado'}>
        {destino?.tipo === 'parada' && destino.indice === i && <div style={lineaInsercion} aria-hidden />}
        <section
          aria-label={legado ? 'Actividades sin área' : `Área ${numero}: ${area?.nombre ?? ''}`}
          onDragOver={e => sobreParada(e, i)}
          onDrop={soltar}
          style={{
            background: 'var(--at-surface)', borderRadius: '12px',
            border: `1.5px solid ${seleccionada ? 'var(--at-primary)' : legado ? 'var(--at-warning-border)' : 'var(--at-line)'}`,
            boxShadow: seleccionada ? '0 0 0 3px var(--at-primary-soft)' : 'none',
          }}
        >
          {/* Cabecera: es lo que se arrastra para reordenar las áreas. */}
          <div
            draggable={!legado && !soloLectura}
            onDragStart={e => empezar(e, { tipo: 'parada', indice: i }, area?.nombre ?? '')}
            onDragEnd={terminar}
            onClick={() => !legado && setActiva(parada.area_id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
              cursor: legado || soloLectura ? 'default' : 'grab', flexWrap: 'wrap',
              borderBottom: '1px solid var(--at-chip)',
            }}
          >
            {!legado && !soloLectura && <span aria-hidden style={{ color: 'var(--at-ink-3)', fontSize: '14px' }}>⠿</span>}
            <span style={{
              minWidth: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: legado ? 'var(--at-warning-tint)' : 'var(--at-primary)', color: legado ? 'var(--at-warning-strong)' : 'white',
              fontSize: '12px', fontWeight: 800,
            }}>{legado ? '!' : numero}</span>
            <span aria-hidden style={{ fontSize: '18px' }}>{legado ? '📋' : area?.icono ?? '📍'}</span>
            <span style={{ flex: 1, minWidth: '120px' }}>
              <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>
                {nombreArea(parada.area_id)}
                {area && area.activo === false && (
                  <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--at-warning-strong)' }} title="El área está dada de baja: el recorrido la conserva pero no genera tareas en ella.">⚠ inactiva</span>
                )}
              </span>
              <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
                ⏱ {formatearMinutos(t.minutos)}
                {jornada
                  ? ` · ${horaMas(jornada.hora_inicio, t.desde)} → ${horaMas(jornada.hora_inicio, t.hasta)}`
                  : t.hasta > 0 ? ` · acumulado ${formatearMinutos(t.hasta)}` : ''}
                {t.sinDato > 0 && <span style={{ color: 'var(--at-warning-strong)' }}> · ⚠ {t.sinDato} sin duración</span>}
              </span>
            </span>
            {!legado && !soloLectura && (
              <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button onClick={() => setVentana({ tipo: 'actividades', areaId: parada.area_id! })} aria-label={`Agregar actividades a ${area?.nombre ?? 'el área'}`} title="Elegir varias actividades de una vez" style={{ ...botonVarios, padding: '2px 8px', fontSize: '11.5px' }}>＋ Actividades</button>
                <button onClick={() => setRec(moverParada(rec, i, i - 1))} disabled={i <= primerReal} aria-label={`Subir ${area?.nombre ?? 'el área'}`} style={{ ...botonMini, opacity: i <= primerReal ? 0.4 : 1 }}>↑</button>
                <button onClick={() => setRec(moverParada(rec, i, i + 2))} disabled={i === rec.length - 1} aria-label={`Bajar ${area?.nombre ?? 'el área'}`} style={{ ...botonMini, opacity: i === rec.length - 1 ? 0.4 : 1 }}>↓</button>
                <button onClick={() => quitarArea(i)} aria-label={`Quitar ${area?.nombre ?? 'el área'} del recorrido`} style={{ ...botonMini, background: 'var(--at-danger-tint)', border: 'none', color: 'var(--at-danger)' }}>✕</button>
              </span>
            )}
          </div>

          {/* Cuerpo: aquí caen las actividades. */}
          <div
            onDragOver={e => sobreCuerpo(e, i)}
            onDrop={soltar}
            style={{ padding: '8px 12px 10px' }}
          >
            {legado && (
              <div style={{ fontSize: '11.5px', color: 'var(--at-warning-strong)', marginBottom: '6px' }}>
                Pasos de antes del recorrido por áreas. Siguen generando tareas como siempre; arrastralos (o bajalos con ↓) a un área para ordenarlos.
              </div>
            )}
            {parada.actividades.map((paso, j) => {
              const act = porPlantilla.get(paso.plantilla_tarea_id)
              const arriba = destinoVecino(rec, { parada: i, indice: j }, -1)
              const abajo = destinoVecino(rec, { parada: i, indice: j }, 1)
              return (
                <div key={paso.plantilla_tarea_id}>
                  {destino?.tipo === 'paso' && destino.parada === i && destino.indice === j && <div style={lineaInsercion} aria-hidden />}
                  <div
                    draggable={!soloLectura}
                    onDragStart={e => empezar(e, { tipo: 'paso', desde: { parada: i, indice: j } }, act?.titulo ?? '')}
                    onDragEnd={terminar}
                    onDragOver={e => sobrePaso(e, i, j)}
                    onDrop={soltar}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px', marginBottom: '4px',
                      background: 'var(--at-surface-2)', borderRadius: '8px', fontSize: '12.5px', color: 'var(--at-ink-2)',
                      cursor: soloLectura ? 'default' : 'grab', flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ color: 'var(--at-ink-3)', minWidth: '18px' }}>{j + 1}.</span>
                    <span style={{ flex: 1, minWidth: '120px' }}>
                      {act?.icono ?? '✅'} {act?.titulo ?? '(actividad no encontrada en el catálogo)'}
                      {act?.duracion_estimada_min != null
                        ? <span style={{ color: 'var(--at-ink-3)' }}> · {act.duracion_estimada_min} min</span>
                        : <span style={{ color: 'var(--at-warning-strong)' }} title="Sin duración estimada: el total del recorrido se queda corto."> · ⚠ sin duración</span>}
                      {act && act.activo === false && (
                        <span style={{ color: 'var(--at-warning-strong)', fontWeight: 700 }} title="La actividad está desactivada en el catálogo: la rutina la conserva pero no genera tareas con ella."> · ⚠ inactiva</span>
                      )}
                    </span>
                    {soloLectura ? (
                      <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{paso.obligatoria ? 'Obligatorio' : 'Opcional'}</span>
                    ) : (
                      <span style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => setRec(alternarObligatoria(rec, i, j))} title={paso.obligatoria ? 'Paso obligatorio' : 'Paso opcional'} aria-label={`${paso.obligatoria ? 'Volver opcional' : 'Volver obligatorio'} ${act?.titulo ?? 'el paso'}`} style={{ ...botonMini, border: 'none', fontWeight: 600, background: paso.obligatoria ? 'var(--at-primary-soft)' : 'var(--at-chip)', color: paso.obligatoria ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
                          {paso.obligatoria ? 'Obligatorio' : 'Opcional'}
                        </button>
                        <button onClick={() => arriba && moverPaso({ parada: i, indice: j }, arriba)} disabled={!arriba} aria-label={`Subir ${act?.titulo ?? 'el paso'}`} style={{ ...botonMini, opacity: arriba ? 1 : 0.4 }}>↑</button>
                        <button onClick={() => abajo && moverPaso({ parada: i, indice: j }, abajo)} disabled={!abajo} aria-label={`Bajar ${act?.titulo ?? 'el paso'}`} style={{ ...botonMini, opacity: abajo ? 1 : 0.4 }}>↓</button>
                        <button onClick={() => { setRec(quitarActividad(rec, i, j)); setAviso(`«${act?.titulo ?? 'La actividad'}» quitada de «${nombreArea(parada.area_id)}».`) }} aria-label={`Quitar ${act?.titulo ?? 'el paso'} de ${nombreArea(parada.area_id)}`} style={{ ...botonMini, border: 'none', background: 'var(--at-danger-tint)', color: 'var(--at-danger)' }}>✕</button>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {destino?.tipo === 'paso' && destino.parada === i && destino.indice === parada.actividades.length && <div style={lineaInsercion} aria-hidden />}
            {!legado && parada.actividades.length === 0 && (
              <div style={{
                padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--at-ink-3)',
                border: `1.5px dashed ${recibeActividad ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '8px',
              }}>
                {soloLectura ? 'Sin actividades.' : <>Soltá aquí las actividades que se hacen en esta área, o tocá <strong>＋ Actividades</strong> para elegir varias.</>}
              </div>
            )}
          </div>
        </section>
      </div>
    )
  }

  const excede = minutosDeJornada > 0 && tiempo.minutos > minutosDeJornada
  const porcentaje = minutosDeJornada > 0 ? Math.min(100, Math.round((tiempo.minutos / minutosDeJornada) * 100)) : 0

  return (
    <EditModal
      title={soloLectura ? `Recorrido de «${rutina?.nombre ?? ''}»` : rutina ? `Editar «${rutina.nombre}»` : 'Nueva rutina'}
      subtitle={soloLectura ? undefined : 'Borrador: nada se guarda hasta «Guardar»'}
      size="xl"
      fullScreenOnMobile
      onClose={() => void cancelar()}
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => void cancelar()} disabled={saving}>
            {soloLectura ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!soloLectura && (
            <Button onClick={() => void guardar()} loading={saving} loadingText="Guardando…">Guardar</Button>
          )}
        </>
      }
    >
      {!soloLectura && (
        <>
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div>
              <label style={labelStyle} htmlFor="rutina-nombre">Nombre</label>
              <input id="rutina-nombre" style={inputStyle} value={cabecera.nombre}
                onChange={e => setCabecera(c => ({ ...c, nombre: e.target.value }))}
                placeholder="Rutina lunes AM" />
            </div>
            <div>
              <label style={labelStyle} htmlFor="rutina-horario">Jornada</label>
              <select id="rutina-horario" style={inputStyle} value={cabecera.plantilla_horario_id}
                onChange={e => setCabecera(c => ({ ...c, plantilla_horario_id: e.target.value }))}>
                <option value="">Sin jornada fija</option>
                {horarios.map(h => (
                  <option key={h.id} value={h.id}>{h.nombre} ({h.hora_inicio.slice(0, 5)}–{h.hora_fin.slice(0, 5)})</option>
                ))}
              </select>
              {!cabecera.plantilla_horario_id && (
                <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                  {horarios.length === 0
                    ? 'No hay jornadas activas cargadas (se definen en Turnos).'
                    : 'Opcional: la jornada sólo sirve para comparar el tiempo del recorrido. A quién le toca y qué día se asigna en el Calendario.'}
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle} htmlFor="rutina-orden">Orden</label>
              <input id="rutina-orden" type="number" style={inputStyle} value={cabecera.orden}
                onChange={e => setCabecera(c => ({ ...c, orden: Number(e.target.value) }))} />
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={labelStyle} htmlFor="rutina-desc">Descripción</label>
            <input id="rutina-desc" style={inputStyle} value={cabecera.descripcion}
              onChange={e => setCabecera(c => ({ ...c, descripcion: e.target.value }))} />
          </div>
        </>
      )}

      {/* Resumen: el tiempo que va acumulando el recorrido. */}
      <div aria-label="Resumen del recorrido" style={{
        marginTop: '12px', padding: '10px 12px', background: excede ? 'var(--at-warning-tint)' : 'var(--at-primary-soft)',
        borderRadius: '10px', display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>🗺 <strong>{tiempo.paradas}</strong> área{tiempo.paradas !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>📋 <strong>{tiempo.pasos}</strong> actividad{tiempo.pasos !== 1 ? 'es' : ''}</span>
        <span style={{ fontSize: '14px', color: 'var(--at-ink)', fontWeight: 800 }}>⏱ Total {formatearMinutos(tiempo.minutos)}</span>
        {jornada && minutosDeJornada > 0 && (
          <span style={{ flex: '1 1 180px', minWidth: '160px' }}>
            <span style={{ display: 'block', fontSize: '11.5px', color: excede ? 'var(--at-warning-strong)' : 'var(--at-ink-3)', fontWeight: excede ? 700 : 500 }}>
              {excede
                ? `⚠ Excede la jornada «${jornada.nombre}» (${formatearMinutos(minutosDeJornada)}) por ${formatearMinutos(tiempo.minutos - minutosDeJornada)}`
                : `${porcentaje}% de la jornada «${jornada.nombre}» (${formatearMinutos(minutosDeJornada)}) · termina ≈ ${horaMas(jornada.hora_inicio, tiempo.minutos)}`}
            </span>
            <span aria-hidden style={{ display: 'block', height: '6px', borderRadius: '3px', background: 'var(--at-surface)', marginTop: '4px', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${porcentaje}%`, background: excede ? 'var(--at-warning-strong)' : 'var(--at-primary)' }} />
            </span>
          </span>
        )}
        {tiempo.sinDato > 0 && (
          <span style={{ fontSize: '12px', color: 'var(--at-warning-strong)', fontWeight: 600 }} title="Estas actividades no declaran duración estimada: el total se queda corto.">
            ⚠ {tiempo.sinDato} sin duración
          </span>
        )}
      </div>

      <div ref={filaRef} style={{ display: 'flex', gap: '14px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {!soloLectura && renderPaleta()}

        <div style={{ flex: '999 1 360px', minWidth: 0 }} aria-label="Recorrido">
          {!soloLectura && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)' }}>
                Recorrido{tiempo.paradas > 0 ? ` · ${tiempo.paradas} área${tiempo.paradas !== 1 ? 's' : ''}` : ''}
              </span>
              <button onClick={() => setVentana({ tipo: 'areas' })} title="Elegir varias áreas de una vez" style={botonVarios}>＋ Agregar áreas</button>
            </div>
          )}
          {rec.length === 0 ? (
            <div
              onDragOver={e => { if (arrastraArea()) { e.preventDefault(); if (destino?.tipo !== 'parada') setDestino({ tipo: 'parada', indice: 0 }) } }}
              onDrop={soltar}
              style={{
                padding: '28px 16px', textAlign: 'center', borderRadius: '12px', background: 'var(--at-surface)',
                border: `2px dashed ${arrastrando === 'area' ? 'var(--at-primary)' : 'var(--at-line)'}`,
                color: 'var(--at-ink-3)', fontSize: '13px',
              }}
            >
              <div style={{ fontSize: '26px', marginBottom: '6px' }}>🗺</div>
              {soloLectura
                ? 'Esta rutina todavía no tiene recorrido.'
                : <>Arrastrá aquí la <strong>primera área</strong> del recorrido, o tocá <strong>＋ Agregar áreas</strong> para elegir varias.<br />Después soltale encima las actividades que se hacen ahí.</>}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '8px' }}>
              {rec.map((_, i) => renderParada(i))}
              {destino?.tipo === 'parada' && destino.indice === rec.length && <div style={lineaInsercion} aria-hidden />}
              {!soloLectura && (
                <div
                  onDragOver={e => { if (arrastraArea()) { e.preventDefault(); if (destino?.tipo !== 'parada' || destino.indice !== rec.length) setDestino({ tipo: 'parada', indice: rec.length }) } }}
                  onDrop={soltar}
                  style={{
                    padding: '10px', textAlign: 'center', fontSize: '12px', color: 'var(--at-ink-3)', borderRadius: '10px',
                    border: `1.5px dashed ${arrastrando === 'area' || arrastrando === 'parada' ? 'var(--at-primary)' : 'var(--at-line)'}`,
                  }}
                >
                  Soltá un área aquí para sumarla al final del recorrido
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div aria-live="polite" style={{ minHeight: '16px', marginTop: '8px', fontSize: '12px', color: 'var(--at-ink-3)' }}>{aviso}</div>

      {ventana?.tipo === 'areas' && (
        <SelectorVarios
          titulo="Agregar áreas al recorrido"
          subtitulo="Marcá las que hagan falta: entran al final, en el orden en que las marques. Después se ordenan con ↑ ↓."
          opciones={areasActivas.map(a => ({ id: a.id, icono: a.icono, titulo: a.nombre, yaEsta: tieneArea(rec, a.id) }))}
          buscar="Buscar área"
          textoYaEsta="En el recorrido"
          vacio="No hay áreas activas. Se crean en el tab Áreas."
          textoAgregar={n => (n === 0 ? 'Agregar' : `Agregar ${n} área${n !== 1 ? 's' : ''}`)}
          onAgregar={agregarAreas}
          onCerrar={() => setVentana(null)}
        />
      )}
      {ventana?.tipo === 'actividades' && (() => {
        const destinoVentana = rec.find(p => p.area_id === ventana.areaId)
        if (!destinoVentana) return null
        const ya = new Set(destinoVentana.actividades.map(a => a.plantilla_tarea_id))
        return (
          <SelectorVarios
            titulo={`Actividades en «${nombreArea(ventana.areaId)}»`}
            subtitulo="Marcá las que se hacen en esta área: entran al final, en el orden en que las marques. Después se ordenan con ↑ ↓."
            opciones={actividadesActivas.map(p => ({
              id: p.id, icono: p.icono || '✅', titulo: p.titulo, grupo: p.servicio ?? undefined,
              detalle: detalleActividad(p), yaEsta: ya.has(p.id),
            }))}
            grupos={{
              etiqueta: 'Servicio', todos: 'Todos los servicios', inicial: servicio,
              valores: (Object.keys(SERVICIO_LABEL) as ServicioOperativo[]).map(s => ({ id: s, texto: SERVICIO_LABEL[s] })),
            }}
            buscar="Buscar actividad"
            textoYaEsta="Ya está aquí"
            vacio="El catálogo de actividades está vacío (se administra en Plantillas)."
            resumen={ids => {
              const t = tiempoRecorrido([{ area_id: ventana.areaId, actividades: ids.map(id => ({ plantilla_tarea_id: id, obligatoria: true })) }], porPlantilla)
              return <>Suman <strong>{formatearMinutos(t.minutos)}</strong>{t.sinDato > 0 && <span style={{ color: 'var(--at-warning-strong)' }}> · ⚠ {t.sinDato} sin duración</span>}</>
            }}
            textoAgregar={n => (n === 0 ? 'Agregar' : `Agregar ${n} actividad${n !== 1 ? 'es' : ''}`)}
            onAgregar={ids => agregarActividades(ventana.areaId, ids)}
            onCerrar={() => setVentana(null)}
          />
        )
      })()}

    </EditModal>
  )
}

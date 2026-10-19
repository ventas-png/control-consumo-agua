// Calendario de limpieza (20261103000000): cada empleado con sus turnos del mes
// —los que ya existen en «Asignación turnos»— y, sobre cada día de turno, las
// rutinas que le tocan.
//
// CÓMO SE ASIGNA. Se arrastra una rutina de la paleta y se suelta sobre el día,
// o se toca ＋ en el día para marcar varias de una vez. Arrastrar una rutina ya
// puesta la MUEVE a otro día (o a otra persona). Tocarla muestra cómo va y deja
// quitarla mientras nada suyo se haya trabajado.
//
// LA ASIGNACIÓN ES LA TAREA. Asignar crea en ese turno las tareas del recorrido
// (limpieza_asignar_rutinas); no hay que «generar» después. Por eso no hay
// borrador: cada gesto se guarda al instante y el calendario se recarga.
//
// SOLO DÍAS CON TURNO. Un día sin turno se ve apagado: los turnos se generan en
// «Asignación turnos», y un turno con tareas allá ya no se re-planifica —quitar
// sus rutinas lo libera—.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { confirm, notify } from '../../../shared/Dialog'
import { fetchCalendarioLimpieza, fetchRutinasLimpieza } from '../../../../domain/condominios/tabQueries'
import { asignarRutinasTurno, quitarRutinaTurno } from '../../../../domain/condominios/tabMutations'
import {
  avisoAsignacion, cargaDelTurno, duracionPorRutina, motivoNoProgramable, porEmpleado,
  rutinaQuitable, turnoProgramable, type DuracionRutina,
} from '../../../../domain/condominios/calendarioLimpieza'
import { formatearMinutos } from '../../../../domain/condominios/rutinasRecorrido'
import { etiquetaCargo } from '../../../../domain/condominios/rrhhCatalogos'
import { DIAS_SEMANA_CORTOS, MESES, fechaISO, gridMes, moverMes, rangoMes } from '../../../../lib/calendario'
import { hoyLocalISO } from '../../../../lib/format'
import { SelectorVarios } from './SelectorVarios'
import type {
  CargoCatalogo, PlantillaTareaCargo, RutinaEnTurno, RutinaLimpieza, TurnoCalendarioLimpieza,
} from '../../../../types'

interface Props {
  proyectoId: string
  companyId: string
  plantillas: PlantillaTareaCargo[]
  cargos?: CargoCatalogo[]
  canEdit: boolean
  /** Algo se asignó o se quitó: el tab recarga sus indicadores. */
  onCambio?: () => void
}

/** Lo que se está arrastrando: una rutina de la paleta, o una ya puesta en un turno. */
type Arrastre =
  | { tipo: 'nueva'; rutinaId: string }
  | { tipo: 'puesta'; rutinaId: string; bloqueId: string }

/** Por debajo de este ancho la grilla de 7 columnas no deja leer nada: lista de días. */
const ANCHO_GRILLA = 620

const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** «lun 21 oct» a partir de una fecha ISO local (mediodía: el cambio de horario no mueve el día). */
function etiquetaDia(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const dia = new Date(y, m - 1, d, 12).getDay()
  return `${DIAS_LARGOS[dia].slice(0, 3)} ${d} ${MESES[m - 1].slice(0, 3).toLowerCase()}`
}

const botonMini: CSSProperties = {
  padding: '1px 7px', background: 'var(--at-primary-soft)', border: '1px solid var(--at-primary)',
  borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 800, color: 'var(--at-primary)', lineHeight: 1.5,
}
const inputStyle: CSSProperties = {
  padding: '7px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px',
  background: 'var(--at-surface-2)', minWidth: 0,
}

export function VistaCalendario({ proyectoId, companyId, plantillas, cargos = [], canEdit, onCambio }: Props) {
  const hoy = hoyLocalISO()
  const [cursor, setCursor] = useState(() => {
    const [y, m] = hoy.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const [turnos, setTurnos] = useState<TurnoCalendarioLimpieza[]>([])
  const [rutinas, setRutinas] = useState<RutinaLimpieza[]>([])
  const [duraciones, setDuraciones] = useState<Map<string, DuracionRutina>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [cargo, setCargo] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [ventana, setVentana] = useState<TurnoCalendarioLimpieza | null>(null)
  const [aviso, setAviso] = useState('')
  /** En la lista (pantallas angostas), los días ya pasados del mes van plegados. */
  const [verPasados, setVerPasados] = useState(false)

  const arrastre = useRef<Arrastre | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)

  // Grilla o lista según el ancho que de verdad le queda a la vista.
  const contRef = useRef<HTMLDivElement>(null)
  const [grilla, setGrilla] = useState(true)
  useEffect(() => {
    const el = contRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => setGrilla(el.clientWidth >= ANCHO_GRILLA)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { desde, hasta } = rangoMes(cursor.year, cursor.month)

  const cargarMes = useCallback(async () => {
    const r = await fetchCalendarioLimpieza(proyectoId, desde, hasta)
    if (r.error) { setError(r.error.message); return }
    setError(null)
    setTurnos(r.turnos)
  }, [proyectoId, desde, hasta])

  useEffect(() => {
    let vigente = true
    setCargando(true)
    void fetchCalendarioLimpieza(proyectoId, desde, hasta).then(r => {
      if (!vigente) return
      setCargando(false)
      if (r.error) { setError(r.error.message); return }
      setError(null)
      setTurnos(r.turnos)
    })
    return () => { vigente = false }
  }, [proyectoId, desde, hasta])

  useEffect(() => {
    let vigente = true
    void fetchRutinasLimpieza(proyectoId, companyId).then(r => {
      if (!vigente || r.error) return
      setRutinas(r.rutinas)
      setDuraciones(duracionPorRutina(r.rutinas, r.pasos, r.paradas, plantillas))
    })
    return () => { vigente = false }
  }, [proyectoId, companyId, plantillas])

  const activas = useMemo(
    () => rutinas.filter(r => r.activa).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)),
    [rutinas],
  )
  const nombreRutina = useCallback(
    (id: string) => rutinas.find(r => r.id === id)?.nombre ?? '(rutina eliminada)',
    [rutinas],
  )

  const empleados = useMemo(() => porEmpleado(turnos), [turnos])
  const cargosPresentes = useMemo(
    () => [...new Set(empleados.map(e => e.cargo).filter((c): c is string => !!c))].sort(),
    [empleados],
  )
  const q = busqueda.trim().toLowerCase()
  const visibles = empleados.filter(e =>
    (!q || e.nombre.toLowerCase().includes(q)) && (!cargo || e.cargo === cargo))

  const turnoPorBloque = useMemo(() => new Map(turnos.map(t => [t.bloque_id, t])), [turnos])

  // ── Gestos (cada uno se guarda al instante) ─────────────────────────────────

  async function asignar(t: TurnoCalendarioLimpieza, ids: string[]): Promise<boolean> {
    setOcupado(t.bloque_id)
    const { data, error: err } = await asignarRutinasTurno(t.bloque_id, ids)
    setOcupado(null)
    if (err) {
      notify({ variant: 'error', title: 'No se pudo asignar', text: err.message })
      return false
    }
    const destino = `${t.personal_nombre} el ${etiquetaDia(t.fecha)}`
    setAviso(data ? avisoAsignacion(data, destino) : `Asignado a ${destino}.`)
    await cargarMes()
    onCambio?.()
    return true
  }

  async function quitar(t: TurnoCalendarioLimpieza, rutinaId: string, silencioso = false): Promise<boolean> {
    setOcupado(t.bloque_id)
    const { error: err } = await quitarRutinaTurno(t.bloque_id, rutinaId)
    setOcupado(null)
    if (err) {
      notify({ variant: 'error', title: 'No se pudo quitar', text: err.message })
      return false
    }
    if (!silencioso) {
      setAviso(`«${nombreRutina(rutinaId)}» quitada de ${t.personal_nombre} el ${etiquetaDia(t.fecha)}.`)
      await cargarMes()
      onCambio?.()
    }
    return true
  }

  /** Mover = asignar en el destino y DESPUÉS quitar del origen: si lo segundo falla, queda en los dos y se ve. */
  async function mover(origen: TurnoCalendarioLimpieza, destino: TurnoCalendarioLimpieza, rutinaId: string) {
    if (origen.bloque_id === destino.bloque_id) return
    if (destino.rutinas.some(r => r.rutina_id === rutinaId)) {
      setAviso(`«${nombreRutina(rutinaId)}» ya está en ${destino.personal_nombre} el ${etiquetaDia(destino.fecha)}.`)
      return
    }
    if (!(await asignar(destino, [rutinaId]))) return
    if (await quitar(origen, rutinaId, true)) {
      setAviso(`«${nombreRutina(rutinaId)}» movida a ${destino.personal_nombre} el ${etiquetaDia(destino.fecha)}.`)
    }
    await cargarMes()
    onCambio?.()
  }

  async function verRutina(t: TurnoCalendarioLimpieza, r: RutinaEnTurno) {
    const nombre = nombreRutina(r.rutina_id)
    const estado = `${r.tareas} tarea${r.tareas !== 1 ? 's' : ''} · ${r.hechas} hecha${r.hechas !== 1 ? 's' : ''} · ${r.pendientes} pendiente${r.pendientes !== 1 ? 's' : ''}`
    const lugar = `${t.personal_nombre}, ${etiquetaDia(t.fecha)}`
    if (!canEdit || !rutinaQuitable(t, r, hoy)) {
      const porque = !canEdit ? '' : motivoNoProgramable(t, hoy)
        ?? 'Ya tiene tareas trabajadas: no se quita. Una tarea que no corresponde se anula con motivo desde Revisión.'
      notify({ variant: 'info', title: `«${nombre}» · ${lugar}`, text: `${estado}.${porque ? ` ${porque}` : ''}` })
      return
    }
    const res = await confirm({
      title: `¿Quitar «${nombre}»?`,
      text: `${lugar}. ${estado}. Se borran sus tareas de ese turno; ninguna se ha trabajado todavía.`,
      icon: 'warning', variant: 'danger', confirmText: 'Quitar del día',
    })
    if (res.isConfirmed) await quitar(t, r.rutina_id)
  }

  // ── Arrastre ────────────────────────────────────────────────────────────────

  function empezar(e: DragEvent<HTMLElement>, a: Arrastre, texto: string) {
    e.stopPropagation()
    arrastre.current = a
    // Firefox no arranca un arrastre sin datos.
    e.dataTransfer?.setData('text/plain', texto)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = a.tipo === 'nueva' ? 'copy' : 'move'
  }
  function terminar() {
    arrastre.current = null
    setSobre(null)
  }
  function encima(e: DragEvent<HTMLElement>, t: TurnoCalendarioLimpieza) {
    if (!arrastre.current || !canEdit || !turnoProgramable(t, hoy)) return
    e.preventDefault()
    if (sobre !== t.bloque_id) setSobre(t.bloque_id)
  }
  function soltar(e: DragEvent<HTMLElement>, t: TurnoCalendarioLimpieza) {
    e.preventDefault()
    const a = arrastre.current
    terminar()
    if (!a || !canEdit || !turnoProgramable(t, hoy)) return
    if (a.tipo === 'nueva') {
      if (t.rutinas.some(r => r.rutina_id === a.rutinaId)) {
        setAviso(`«${nombreRutina(a.rutinaId)}» ya está en ${t.personal_nombre} el ${etiquetaDia(t.fecha)}.`)
        return
      }
      void asignar(t, [a.rutinaId])
      return
    }
    const origen = turnoPorBloque.get(a.bloqueId)
    if (origen) void mover(origen, t, a.rutinaId)
  }

  // ── Piezas ──────────────────────────────────────────────────────────────────

  function chip(t: TurnoCalendarioLimpieza, r: RutinaEnTurno) {
    const nombre = nombreRutina(r.rutina_id)
    const quitable = canEdit && rutinaQuitable(t, r, hoy)
    const hecha = r.tareas > 0 && r.hechas === r.tareas
    return (
      <button
        key={r.rutina_id}
        type="button"
        draggable={quitable}
        onDragStart={e => empezar(e, { tipo: 'puesta', rutinaId: r.rutina_id, bloqueId: t.bloque_id }, nombre)}
        onDragEnd={terminar}
        onClick={() => void verRutina(t, r)}
        aria-label={`${nombre}, ${t.personal_nombre} el ${etiquetaDia(t.fecha)}: ${r.hechas} de ${r.tareas} hechas`}
        title={`${nombre} · ${r.hechas}/${r.tareas} hechas`}
        style={{
          display: 'flex', alignItems: 'center', gap: '3px', width: '100%', minWidth: 0,
          padding: '2px 5px', marginTop: '3px', borderRadius: '6px', cursor: quitable ? 'grab' : 'pointer',
          fontSize: '11px', fontWeight: 600, textAlign: 'left',
          border: `1px solid ${hecha ? 'var(--at-success-border)' : 'var(--at-primary-soft-2, var(--at-line))'}`,
          background: hecha ? 'var(--at-success-tint)' : 'var(--at-primary-soft)',
          color: hecha ? 'var(--at-success)' : 'var(--at-primary)',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</span>
        {(r.hechas > 0 || r.trabajadas > 0) && (
          <span style={{ flexShrink: 0, fontSize: '10px', opacity: 0.85 }}>{hecha ? '✓' : `${r.hechas}/${r.tareas}`}</span>
        )}
      </button>
    )
  }

  /** Un turno dentro de una celda (o de una fila de la lista). */
  function turnoEnDia(t: TurnoCalendarioLimpieza) {
    const programable = canEdit && turnoProgramable(t, hoy)
    const carga = cargaDelTurno(t, duraciones)
    const resaltado = sobre === t.bloque_id
    return (
      <div
        key={t.bloque_id}
        role="group"
        aria-label={`Turno de ${t.personal_nombre} el ${etiquetaDia(t.fecha)}${t.jornada_nombre ? ` (${t.jornada_nombre})` : ''}`}
        onDragOver={e => encima(e, t)}
        onDragLeave={() => { if (sobre === t.bloque_id) setSobre(null) }}
        onDrop={e => soltar(e, t)}
        style={{
          borderRadius: '7px', padding: '3px', minWidth: 0,
          outline: resaltado ? '2px solid var(--at-primary)' : 'none',
          background: resaltado ? 'var(--at-primary-soft)' : 'transparent',
          opacity: ocupado === t.bloque_id ? 0.55 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
          <span
            title={t.jornada_nombre ? `${t.jornada_nombre}${t.hora_inicio ? ` · ${t.hora_inicio.slice(0, 5)}–${(t.hora_fin ?? '').slice(0, 5)}` : ''}` : 'Turno sin jornada'}
            style={{
              fontSize: '10px', fontWeight: 800, padding: '0 5px', borderRadius: '5px', whiteSpace: 'nowrap',
              background: t.jornada_color ?? 'var(--at-chip)', color: t.jornada_color ? 'white' : 'var(--at-ink-2)',
            }}
          >{t.jornada_codigo ?? t.jornada_nombre?.slice(0, 3) ?? 'T'}</span>
          {carga.minutos > 0 && (
            <span
              style={{ fontSize: '10px', color: carga.excede ? 'var(--at-warning-strong)' : 'var(--at-ink-3)', fontWeight: carga.excede ? 800 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={carga.capacidad ? `Asignado ${formatearMinutos(carga.minutos)} de ${formatearMinutos(carga.capacidad)} del turno` : `Asignado ${formatearMinutos(carga.minutos)}`}
            >{carga.excede ? '⚠ ' : ''}{formatearMinutos(carga.minutos)}</span>
          )}
          <span style={{ flex: 1 }} />
          {programable && (
            <button
              type="button"
              onClick={() => setVentana(t)}
              disabled={ocupado === t.bloque_id || activas.length === 0}
              aria-label={`Agregar rutinas a ${t.personal_nombre} el ${etiquetaDia(t.fecha)}`}
              title="Agregar rutinas a este día"
              style={botonMini}
            >＋</button>
          )}
        </div>
        {t.rutinas.map(r => chip(t, r))}
        {t.otras_tareas > 0 && (
          <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginTop: '2px' }} title="Tareas sueltas de «Tareas por turno»: no salen de ninguna rutina">
            +{t.otras_tareas} suelta{t.otras_tareas !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    )
  }

  function renderGrilla(emp: ReturnType<typeof porEmpleado>[number]) {
    const celdas = gridMes(cursor.year, cursor.month)
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
        {DIAS_SEMANA_CORTOS.map(d => (
          <div key={d} style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--at-ink-3)', textAlign: 'center' }}>{d}</div>
        ))}
        {celdas.map((dia, i) => {
          if (dia === null) return <div key={`v${i}`} />
          const fecha = fechaISO(cursor.year, cursor.month, dia)
          const delDia = emp.turnos.get(fecha) ?? []
          const esHoy = fecha === hoy
          return (
            <div
              key={fecha}
              style={{
                minHeight: '62px', minWidth: 0, padding: '3px', borderRadius: '8px',
                border: `1.5px solid ${esHoy ? 'var(--at-primary)' : 'var(--at-line)'}`,
                background: delDia.length > 0 ? 'var(--at-surface)' : 'var(--at-surface-2)',
                opacity: delDia.length > 0 ? 1 : 0.55,
              }}
              title={delDia.length > 0 ? undefined : 'Sin turno: se genera en «Asignación turnos»'}
            >
              <div style={{ fontSize: '10.5px', fontWeight: esHoy ? 800 : 600, color: esHoy ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>{dia}</div>
              {delDia.map(t => turnoEnDia(t))}
            </div>
          )
        })}
      </div>
    )
  }

  function renderLista(emp: ReturnType<typeof porEmpleado>[number]) {
    const todas = [...emp.turnos.keys()].sort()
    // Lo pasado ya no se programa: en el teléfono la lista arranca en hoy y lo
    // anterior se despliega a pedido, para no recorrer el mes entero cada vez.
    const pasadas = todas.filter(f => f < hoy).length
    const fechas = verPasados ? todas : todas.filter(f => f >= hoy)
    return (
      <div style={{ display: 'grid', gap: '6px' }}>
        {pasadas > 0 && (
          <button
            type="button"
            onClick={() => setVerPasados(v => !v)}
            style={{ ...botonMini, justifySelf: 'start', padding: '3px 10px', fontWeight: 700, background: 'var(--at-surface-2)', borderColor: 'var(--at-line)', color: 'var(--at-ink-2)' }}
          >{verPasados ? 'Ocultar días anteriores' : `Ver ${pasadas} día${pasadas !== 1 ? 's' : ''} anterior${pasadas !== 1 ? 'es' : ''}`}</button>
        )}
        {fechas.length === 0 && (
          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>No le quedan turnos este mes.</div>
        )}
        {fechas.map(fecha => (
          <div key={fecha} style={{
            display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '6px 8px', borderRadius: '8px',
            border: `1.5px solid ${fecha === hoy ? 'var(--at-primary)' : 'var(--at-line)'}`, background: 'var(--at-surface)',
          }}>
            <div style={{ width: '64px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: fecha === hoy ? 'var(--at-primary)' : 'var(--at-ink-2)' }}>
              {etiquetaDia(fecha)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>{(emp.turnos.get(fecha) ?? []).map(t => turnoEnDia(t))}</div>
          </div>
        ))}
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const mesTexto = `${MESES[cursor.month]} ${cursor.year}`
  const ventanaRutinas = ventana ? new Set(ventana.rutinas.map(r => r.rutina_id)) : new Set<string>()

  return (
    <div ref={contRef}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--at-ink)' }}>Calendario de rutinas</h3>
          <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
            Cada empleado con sus turnos del mes. {canEdit
              ? 'Arrastrá una rutina a un día con turno, o tocá ＋ en el día para elegir varias.'
              : 'Sólo lectura.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button type="button" onClick={() => setCursor(c => moverMes(c.year, c.month, -1))} aria-label="Mes anterior" style={{ ...botonMini, padding: '4px 10px', background: 'var(--at-surface)', borderColor: 'var(--at-line)', color: 'var(--at-ink-2)' }}>‹</button>
          <span style={{ minWidth: '128px', textAlign: 'center', fontSize: '14px', fontWeight: 800, color: 'var(--at-ink)' }}>{mesTexto}</span>
          <button type="button" onClick={() => setCursor(c => moverMes(c.year, c.month, 1))} aria-label="Mes siguiente" style={{ ...botonMini, padding: '4px 10px', background: 'var(--at-surface)', borderColor: 'var(--at-line)', color: 'var(--at-ink-2)' }}>›</button>
          {mesTexto !== `${MESES[Number(hoy.slice(5, 7)) - 1]} ${hoy.slice(0, 4)}` && (
            <button type="button" onClick={() => { const [y, m] = hoy.split('-').map(Number); setCursor({ year: y, month: m - 1 }) }} style={{ ...botonMini, padding: '4px 10px', fontWeight: 700 }}>Hoy</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <input
          type="search"
          aria-label="Buscar empleado"
          placeholder="Buscar empleado…"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 180px' }}
        />
        {cargosPresentes.length > 1 && (
          <select aria-label="Cargo" value={cargo} onChange={e => setCargo(e.target.value)} style={{ ...inputStyle, flex: '0 1 200px' }}>
            <option value="">Todos los cargos</option>
            {cargosPresentes.map(c => <option key={c} value={c}>{etiquetaCargo(c, cargos)}</option>)}
          </select>
        )}
      </div>

      {canEdit && (
        <div
          aria-label="Rutinas para asignar"
          role="list"
          style={{
            display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', marginBottom: '12px',
            background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px',
            // Pegada arriba mientras se recorre el mes: soltar una rutina sobre el
            // tercer empleado no puede exigir arrastrarla por todo el scroll. Sólo
            // en la grilla; en la lista (pantallas angostas) se asigna con ＋.
            position: grilla ? 'sticky' : 'static', top: 0, zIndex: 2,
            boxShadow: grilla ? '0 4px 10px -8px rgba(0,0,0,0.35)' : 'none',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', marginRight: '2px' }}>Rutinas:</span>
          {activas.length === 0 && (
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>No hay rutinas activas. Se arman en la vista «Rutinas».</span>
          )}
          {activas.map(r => {
            const d = duraciones.get(r.id)
            return (
              <span
                key={r.id}
                role="listitem"
                draggable
                onDragStart={e => empezar(e, { tipo: 'nueva', rutinaId: r.id }, r.nombre)}
                onDragEnd={terminar}
                title={d ? `${d.paradas} área${d.paradas !== 1 ? 's' : ''} · ${formatearMinutos(d.minutos)}${d.sinDato ? ` · ${d.sinDato} sin duración` : ''}` : r.nombre}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 9px', borderRadius: '999px',
                  border: '1px solid var(--at-primary)', background: 'var(--at-primary-soft)', color: 'var(--at-primary)',
                  fontSize: '12px', fontWeight: 700, cursor: 'grab', userSelect: 'none',
                }}
              >
                🧭 {r.nombre}
                {d && d.minutos > 0 && <span style={{ fontWeight: 500, opacity: 0.8 }}>· {formatearMinutos(d.minutos)}</span>}
              </span>
            )
          })}
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontSize: '13px', marginBottom: '10px' }}>
          No se pudo cargar el calendario: {error}
        </div>
      )}

      {cargando ? (
        <div style={{ padding: '28px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando {mesTexto}…</div>
      ) : empleados.length === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', borderRadius: '12px', background: 'var(--at-surface)', border: '2px dashed var(--at-line)', color: 'var(--at-ink-3)', fontSize: '13px' }}>
          <div style={{ fontSize: '26px', marginBottom: '6px' }}>🗓️</div>
          No hay turnos en {mesTexto}. Los turnos de cada empleado se generan en <strong>Asignación turnos</strong>; después aparecen aquí para asignarles rutinas.
        </div>
      ) : visibles.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>Nadie coincide con el filtro.</div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {visibles.map(emp => (
            <section
              key={emp.personal_id}
              aria-label={`Calendario de ${emp.nombre}`}
              style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '10px 12px' }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--at-ink)' }}>{emp.nombre}</span>
                {emp.cargo && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{etiquetaCargo(emp.cargo, cargos)}</span>}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: '12px', color: emp.conRutina < emp.total ? 'var(--at-warning-strong)' : 'var(--at-ink-3)' }}>
                  {emp.conRutina} de {emp.total} turno{emp.total !== 1 ? 's' : ''} con rutina
                </span>
              </div>
              {grilla ? renderGrilla(emp) : renderLista(emp)}
            </section>
          ))}
        </div>
      )}

      <div aria-live="polite" style={{ minHeight: '16px', marginTop: '8px', fontSize: '12px', color: 'var(--at-ink-3)' }}>{aviso}</div>

      {ventana && (
        <SelectorVarios
          titulo={`Rutinas para ${ventana.personal_nombre}`}
          subtitulo={`${etiquetaDia(ventana.fecha)}${ventana.jornada_nombre ? ` · ${ventana.jornada_nombre}` : ''}. Entran al turno en el orden en que las marques.`}
          opciones={activas.map(r => {
            const d = duraciones.get(r.id)
            return {
              id: r.id, icono: '🧭', titulo: r.nombre,
              detalle: d ? `${d.paradas} área${d.paradas !== 1 ? 's' : ''} · ⏱ ${formatearMinutos(d.minutos)}${d.sinDato ? ` · ⚠ ${d.sinDato} sin duración` : ''}` : undefined,
              yaEsta: ventanaRutinas.has(r.id),
            }
          })}
          buscar="Buscar rutina"
          textoYaEsta="Ya asignada"
          vacio="No hay rutinas activas. Se arman en la vista «Rutinas»."
          resumen={ids => {
            const marcadas = ids.reduce((s, id) => s + (duraciones.get(id)?.minutos ?? 0), 0)
            const carga = cargaDelTurno(ventana, duraciones)
            const total = carga.minutos + marcadas
            const excede = carga.capacidad != null && total > carga.capacidad
            return (
              <span style={{ color: excede ? 'var(--at-warning-strong)' : undefined }}>
                Suman <strong>{formatearMinutos(marcadas)}</strong>
                {carga.capacidad != null && <> · el día quedaría en {formatearMinutos(total)} de {formatearMinutos(carga.capacidad)}{excede ? ' ⚠' : ''}</>}
              </span>
            )
          }}
          textoAgregar={n => (n === 0 ? 'Asignar' : `Asignar ${n} rutina${n !== 1 ? 's' : ''}`)}
          onAgregar={ids => { const t = ventana; setVentana(null); void asignar(t, ids) }}
          onCerrar={() => setVentana(null)}
        />
      )}
    </div>
  )
}

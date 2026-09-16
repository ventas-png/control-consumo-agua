import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  createCondominioRow,
  createCondominioRowReturning,
  deleteCondominioRow,
  generarBloquesTurno,
  updateCondominioRow,
} from '../../../domain/condominios/tabMutations'
import {
  DIAS_DEL_MES,
  DIAS_ISO,
  FRECUENCIAS,
  FRECUENCIAS_POR_DIA_SEMANA,
  FRECUENCIAS_POR_DIAS_MES,
  FRECUENCIAS_POR_MES,
  asignables,
  celdaDe,
  celdaEditable,
  describirRegla,
  formatHoras,
  horasDeCelda,
  horasJornada,
  motivoNoEditable,
  type CeldaTurno,
} from '../../../domain/condominios/turnos'
import { fetchBloquesTurnoRango } from '../../../domain/condominios/sectionData'
import {
  fetchCuposDePlantillas, guardarJornadaConCupos, minutosCupoQueDescuentan, tramosDemora,
} from '../../../domain/condominios/politicaJornada'
import { fetchTiposPausa } from '../../../domain/condominios/pausasPresencia'
import { DIAS_SEMANA_CORTOS, MESES, fechaISO, gridMes, moverMes, rangoMes } from '../../../lib/calendario'
import { hoyLocalISO } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal, EmptyState } from '../../shared'
import { TabStrip } from '../../shared/TabStrip'
import type {
  AsignacionTurno,
  AusenciaPersonal,
  BloqueTurno,
  DiaNoLaborable,
  ExcepcionTurno,
  FrecuenciaTurno,
  CupoPausa,
  PersonalCondominio,
  PlantillaHorario,
  TipoPausa,
  TurnoTipo,
} from '../../../types'

interface Props {
  plantillas: PlantillaHorario[]
  asignaciones: AsignacionTurno[]
  bloques: BloqueTurno[]
  ausencias: AusenciaPersonal[]
  diasNoLaborables: DiaNoLaborable[]
  excepciones: ExcepcionTurno[]
  personal: PersonalCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type Vista = 'calendario' | 'reglas' | 'jornadas'

const TURNOS: { value: TurnoTipo; label: string }[] = [
  { value: 'manana', label: 'Mañana' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'noche', label: 'Noche' },
]

const COLORES = ['var(--at-primary)', 'var(--at-accent)', 'var(--at-success)', 'var(--at-warning)', 'var(--at-info)']

const inp: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--at-surface)', color: 'var(--at-ink)',
}
const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
const card: CSSProperties = {
  background: 'var(--at-surface)', border: '1px solid var(--at-line)',
  borderRadius: 10, padding: 14,
}

const formJornadaVacio = {
  nombre: '', codigo: '', turno: 'manana' as TurnoTipo,
  hora_inicio: '06:00', hora_fin: '14:00', minutos_descanso: '0',
  tolerancia_entrada_min: '10', color: COLORES[0], notas: '',
  // ── La vara (20260913040300). Declarada, todavía sin efectos.
  tolerancia_salida_min: '0',
  // 0 = no hay tramo compensable: la demora pasa directo a débito al salir de
  // la tolerancia. El número lo pone quien decide la política, no este default.
  demora_compensable_hasta_min: '0',
  extra_requiere_autorizacion: true,
}

const formReglaVacio = {
  personal_id: '', plantilla_horario_id: '', nombre: '',
  frecuencia: 'semanal' as FrecuenciaTurno,
  dias_semana: [1, 2, 3, 4, 5] as number[],
  dias_mes: [] as number[],
  intervalo_dias: '1', dia_mes: '1', mes_ancla: '',
  fechas_especificas: '',
  fecha_inicio: hoyLocalISO(), fecha_fin: '',
  cubre_dias_no_laborables: false, notas: '',
}

/** Qué día del calendario se está editando. */
interface DiaEnEdicion { fecha: string; personalId: string }

/**
 * Asignación de turnos: el calendario de quién cubre qué días y con qué horario.
 *
 * Tres vistas, en el orden en que se usan al revés de como se configuran:
 *   · Calendario  quién trabaja cada día del mes (lo que se consulta a diario)
 *   · Reglas      la periodicidad que genera esos días
 *   · Jornadas    el catálogo de horarios que las reglas reutilizan
 *
 * El calendario NO depende de que los turnos estén materializados: pinta lo que
 * hay en `bloques_turno` y, donde no hay nada, lo que las reglas predicen (ver
 * `celdaDe` en domain/condominios/turnos.ts). Por eso se puede abrir un mes del
 * año que viene sin haber generado nada.
 */
export default function TurnosTab({
  plantillas, asignaciones, bloques, ausencias, diasNoLaborables, excepciones, personal,
  proyectoId, companyId, canCreate, canEdit, onRefresh,
}: Props) {
  const hoy = hoyLocalISO()
  const [vista, setVista] = useState<Vista>('calendario')
  const [cursor, setCursor] = useState(() => {
    const [y, m] = hoy.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const [saving, setSaving] = useState(false)
  const [modalJornada, setModalJornada] = useState<PlantillaHorario | 'nueva' | null>(null)
  const [modalRegla, setModalRegla] = useState<AsignacionTurno | 'nueva' | null>(null)
  const [modalDia, setModalDia] = useState<DiaEnEdicion | null>(null)
  const [formJornada, setFormJornada] = useState(formJornadaVacio)
  const [formRegla, setFormRegla] = useState(formReglaVacio)
  const [jornadaDia, setJornadaDia] = useState('')
  // El catálogo de tipos de pausa de la EMPRESA (presencia_tipos_pausa) decide
  // QUÉ tipos existen; la jornada decide CUÁNTO da de cada uno. Si el catálogo
  // no carga, la sección de cupos simplemente no aparece: no puede impedir
  // configurar el horario, que es lo principal de esta pantalla.
  const [tiposPausa, setTiposPausa] = useState<TipoPausa[]>([])
  const [cupos, setCupos] = useState<CupoPausa[]>([])
  const [formCupos, setFormCupos] = useState<Record<string, string>>({})
  // POR QUÉ ESTO ES UN ESTADO Y NO UN ARREGLO VACÍO. `guardarJornadaConCupos`
  // manda el juego COMPLETO de cupos y la RPC reemplaza el que había. Mientras
  // `cupos` arrancaba en `[]` y el error de lectura se ignoraba, abrir una
  // jornada con la consulta todavía en vuelo —o fallada— pintaba el formulario
  // sin cupos, y pulsar «Guardar» los borraba todos. Una lectura que falla no
  // puede significar «esta jornada no da descanso»: significa que no sabemos
  // qué da, y sobre eso no se escribe.
  const [cuposEstado, setCuposEstado] = useState<'cargando' | 'listo' | 'error'>('cargando')

  useEffect(() => {
    let vivo = true
    void fetchTiposPausa().then(({ tipos }) => { if (vivo) setTiposPausa(tipos) })
    return () => { vivo = false }
  }, [])

  // LA ÚLTIMA PREGUNTA MANDA. Esta consulta se dispara al montar, al cambiar la
  // lista de jornadas y después de cada guardado, así que es normal que haya
  // dos en vuelo. Sin este contador, la que contestara ÚLTIMA ganaba, que no es
  // lo mismo: una respuesta vieja podía pisar a una nueva.
  //
  // Y acá eso no es un parpadeo cosmético. `cuposEstado` es lo que autoriza a
  // editar y guardar, y guardar manda el juego COMPLETO de cupos. Una respuesta
  // vieja llegando tarde podía (a) reemplazar los cupos recién leídos por los
  // de antes, (b) poner `listo` mientras la consulta buena seguía en vuelo y
  // desbloquear el guardado con datos que ya no valen —y ese guardado BORRA los
  // cupos reales—, o (c) marcar `error` por un fallo ya superado y bloquear la
  // edición sin motivo. El contador descarta las tres.
  const generacionCupos = useRef(0)
  const idsPlantilla = useMemo(() => plantillas.map(p => p.id).join(','), [plantillas])
  const recargarCupos = useCallback(() => {
    // Se incrementa ANTES de pedir nada: cualquier respuesta en vuelo queda
    // vieja desde este mismo instante, incluso en el camino corto de abajo.
    const generacion = ++generacionCupos.current
    const ids = idsPlantilla ? idsPlantilla.split(',') : []
    if (ids.length === 0) { setCupos([]); setCuposEstado('listo'); return }
    setCuposEstado('cargando')
    void fetchCuposDePlantillas(ids)
      .then(({ cupos: c, error }) => {
        if (generacion !== generacionCupos.current) return
        if (error) { setCuposEstado('error'); return }
        setCupos(c)
        setCuposEstado('listo')
      })
      // Un rechazo —la red se cayó, el cliente lanzó— no puede quedar sin
      // manejar: dejaría `cuposEstado` en 'cargando' para siempre, que se lee
      // como «esperá» y nunca deja de esperar. Es un error de lectura y se dice.
      .catch(() => {
        if (generacion !== generacionCupos.current) return
        setCuposEstado('error')
      })
  }, [idsPlantilla])
  useEffect(() => { recargarCupos() }, [recargarCupos])

  const cuposDe = useCallback(
    (plantillaId: string) => cupos.filter(c => c.plantilla_horario_id === plantillaId),
    [cupos],
  )

  const empleados = useMemo(() => asignables(personal), [personal])
  const rango = useMemo(() => rangoMes(cursor.year, cursor.month), [cursor])
  const celdas = useMemo(() => gridMes(cursor.year, cursor.month), [cursor])

  // ── Los bloques DEL MES QUE SE ESTÁ MIRANDO ───────────────────────────────
  // El prop `bloques` trae los 200 de fecha más reciente del PROYECTO ENTERO:
  // le alcanza a la bandeja de «Tareas por turno», que mira hoy, y se queda
  // cortísimo acá, donde veinte empleados por treinta días son seiscientas
  // filas y el mes puede ser cualquiera. Con el tope, generar un mes completo
  // dejaba media grilla pintada como «previsto (sin generar)» para siempre:
  // los bloques existían, pero no entraban en la consulta.
  //
  // Así que el calendario pide SU rango. Mientras esa consulta está en vuelo
  // —o si falló— se sigue pintando con el prop, incompleto pero mejor que una
  // grilla en blanco, y el aviso de arriba dice que puede estarlo.
  const [bloquesMes, setBloquesMes] = useState<BloqueTurno[] | null>(null)
  const [estadoMes, setEstadoMes] = useState<'cargando' | 'listo' | 'error'>('cargando')
  // Mismo contador que en los cupos: al pasar meses rápido quedan varias
  // consultas en vuelo y la que conteste ÚLTIMA no es necesariamente la del
  // mes que se está viendo.
  const generacionMes = useRef(0)

  const recargarMes = useCallback(() => {
    const generacion = ++generacionMes.current
    setEstadoMes('cargando')
    void fetchBloquesTurnoRango(proyectoId, companyId, rango.desde, rango.hasta)
      .then(({ data, error }) => {
        if (generacion !== generacionMes.current) return
        if (error) { setBloquesMes(null); setEstadoMes('error'); return }
        setBloquesMes((data ?? []) as unknown as BloqueTurno[])
        setEstadoMes('listo')
      })
      .catch(() => {
        if (generacion !== generacionMes.current) return
        setBloquesMes(null); setEstadoMes('error')
      })
  }, [proyectoId, companyId, rango.desde, rango.hasta])
  useEffect(() => { recargarMes() }, [recargarMes])

  /**
   * Recarga el mes Y avisa al contenedor.
   *
   * Las dos cosas, siempre: el contenedor refresca reglas, ausencias y
   * excepciones; el mes refresca los bloques, que son los únicos que esta
   * pantalla consulta por su cuenta. Quedarse con una sola deja media
   * pantalla mostrando el estado anterior.
   */
  const refrescar = useCallback(() => { recargarMes(); onRefresh() }, [recargarMes, onRefresh])

  const bloquesVisibles = bloquesMes ?? bloques

  const fuentes = useMemo(
    () => ({
      bloques: bloquesVisibles, reglas: asignaciones, plantillas,
      ausencias, noLaborables: diasNoLaborables, excepciones,
    }),
    [bloquesVisibles, asignaciones, plantillas, ausencias, diasNoLaborables, excepciones],
  )

  /** Estado de cada empleado en cada día del mes visible. */
  const mes = useMemo(() => {
    const out: Record<string, ReturnType<typeof celdaDe>[]> = {}
    for (const emp of empleados) {
      out[emp.id] = celdas
        .filter((d): d is number => d !== null)
        .map(d => celdaDe(fechaISO(cursor.year, cursor.month, d), emp.id, fuentes))
    }
    return out
  }, [empleados, celdas, cursor, fuentes])

  const resumen = useMemo(() => {
    const todas = Object.values(mes).flat()
    return {
      turnos: todas.filter(c => c.bloque || c.regla).length,
      horas: todas.reduce((acc, c) => acc + (horasDeCelda(c) ?? 0), 0),
      conflictos: todas.filter(c => c.enConflicto).length,
      sinGenerar: todas.filter(c => c.regla && !c.bloque && !c.ausencia).length,
    }
  }, [mes])

  const plantillaPorId = useMemo(
    () => Object.fromEntries(plantillas.map(p => [p.id, p])) as Record<string, PlantillaHorario>,
    [plantillas],
  )

  // ── Jornadas ──────────────────────────────────────────────────────────────

  function abrirJornada(p: PlantillaHorario | 'nueva') {
    // Una jornada NUEVA no tiene cupos que perder, así que se puede crear
    // aunque la consulta esté en vuelo. Editar una que ya existe, no.
    if (p !== 'nueva' && cuposEstado !== 'listo') {
      notify(cuposEstado === 'cargando'
        ? { variant: 'info', title: 'Un momento', text: 'Todavía se están cargando los descansos de esta jornada' }
        : { variant: 'error', title: 'No se pudieron leer los descansos',
            text: 'Editar la jornada ahora borraría los cupos que ya tiene. Recargá la página e intentá de nuevo.' })
      return
    }
    setFormJornada(p === 'nueva' ? formJornadaVacio : {
      nombre: p.nombre, codigo: p.codigo ?? '', turno: p.turno,
      hora_inicio: p.hora_inicio.slice(0, 5), hora_fin: p.hora_fin.slice(0, 5),
      minutos_descanso: String(p.minutos_descanso),
      tolerancia_entrada_min: String(p.tolerancia_entrada_min),
      color: p.color ?? COLORES[0], notas: p.notas ?? '',
      tolerancia_salida_min: String(p.tolerancia_salida_min ?? 0),
      demora_compensable_hasta_min: String(p.demora_compensable_hasta_min ?? 0),
      extra_requiere_autorizacion: p.extra_requiere_autorizacion ?? true,
    })
    setFormCupos(p === 'nueva'
      ? {}
      : Object.fromEntries(cuposDe(p.id).map(c => [c.tipo, String(c.minutos)])))
    setModalJornada(p)
  }

  async function guardarJornada() {
    // Segundo cerrojo, por si el estado cambió con el formulario ya abierto:
    // guardar reemplaza el juego entero de cupos, y hacerlo sin saber cuál era
    // el juego anterior es borrarlo.
    if (modalJornada !== 'nueva' && cuposEstado !== 'listo') {
      notify({ variant: 'error', title: 'No se puede guardar',
               text: 'No se pudieron leer los descansos de esta jornada; guardar ahora los borraría.' })
      return
    }
    if (!formJornada.nombre.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'La jornada necesita un nombre' }); return
    }
    const horas = horasJornada(
      formJornada.hora_inicio, formJornada.hora_fin, false, Number(formJornada.minutos_descanso) || 0,
    )
    if (!horas) {
      notify({ variant: 'warning', title: 'Horario inválido', text: 'La jornada quedaría en cero horas' }); return
    }
    setSaving(true)
    // `cruza_medianoche` se deriva del horario, no se pregunta: si la salida es
    // anterior o igual a la entrada, el turno termina al día siguiente y no hay
    // otra lectura posible. `horas_jornada` la sella la BD.
    const payload = {
      nombre: formJornada.nombre.trim(),
      codigo: formJornada.codigo.trim() || null,
      turno: formJornada.turno,
      hora_inicio: formJornada.hora_inicio,
      hora_fin: formJornada.hora_fin,
      cruza_medianoche: formJornada.hora_fin <= formJornada.hora_inicio,
      minutos_descanso: Number(formJornada.minutos_descanso) || 0,
      tolerancia_entrada_min: Number(formJornada.tolerancia_entrada_min) || 0,
      tolerancia_salida_min: Number(formJornada.tolerancia_salida_min) || 0,
      demora_compensable_hasta_min: Number(formJornada.demora_compensable_hasta_min) || 0,
      extra_requiere_autorizacion: formJornada.extra_requiere_autorizacion,
      color: formJornada.color,
      notas: formJornada.notas.trim() || null,
    }
    // UNA llamada, UNA transacción. La jornada y sus cupos se guardan juntos o
    // no se guarda nada: antes eran tres viajes y un fallo en el tercero dejaba
    // la jornada SIN cupos, que la fase 2 lee como «este descanso no se juzga».
    const creada = modalJornada === 'nueva'
    const { error } = await guardarJornadaConCupos({
      companyId,
      projectId: proyectoId,
      plantillaId: creada ? null : (modalJornada as PlantillaHorario).id,
      datos: payload,
      cupos: Object.fromEntries(
        Object.entries(formCupos).map(([tipo, v]) => [tipo, v === '' ? null : Number(v)]),
      ),
    })
    if (error) {
      setSaving(false)
      notify({ variant: 'error', title: 'Error', text: error }); return
    }
    setSaving(false)
    setModalJornada(null)
    recargarCupos()
    onRefresh()
  }

  async function alternarJornada(p: PlantillaHorario) {
    const { error } = await updateCondominioRow('plantillas_horario', p.id, { activo: !p.activo })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  // ── Reglas ────────────────────────────────────────────────────────────────

  function abrirRegla(r: AsignacionTurno | 'nueva') {
    setFormRegla(r === 'nueva'
      ? { ...formReglaVacio, plantilla_horario_id: plantillas.find(p => p.activo)?.id ?? '' }
      : {
        personal_id: r.personal_id, plantilla_horario_id: r.plantilla_horario_id,
        nombre: r.nombre ?? '', frecuencia: r.frecuencia,
        dias_semana: r.dias_semana ?? [],
        dias_mes: r.dias_mes ?? [],
        intervalo_dias: String(r.intervalo_dias ?? 1),
        dia_mes: String(r.dia_mes ?? 1),
        mes_ancla: r.mes_ancla ? String(r.mes_ancla) : '',
        fechas_especificas: (r.fechas_especificas ?? []).join(', '),
        fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin ?? '',
        cubre_dias_no_laborables: r.cubre_dias_no_laborables, notas: r.notas ?? '',
      })
    setModalRegla(r)
  }

  async function guardarRegla() {
    if (!formRegla.personal_id || !formRegla.plantilla_horario_id) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Elegí el empleado y la jornada' }); return
    }
    if (FRECUENCIAS_POR_DIA_SEMANA.includes(formRegla.frecuencia) && formRegla.dias_semana.length === 0) {
      notify({
        variant: 'warning', title: 'Sin días',
        text: 'Sin días marcados la regla cubre la semana entera. Marcá al menos uno o cambiá a Diaria.',
      })
      return
    }
    if (FRECUENCIAS_POR_DIAS_MES.includes(formRegla.frecuencia) && formRegla.dias_mes.length === 0) {
      notify({
        variant: 'warning', title: 'Sin días',
        text: 'Marcá al menos un día del mes, o elegí «Mensual» si es un día fijo.',
      })
      return
    }
    const fechas = formRegla.fechas_especificas
      .split(',').map(f => f.trim()).filter(Boolean)
    if (formRegla.frecuencia === 'fechas' && fechas.length === 0) {
      notify({ variant: 'warning', title: 'Sin fechas', text: 'Listá al menos una fecha (AAAA-MM-DD)' }); return
    }
    setSaving(true)
    const payload = {
      personal_id: formRegla.personal_id,
      plantilla_horario_id: formRegla.plantilla_horario_id,
      nombre: formRegla.nombre.trim() || null,
      frecuencia: formRegla.frecuencia,
      dias_semana: FRECUENCIAS_POR_DIA_SEMANA.includes(formRegla.frecuencia) ? formRegla.dias_semana : [],
      // Se manda vacío cuando la frecuencia no lo usa: una lista huérfana de
      // una frecuencia anterior volvería a mandar si alguien la cambia de nuevo.
      dias_mes: FRECUENCIAS_POR_DIAS_MES.includes(formRegla.frecuencia)
        ? formRegla.dias_mes.slice().sort((a, b) => a - b)
        : [],
      intervalo_dias: formRegla.frecuencia === 'diaria' ? Number(formRegla.intervalo_dias) || 1 : null,
      dia_mes: FRECUENCIAS_POR_MES.includes(formRegla.frecuencia) ? Number(formRegla.dia_mes) || 1 : null,
      mes_ancla: FRECUENCIAS_POR_MES.includes(formRegla.frecuencia) && formRegla.mes_ancla
        ? Number(formRegla.mes_ancla) : null,
      fechas_especificas: formRegla.frecuencia === 'fechas' ? fechas : [],
      fecha_inicio: formRegla.fecha_inicio,
      fecha_fin: formRegla.fecha_fin || null,
      cubre_dias_no_laborables: formRegla.cubre_dias_no_laborables,
      notas: formRegla.notas.trim() || null,
    }
    const { error } = modalRegla === 'nueva'
      ? await createCondominioRow('asignaciones_turno', { company_id: companyId, project_id: proyectoId, ...payload })
      : await updateCondominioRow('asignaciones_turno', (modalRegla as AsignacionTurno).id, payload)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setModalRegla(null)
    onRefresh()
  }

  async function alternarRegla(r: AsignacionTurno) {
    const { error } = await updateCondominioRow('asignaciones_turno', r.id, { activa: !r.activa })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function borrarRegla(r: AsignacionTurno) {
    const { isConfirmed } = await confirm({
      title: 'Eliminar la regla',
      text: 'Los turnos ya generados NO se borran: quedan como estaban y se pueden ajustar uno a uno.',
      variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    const { error } = await deleteCondominioRow('asignaciones_turno', r.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  // ── Generación ────────────────────────────────────────────────────────────

  async function generar() {
    const etiqueta = `${MESES[cursor.month]} ${cursor.year}`
    const { isConfirmed } = await confirm({
      title: `Generar los turnos de ${etiqueta}`,
      text: 'Se crean los días que faltan según las reglas activas. No se duplica lo ya generado, no se toca lo que pusiste a mano y se saltan ausencias aprobadas y días no laborables.',
      confirmText: 'Generar',
    })
    if (!isConfirmed) return
    setSaving(true)
    const { data, error } = await generarBloquesTurno(proyectoId, rango.desde, rango.hasta)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo generar', text: error.message }); return }
    const omitidos = (data?.omitidos_ausencia ?? 0) + (data?.omitidos_no_laborable ?? 0) + (data?.omitidos_existente ?? 0)
    notify({
      variant: 'success',
      title: `${data?.generados ?? 0} turnos generados`,
      text: omitidos > 0
        ? `Se omitieron ${omitidos}: ${data?.omitidos_existente ?? 0} ya existían, ${data?.omitidos_ausencia ?? 0} por ausencia, ${data?.omitidos_no_laborable ?? 0} por día no laborable.`
        : `${etiqueta} quedó completo.`,
    })
    refrescar()
  }

  // ── Un día suelto ─────────────────────────────────────────────────────────
  //
  // El calendario no es de solo lectura: un turno futuro se puede cambiar de
  // jornada o quitar, que es lo que pasa cuando alguien pide un día o se cubre
  // un cambio. Lo que NO se toca es el pasado ni lo ya empezado (ver
  // `celdaEditable`), y la palabra final la tiene la base, no esta pantalla.

  const celdaAbierta = useMemo(
    () => (modalDia ? celdaDe(modalDia.fecha, modalDia.personalId, fuentes) : null),
    [modalDia, fuentes],
  )

  function abrirDia(celda: CeldaTurno, personalId: string) {
    // El motivo se dice en vez de dejar la casilla muda: «no pasa nada al
    // hacer clic» se lee como que la pantalla está rota.
    const motivo = motivoNoEditable(celda, hoy)
    if (motivo) { notify({ variant: 'info', title: 'Ese día no se edita', text: motivo }); return }
    setJornadaDia(
      celda.bloque?.plantilla_horario_id
      ?? celda.plantilla?.id
      ?? plantillas.find(p => p.activo)?.id
      ?? '',
    )
    setModalDia({ fecha: celda.fecha, personalId })
  }

  async function guardarDia() {
    if (!modalDia || !celdaAbierta) return
    const plantilla = plantillas.find(p => p.id === jornadaDia)
    if (!plantilla) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Elegí la jornada de este día' }); return
    }
    setSaving(true)
    // `horas_planificadas` y `politica` NO se mandan: las sellan sus triggers
    // (trg_turnos_sellar_horas, trg_turnos_sellar_politica). Mandarlas desde el
    // cliente sería inventar contra qué se va a medir el turno.
    const horario = {
      plantilla_horario_id: plantilla.id,
      turno: plantilla.turno,
      hora_inicio: plantilla.hora_inicio,
      hora_fin: plantilla.hora_fin,
      cruza_medianoche: plantilla.cruza_medianoche,
    }
    const { error } = celdaAbierta.bloque
      ? await updateCondominioRow('bloques_turno', celdaAbierta.bloque.id, horario)
      : await createCondominioRow('bloques_turno', {
        company_id: companyId,
        project_id: proyectoId,
        personal_id: modalDia.personalId,
        fecha: modalDia.fecha,
        asignacion_id: celdaAbierta.regla?.id ?? null,
        origen: 'manual',
        estado: 'pendiente',
        ...horario,
      })
    if (error) {
      setSaving(false)
      notify({ variant: 'error', title: 'No se pudo guardar el día', text: error.message }); return
    }
    // Asignar un día que estaba quitado lo deshace: dejar la excepción encima
    // de un bloque real sería decir «este día no va» mientras el día va.
    if (celdaAbierta.excepcion) {
      await deleteCondominioRow('excepciones_turno', celdaAbierta.excepcion.id)
    }
    setSaving(false)
    setModalDia(null)
    refrescar()
  }

  async function quitarDia() {
    if (!modalDia || !celdaAbierta) return
    const { isConfirmed } = await confirm({
      title: 'Quitar el turno de ese día',
      text: 'Esa persona deja de tener turno ese día y el generador no lo vuelve a crear. La regla sigue igual para el resto del mes, y el día se puede restaurar después.',
      variant: 'danger', confirmText: 'Quitar',
    })
    if (!isConfirmed) return
    setSaving(true)
    // ORDEN A PROPÓSITO: primero la excepción, después el bloque.
    //
    // Borrar el bloque sin dejar la excepción no quita nada: el siguiente
    // «Generar» lo vuelve a crear, porque el generador solo agrega y no tiene
    // cómo saber que ese día se quitó a mano. Y si se hiciera al revés y
    // fallara la excepción, el día habría desaparecido para volver solo.
    //
    // Al derecho, en cambio, un fallo al borrar el bloque —la base rechaza los
    // empezados, cerrados o con checklist, sea quien sea el que borre— deshace
    // la excepción y el día queda exactamente como estaba.
    let excepcionCreada: string | null = null
    if (!celdaAbierta.excepcion) {
      const { data, error } = await createCondominioRowReturning('excepciones_turno', {
        company_id: companyId,
        project_id: proyectoId,
        personal_id: modalDia.personalId,
        fecha: modalDia.fecha,
        // Informativa: deja dicho qué regla cubría el día cuando se quitó.
        asignacion_id: celdaAbierta.regla?.id ?? null,
        motivo: 'Quitado desde el calendario',
      }, 'id')
      if (error) {
        setSaving(false)
        notify({ variant: 'error', title: 'No se pudo quitar el día', text: error.message }); return
      }
      excepcionCreada = (data?.id as string | undefined) ?? null
    }
    if (celdaAbierta.bloque) {
      const { error } = await deleteCondominioRow('bloques_turno', celdaAbierta.bloque.id)
      if (error) {
        if (excepcionCreada) await deleteCondominioRow('excepciones_turno', excepcionCreada)
        setSaving(false)
        // El mensaje de la base se muestra tal cual porque dice CUÁL de las
        // condiciones falló (ya empezó, tiene tareas, la fecha ya pasó…), que
        // es justo lo que hay que saber para decidir qué hacer.
        notify({ variant: 'error', title: 'No se pudo quitar el turno', text: error.message }); return
      }
    }
    setSaving(false)
    setModalDia(null)
    refrescar()
  }

  async function restaurarDia() {
    if (!modalDia || !celdaAbierta?.excepcion) return
    setSaving(true)
    const { error } = await deleteCondominioRow('excepciones_turno', celdaAbierta.excepcion.id)
    setSaving(false)
    if (error) {
      notify({ variant: 'error', title: 'No se pudo restaurar', text: error.message }); return
    }
    setModalDia(null)
    refrescar()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const sinJornadas = plantillas.length === 0

  return (
    <div style={{ padding: 16 }}>
      <TabStrip
        items={[
          { id: 'calendario', label: 'Calendario', icon: '🗓️' },
          { id: 'reglas', label: `Reglas (${asignaciones.length})`, icon: '🔁' },
          { id: 'jornadas', label: `Jornadas (${plantillas.length})`, icon: '⏰' },
        ]}
        value={vista}
        onChange={setVista}
        ariaLabel="Vistas de asignación de turnos"
        marginBottom={16}
      />

      {/* ── Calendario ── */}
      {vista === 'calendario' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setCursor(c => moverMes(c.year, c.month, -1))}
                aria-label="Mes anterior"
                style={{ padding: '6px 12px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}
              >‹</button>
              <div style={{ fontWeight: 700, fontSize: 15, minWidth: 160, textAlign: 'center', color: 'var(--at-ink)' }}>
                {MESES[cursor.month]} {cursor.year}
              </div>
              <button
                onClick={() => setCursor(c => moverMes(c.year, c.month, 1))}
                aria-label="Mes siguiente"
                style={{ padding: '6px 12px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}
              >›</button>
            </div>
            {canCreate && !sinJornadas && (
              <button
                onClick={generar}
                disabled={saving}
                style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {saving ? 'Generando…' : `⚡ Generar ${MESES[cursor.month]}`}
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Turnos del mes', val: String(resumen.turnos), color: 'var(--at-primary)' },
              { label: 'Horas programadas', val: formatHoras(resumen.horas), color: 'var(--at-accent)' },
              { label: 'Sin generar', val: String(resumen.sinGenerar), color: resumen.sinGenerar ? 'var(--at-warning)' : 'var(--at-ink-3)' },
              { label: 'En conflicto', val: String(resumen.conflictos), color: resumen.conflictos ? 'var(--at-danger)' : 'var(--at-ink-3)' },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '10px 12px', textAlign: 'center', border: '1px solid var(--at-line)' }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: k.color }}>{k.val}</div>
                <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Que la consulta del mes esté en vuelo o haya fallado NO puede ser
              silencioso: mientras tanto se pinta con el recorte que llegó por
              props, y un turno que existe puede verse como «previsto». */}
          {estadoMes === 'cargando' && (
            <div role="status" style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 10 }}>
              Cargando los turnos de {MESES[cursor.month]}…
            </div>
          )}
          {estadoMes === 'error' && (
            <div
              role="alert"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10,
                background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)',
                borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--at-danger)',
              }}
            >
              <span>No se pudieron leer los turnos de {MESES[cursor.month]}. Lo de abajo puede estar incompleto.</span>
              <button
                onClick={recargarMes}
                style={{ padding: '4px 10px', background: 'var(--at-surface)', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}
              >Reintentar</button>
            </div>
          )}

          {sinJornadas ? (
            <EmptyState
              icon="⏰"
              title="Todavía no hay jornadas definidas"
              description="Una jornada es un horario con nombre («Nocturno 22:00–06:00»). Se define una vez y todas las reglas de asignación la reutilizan."
            />
          ) : empleados.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No hay personal activo en este condominio"
              description="Registrá al personal en la pestaña Personal para poder asignarle turnos."
            />
          ) : (
            <div className="table-scroll-wrapper">
              <div className="turnos-grid">
                {/* Encabezado de días. Vive en la MISMA estructura que las filas
                    —columna de nombre + cuadrícula de siete— porque es lo único
                    que garantiza que Lun…Dom caigan sobre sus días. */}
                <div className="turnos-fila" style={{ marginBottom: 3 }}>
                  <div className="turnos-nombre" style={{ background: 'transparent' }} />
                  <div className="turnos-dias">
                    {DIAS_SEMANA_CORTOS.map(d => (
                      <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', padding: '4px 0' }}>{d}</div>
                    ))}
                  </div>
                </div>

                {empleados.map(emp => {
                  const porFecha = Object.fromEntries((mes[emp.id] ?? []).map(c => [c.fecha, c]))
                  const horasEmp = (mes[emp.id] ?? []).reduce((a, c) => a + (horasDeCelda(c) ?? 0), 0)
                  return (
                    <div key={emp.id} className="turnos-fila" style={{ marginBottom: 10 }}>
                      <div className="turnos-nombre" style={{ padding: '6px 8px' }}>
                        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--at-ink)' }}>{emp.nombre}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>{emp.cargo} · {formatHoras(horasEmp)}</div>
                      </div>
                      <div className="turnos-dias">
                        {celdas.map((dia, i) => {
                          if (dia === null) {
                            return <div key={i} className="turnos-dia" style={{ visibility: 'hidden' }} />
                          }
                          const fecha = fechaISO(cursor.year, cursor.month, dia)
                          const c = porFecha[fecha]
                          const esHoy = fecha === hoy
                          const plantilla = c?.plantilla
                          const hayTurno = Boolean(c?.bloque || c?.regla)
                          // Quitado a mano: la regla lo predecía y alguien dijo
                          // que no. Se marca, en vez de dejarlo vacío, para que
                          // se distinga de un día que la regla nunca cubrió.
                          const quitado = Boolean(c?.excepcion && !c?.bloque)

                          let fondo = 'var(--at-surface)'
                          let borde = 'var(--at-line)'
                          let texto = 'var(--at-ink-3)'
                          if (c?.ausencia) {
                            fondo = 'var(--at-warning-tint)'; borde = 'var(--at-warning-border)'; texto = 'var(--at-warning)'
                          } else if (c?.enConflicto) {
                            fondo = 'var(--at-danger-tint)'; borde = 'var(--at-danger)'; texto = 'var(--at-danger)'
                          } else if (hayTurno) {
                            fondo = plantilla?.color ?? 'var(--at-primary)'
                            borde = 'transparent'; texto = 'var(--at-on-status)'
                          } else if (quitado) {
                            borde = 'var(--at-danger-border)'; texto = 'var(--at-danger)'
                          } else if (c?.noLaborable) {
                            fondo = 'var(--at-chip)'; borde = 'var(--at-line)'
                          }

                          const etiqueta = c?.ausencia
                            ? '🌴'
                            : hayTurno
                              ? (plantilla?.codigo || plantilla?.nombre?.[0] || '•')
                              : quitado ? '—' : c?.noLaborable ? '★' : ''

                          const editable = canEdit && Boolean(c) && celdaEditable(c, hoy)

                          const titulo = [
                            `${fecha} · ${emp.nombre}`,
                            c?.ausencia && `Ausencia: ${c.ausencia.tipo.replace(/_/g, ' ')}`,
                            c?.noLaborable && `No laborable: ${c.noLaborable.nombre}`,
                            hayTurno && plantilla && `${plantilla.nombre} ${plantilla.hora_inicio.slice(0, 5)}–${plantilla.hora_fin.slice(0, 5)}`,
                            hayTurno && !c?.bloque && 'Previsto por la regla (sin generar)',
                            quitado && 'Quitado a mano: el generador no lo vuelve a crear',
                            c?.enConflicto && 'En conflicto: el turno está programado pero no se puede cubrir',
                            canEdit && c && !editable && motivoNoEditable(c, hoy),
                          ].filter(Boolean).join('\n')

                          const caja: CSSProperties = {
                            background: fondo,
                            border: `1px solid ${borde}`,
                            // `inset` y no `outline`: el outline se reserva para
                            // el foco del teclado, que sobre el color de una
                            // jornada cualquiera es lo único que se ve.
                            boxShadow: esHoy ? 'inset 0 0 0 2px var(--at-accent)' : undefined,
                            // Lo previsto por la regla pero aún no materializado
                            // se distingue de lo real: si no, "generar" parece
                            // que no hace nada.
                            opacity: hayTurno && !c?.bloque ? 0.55 : 1,
                          }

                          const contenido = (
                            <>
                              <span style={{ fontSize: 9, color: texto, lineHeight: 1 }}>{dia}</span>
                              {etiqueta && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: texto, lineHeight: 1.2 }}>{etiqueta}</span>
                              )}
                            </>
                          )

                          // Botón sólo cuando de verdad se puede editar: un
                          // botón que no hace nada es peor que un día quieto.
                          return editable ? (
                            <button
                              key={i}
                              type="button"
                              className="turnos-dia"
                              style={caja}
                              title={titulo}
                              aria-label={titulo.replace(/\n/g, '. ')}
                              onClick={() => abrirDia(c, emp.id)}
                            >{contenido}</button>
                          ) : (
                            <div key={i} className="turnos-dia" style={caja} title={titulo}>{contenido}</div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 11, color: 'var(--at-ink-3)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-primary)', borderRadius: 3, marginRight: 4 }} />Turno generado</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-primary)', opacity: 0.55, borderRadius: 3, marginRight: 4 }} />Previsto (sin generar)</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 3, marginRight: 4 }} />Ausencia</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger)', borderRadius: 3, marginRight: 4 }} />En conflicto</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-surface)', border: '1px solid var(--at-danger-border)', borderRadius: 3, marginRight: 4 }} />— Quitado a mano</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 3, marginRight: 4 }} />★ No laborable</span>
          </div>

          {canEdit && (
            <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 6 }}>
              Tocá un día de hoy en adelante para cambiarle la jornada o quitarlo. Los días que ya
              pasaron, y los turnos que ya arrancaron o se cerraron, se corrigen desde Presencia.
            </div>
          )}
        </>
      )}

      {/* ── Reglas ── */}
      {vista === 'reglas' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, color: 'var(--at-ink-3)' }}>
              La regla define cada cuánto le toca a alguien. Los días concretos se crean al generar.
            </div>
            {canCreate && (
              <button
                onClick={() => abrirRegla('nueva')}
                disabled={sinJornadas}
                title={sinJornadas ? 'Definí primero una jornada' : undefined}
                style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: sinJornadas ? 'not-allowed' : 'pointer', fontSize: 13, opacity: sinJornadas ? 0.5 : 1 }}
              >+ Nueva regla</button>
            )}
          </div>

          {asignaciones.length === 0 ? (
            <EmptyState
              icon="🔁"
              title="Sin reglas de asignación"
              description="Una regla dice «a Pérez le toca el nocturno de lunes a viernes, de septiembre a diciembre». A partir de ahí el calendario se llena solo."
            />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {asignaciones.map(r => {
                const plantilla = plantillaPorId[r.plantilla_horario_id]
                return (
                  <div key={r.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: r.activa ? 1 : 0.6 }}>
                    <div style={{ minWidth: 220, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--at-ink)' }}>
                        {r.nombre || `${r.personal_nombre ?? 'Empleado'} · ${plantilla?.nombre ?? 'jornada'}`}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>
                        👤 {r.personal_nombre ?? '—'}
                        {plantilla && ` · ⏰ ${plantilla.hora_inicio.slice(0, 5)}–${plantilla.hora_fin.slice(0, 5)}`}
                        {' · '}🔁 {describirRegla(r)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                        Desde {r.fecha_inicio}{r.fecha_fin ? ` hasta ${r.fecha_fin}` : ' (sin fin)'}
                        {r.cubre_dias_no_laborables && ' · cubre festivos'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: r.activa ? 'var(--at-success-tint)' : 'var(--at-chip)', color: r.activa ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                        {r.activa ? 'Activa' : 'Pausada'}
                      </span>
                      {canEdit && (
                        <>
                          <button onClick={() => alternarRegla(r)} style={{ padding: '5px 10px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink)' }}>
                            {r.activa ? 'Pausar' : 'Activar'}
                          </button>
                          <button onClick={() => abrirRegla(r)} style={{ padding: '5px 10px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink)' }}>
                            Editar
                          </button>
                          <button onClick={() => borrarRegla(r)} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Jornadas ── */}
      {vista === 'jornadas' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, color: 'var(--at-ink-3)' }}>
              El horario con nombre que reutilizan todas las reglas.
            </div>
            {canCreate && (
              <button onClick={() => abrirJornada('nueva')} style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                + Nueva jornada
              </button>
            )}
          </div>

          {plantillas.length === 0 ? (
            <EmptyState
              icon="⏰"
              title="Sin jornadas definidas"
              description="Empezá por las que ya usa el condominio: diurna, nocturna, fin de semana. Cada una lleva su hora de entrada, de salida y su descanso."
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
              {plantillas.map(p => (
                <div key={p.id} style={{ ...card, borderLeft: `4px solid ${p.color ?? 'var(--at-primary)'}`, opacity: p.activo ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--at-ink)' }}>
                        {p.codigo && <span style={{ marginRight: 6, padding: '1px 6px', background: 'var(--at-chip)', borderRadius: 4, fontSize: 11 }}>{p.codigo}</span>}
                        {p.nombre}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginTop: 4 }}>
                        {p.hora_inicio.slice(0, 5)} – {p.hora_fin.slice(0, 5)}
                        {p.cruza_medianoche && <span style={{ color: 'var(--at-ink-3)' }}> (+1 día)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                        {formatHoras(p.horas_jornada)} efectivas
                        {p.minutos_descanso > 0 && ` · ${p.minutos_descanso} min de descanso`}
                      </div>
                    </div>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10.5, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>
                      {TURNOS.find(t => t.value === p.turno)?.label}
                    </span>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <button onClick={() => abrirJornada(p)} style={{ padding: '4px 10px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink)' }}>Editar</button>
                      <button onClick={() => alternarJornada(p)} style={{ padding: '4px 10px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink)' }}>
                        {p.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Modal de jornada ── */}
      {modalJornada && (
        <EditModal
          title={modalJornada === 'nueva' ? 'Nueva jornada' : 'Editar jornada'}
          subtitle="El horario con nombre que reutilizan las reglas de asignación"
          onClose={() => setModalJornada(null)}
          size="sm"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalJornada(null)} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}>Cancelar</button>
              <button onClick={guardarJornada} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl} htmlFor="jornada-nombre">Nombre *</label>
                <input id="jornada-nombre" style={inp} placeholder="Nocturno de garita" value={formJornada.nombre}
                  onChange={e => setFormJornada(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="jornada-codigo">Código</label>
                <input id="jornada-codigo" style={inp} placeholder="N" maxLength={4} value={formJornada.codigo}
                  onChange={e => setFormJornada(p => ({ ...p, codigo: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl} htmlFor="jornada-inicio">Entrada</label>
                <input id="jornada-inicio" type="time" style={inp} value={formJornada.hora_inicio}
                  onChange={e => setFormJornada(p => ({ ...p, hora_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="jornada-fin">Salida</label>
                <input id="jornada-fin" type="time" style={inp} value={formJornada.hora_fin}
                  onChange={e => setFormJornada(p => ({ ...p, hora_fin: e.target.value }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="jornada-descanso">Descanso (min)</label>
                <input id="jornada-descanso" type="number" min={0} style={inp} value={formJornada.minutos_descanso}
                  onChange={e => setFormJornada(p => ({ ...p, minutos_descanso: e.target.value }))} />
              </div>
            </div>
            <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--at-ink-2)' }}>
              Jornada efectiva:{' '}
              <strong>{formatHoras(horasJornada(formJornada.hora_inicio, formJornada.hora_fin, false, Number(formJornada.minutos_descanso) || 0))}</strong>
              {formJornada.hora_fin <= formJornada.hora_inicio && ' · termina al día siguiente'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl} htmlFor="jornada-turno">Turno</label>
                <select id="jornada-turno" style={inp} value={formJornada.turno}
                  onChange={e => setFormJornada(p => ({ ...p, turno: e.target.value as TurnoTipo }))}>
                  {TURNOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl} htmlFor="jornada-tolerancia">Tolerancia de entrada (min)</label>
                <input id="jornada-tolerancia" type="number" min={0} style={inp} value={formJornada.tolerancia_entrada_min}
                  onChange={e => setFormJornada(p => ({ ...p, tolerancia_entrada_min: e.target.value }))} />
              </div>
            </div>

            {/* ══ LA VARA DE ESTA JORNADA ═════════════════════════════════════
                Qué se espera, más allá de las horas. Se DECLARA aquí y todavía
                no tiene efectos: medir contra ella y aplicarla son pasos
                siguientes, a propósito — antes de que un número cambie lo que
                se paga hay que poder mirar un mes real de comparaciones. */}
            <div style={{ borderTop: '1px solid var(--at-line)', paddingTop: 12, marginTop: 2 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Lo que esta jornada espera</div>
              <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginBottom: 10, lineHeight: 1.5 }}>
                Se guarda con la jornada y se <strong>congela</strong> en cada día que se genere a partir de
                ahora. Cambiarlo mañana no reescribe contra qué se midió un mes ya cerrado. Todavía no
                descuenta ni acredita nada: por ahora solo queda declarado.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={lbl} htmlFor="jornada-tol-salida">Tolerancia de salida (min)</label>
                  <input id="jornada-tol-salida" type="number" min={0} style={inp}
                    value={formJornada.tolerancia_salida_min}
                    onChange={e => setFormJornada(p => ({ ...p, tolerancia_salida_min: e.target.value }))} />
                  <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 3 }}>
                    Salir antes de esto no cuenta como salida temprana.
                  </div>
                </div>
                <div>
                  <label style={lbl} htmlFor="jornada-compensable">Demora compensable hasta (min)</label>
                  <input id="jornada-compensable" type="number" min={0} style={inp}
                    value={formJornada.demora_compensable_hasta_min}
                    onChange={e => setFormJornada(p => ({ ...p, demora_compensable_hasta_min: e.target.value }))} />
                  <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 3 }}>
                    0 = la demora pasa directo a débito.
                  </div>
                </div>
              </div>

              {/* La política, en la frase que va a regir. Dos números sueltos hay
                  que traducirlos mentalmente cada vez; la frase no. */}
              <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '9px 12px', fontSize: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Si alguien llega tarde a esta jornada</div>
                {(() => {
                  const t = tramosDemora(
                    Number(formJornada.tolerancia_entrada_min) || 0,
                    Number(formJornada.demora_compensable_hasta_min) || 0,
                  )
                  return (
                    <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--at-ink-2)', lineHeight: 1.6 }}>
                      <li>{t.sinConsecuencia}</li>
                      {t.compensable && <li>{t.compensable}</li>}
                      <li>{t.debitada}</li>
                    </ul>
                  )
                })()}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginBottom: 10 }}>
                <input type="checkbox" checked={formJornada.extra_requiere_autorizacion}
                  onChange={e => setFormJornada(p => ({ ...p, extra_requiere_autorizacion: e.target.checked }))} />
                <span>Las horas extra necesitan autorización previa</span>
              </label>

              {tiposPausa.length > 0 && (
                <>
                  <label style={lbl}>Cupo de descanso por tipo (min)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                    {tiposPausa.map(t => (
                      <div key={t.codigo}>
                        <input
                          type="number" min={0} style={inp} placeholder="—"
                          aria-label={`Cupo de ${t.etiqueta}`}
                          value={formCupos[t.codigo] ?? ''}
                          onChange={e => setFormCupos(c => ({ ...c, [t.codigo]: e.target.value }))} />
                        <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 3 }}>
                          {t.etiqueta}{t.descuenta ? ' · descuenta' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Se SEÑALA el desacuerdo, no se arregla solo: cambiar el
                      descanso de la jornada por detrás movería las horas
                      planificadas de todos los días futuros sin que nadie lo
                      pidiera. */}
                  {(() => {
                    const suma = minutosCupoQueDescuentan(
                      Object.fromEntries(Object.entries(formCupos).map(([k, v]) => [k, v === '' ? null : Number(v)])),
                      tiposPausa,
                    )
                    const declarado = Number(formJornada.minutos_descanso) || 0
                    if (suma === declarado) return null
                    return (
                      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--at-warning)', lineHeight: 1.5 }}>
                        Los cupos que descuentan suman <strong>{suma} min</strong>, pero esta jornada resta{' '}
                        <strong>{declarado} min</strong> de sus horas planificadas. No es un error —quizá sea a
                        propósito— pero son dos respuestas distintas a la misma pregunta.
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
            <div>
              <span style={lbl}>Color en el calendario</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {COLORES.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => setFormJornada(p => ({ ...p, color: c }))}
                    style={{
                      width: 30, height: 30, borderRadius: 8, background: c, cursor: 'pointer',
                      border: formJornada.color === c ? '3px solid var(--at-ink)' : '1px solid var(--at-line)',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </EditModal>
      )}

      {/* ── Modal de regla ── */}
      {modalRegla && (
        <EditModal
          title={modalRegla === 'nueva' ? 'Nueva regla de asignación' : 'Editar regla'}
          subtitle="A quién le toca, con qué jornada y cada cuánto"
          onClose={() => setModalRegla(null)}
          size="md"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalRegla(null)} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}>Cancelar</button>
              <button onClick={guardarRegla} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl} htmlFor="regla-empleado">Empleado *</label>
                <select id="regla-empleado" style={inp} value={formRegla.personal_id}
                  onChange={e => setFormRegla(p => ({ ...p, personal_id: e.target.value }))}>
                  <option value="">Elegir…</option>
                  {empleados.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.cargo}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl} htmlFor="regla-jornada">Jornada *</label>
                <select id="regla-jornada" style={inp} value={formRegla.plantilla_horario_id}
                  onChange={e => setFormRegla(p => ({ ...p, plantilla_horario_id: e.target.value }))}>
                  <option value="">Elegir…</option>
                  {plantillas.filter(p => p.activo).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.hora_inicio.slice(0, 5)}–{p.hora_fin.slice(0, 5)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={lbl} htmlFor="regla-frecuencia">Periodicidad</label>
              <select id="regla-frecuencia" style={inp} value={formRegla.frecuencia}
                onChange={e => setFormRegla(p => ({ ...p, frecuencia: e.target.value as FrecuenciaTurno }))}>
                {FRECUENCIAS.map(f => <option key={f.value} value={f.value}>{f.label} — {f.ayuda}</option>)}
              </select>
            </div>

            {FRECUENCIAS_POR_DIA_SEMANA.includes(formRegla.frecuencia) && (
              <div>
                <span style={lbl}>Días de la semana</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DIAS_ISO.map(d => {
                    const activo = formRegla.dias_semana.includes(d.value)
                    return (
                      <button
                        key={d.value}
                        type="button"
                        aria-pressed={activo}
                        onClick={() => setFormRegla(p => ({
                          ...p,
                          dias_semana: activo
                            ? p.dias_semana.filter(x => x !== d.value)
                            : [...p.dias_semana, d.value],
                        }))}
                        style={{
                          padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          background: activo ? 'var(--at-accent)' : 'var(--at-chip)',
                          color: activo ? 'var(--at-on-status)' : 'var(--at-ink-2)',
                          border: `1px solid ${activo ? 'var(--at-accent)' : 'var(--at-line)'}`,
                        }}
                      >{d.label.slice(0, 3)}</button>
                    )
                  })}
                </div>
              </div>
            )}

            {FRECUENCIAS_POR_DIAS_MES.includes(formRegla.frecuencia) && (
              <div>
                <span style={lbl}>Días del mes</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))', gap: 5 }}>
                  {DIAS_DEL_MES.map(d => {
                    const activo = formRegla.dias_mes.includes(d)
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={activo}
                        aria-label={`Día ${d} del mes`}
                        onClick={() => setFormRegla(p => ({
                          ...p,
                          dias_mes: activo
                            ? p.dias_mes.filter(x => x !== d)
                            : [...p.dias_mes, d].sort((a, b) => a - b),
                        }))}
                        style={{
                          padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          background: activo ? 'var(--at-accent)' : 'var(--at-chip)',
                          color: activo ? 'var(--at-on-status)' : 'var(--at-ink-2)',
                          border: `1px solid ${activo ? 'var(--at-accent)' : 'var(--at-line)'}`,
                        }}
                      >{d}</button>
                    )
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 5 }}>
                  Se repiten todos los meses. Un día que el mes no tiene se corre al último real:
                  en febrero el 29, el 30 y el 31 caen todos en el 28 y producen UN turno, no tres.
                </div>
              </div>
            )}

            {formRegla.frecuencia === 'diaria' && (
              <div>
                <label style={lbl} htmlFor="regla-intervalo">Cada cuántos días</label>
                <input id="regla-intervalo" type="number" min={1} style={inp} value={formRegla.intervalo_dias}
                  onChange={e => setFormRegla(p => ({ ...p, intervalo_dias: e.target.value }))} />
              </div>
            )}

            {FRECUENCIAS_POR_MES.includes(formRegla.frecuencia) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lbl} htmlFor="regla-diames">Día del mes</label>
                  <input id="regla-diames" type="number" min={1} max={31} style={inp} value={formRegla.dia_mes}
                    onChange={e => setFormRegla(p => ({ ...p, dia_mes: e.target.value }))} />
                  <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 3 }}>
                    El 31 se ajusta al último día real de cada mes.
                  </div>
                </div>
                <div>
                  <label style={lbl} htmlFor="regla-mesancla">Mes de referencia</label>
                  <select id="regla-mesancla" style={inp} value={formRegla.mes_ancla}
                    onChange={e => setFormRegla(p => ({ ...p, mes_ancla: e.target.value }))}>
                    <option value="">El del inicio</option>
                    {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
            )}

            {formRegla.frecuencia === 'fechas' && (
              <div>
                <label style={lbl} htmlFor="regla-fechas">Fechas (AAAA-MM-DD, separadas por coma)</label>
                <input id="regla-fechas" style={inp} placeholder="2026-09-15, 2026-12-24" value={formRegla.fechas_especificas}
                  onChange={e => setFormRegla(p => ({ ...p, fechas_especificas: e.target.value }))} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl} htmlFor="regla-desde">Vigente desde *</label>
                <input id="regla-desde" type="date" style={inp} value={formRegla.fecha_inicio}
                  onChange={e => setFormRegla(p => ({ ...p, fecha_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="regla-hasta">Hasta</label>
                <input id="regla-hasta" type="date" style={inp} value={formRegla.fecha_fin}
                  onChange={e => setFormRegla(p => ({ ...p, fecha_fin: e.target.value }))} />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formRegla.cubre_dias_no_laborables}
                onChange={e => setFormRegla(p => ({ ...p, cubre_dias_no_laborables: e.target.checked }))}
              />
              Se cubre también en festivos y asuetos (garita, bombas, emergencias)
            </label>

            <div>
              <label style={lbl} htmlFor="regla-nombre">Nombre de la regla</label>
              <input id="regla-nombre" style={inp} placeholder="Opcional — si se deja vacío se arma solo" value={formRegla.nombre}
                onChange={e => setFormRegla(p => ({ ...p, nombre: e.target.value }))} />
            </div>
          </div>
        </EditModal>
      )}

      {/* ── Un día del calendario ── */}
      {modalDia && celdaAbierta && (
        <EditModal
          title={`${modalDia.fecha} · ${empleados.find(e => e.id === modalDia.personalId)?.nombre ?? 'Empleado'}`}
          subtitle="Cambiar la jornada de este día, o quitarlo"
          onClose={() => setModalDia(null)}
          size="sm"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {celdaAbierta.excepcion ? (
                  <button
                    onClick={restaurarDia}
                    disabled={saving}
                    style={{ padding: '8px 16px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}
                  >Restaurar el día</button>
                ) : (celdaAbierta.bloque || celdaAbierta.regla) && (
                  <button
                    onClick={quitarDia}
                    disabled={saving}
                    style={{ padding: '8px 16px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-danger)' }}
                  >Quitar el día</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setModalDia(null)} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}>Cancelar</button>
                <button onClick={guardarDia} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, color: 'var(--at-ink-2)' }}>
              {celdaAbierta.bloque
                ? `Turno generado · ${celdaAbierta.plantilla?.nombre ?? 'sin jornada'}`
                : celdaAbierta.excepcion
                  ? 'Día quitado a mano. El generador no lo vuelve a crear hasta que se restaure.'
                  : celdaAbierta.regla
                    ? `Previsto por «${describirRegla(celdaAbierta.regla)}», todavía sin generar.`
                    : 'Sin turno. Elegí una jornada para asignarle el día.'}
              {celdaAbierta.ausencia && (
                <div style={{ marginTop: 4, color: 'var(--at-warning)' }}>
                  Ausencia registrada: {celdaAbierta.ausencia.tipo.replace(/_/g, ' ')}
                </div>
              )}
              {celdaAbierta.noLaborable && (
                <div style={{ marginTop: 4 }}>No laborable: {celdaAbierta.noLaborable.nombre}</div>
              )}
            </div>

            <div>
              <label style={lbl} htmlFor="dia-jornada">Jornada de este día</label>
              <select id="dia-jornada" style={inp} value={jornadaDia}
                onChange={e => setJornadaDia(e.target.value)}>
                <option value="">Elegir…</option>
                {/* Se incluye la jornada actual aunque esté desactivada: si no,
                    el select arrancaría en blanco y «Guardar» la cambiaría sin
                    que nadie lo pidiera. */}
                {plantillas.filter(p => p.activo || p.id === jornadaDia).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({p.hora_inicio.slice(0, 5)}–{p.hora_fin.slice(0, 5)})
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 4 }}>
                Cambia SOLO este día. La regla que lo generó sigue igual para el resto del mes.
              </div>
            </div>
          </div>
        </EditModal>
      )}
    </div>
  )
}

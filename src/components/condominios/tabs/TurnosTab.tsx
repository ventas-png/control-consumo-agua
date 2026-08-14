import { useMemo, useState, type CSSProperties } from 'react'
import {
  createCondominioRow,
  deleteCondominioRow,
  generarBloquesTurno,
  updateCondominioRow,
} from '../../../domain/condominios/tabMutations'
import {
  DIAS_ISO,
  FRECUENCIAS,
  FRECUENCIAS_POR_DIA_SEMANA,
  FRECUENCIAS_POR_MES,
  asignables,
  celdaDe,
  describirRegla,
  formatHoras,
  horasDeCelda,
  horasJornada,
} from '../../../domain/condominios/turnos'
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
  FrecuenciaTurno,
  PersonalCondominio,
  PlantillaHorario,
  TurnoTipo,
} from '../../../types'

interface Props {
  plantillas: PlantillaHorario[]
  asignaciones: AsignacionTurno[]
  bloques: BloqueTurno[]
  ausencias: AusenciaPersonal[]
  diasNoLaborables: DiaNoLaborable[]
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
}

const formReglaVacio = {
  personal_id: '', plantilla_horario_id: '', nombre: '',
  frecuencia: 'semanal' as FrecuenciaTurno,
  dias_semana: [1, 2, 3, 4, 5] as number[],
  intervalo_dias: '1', dia_mes: '1', mes_ancla: '',
  fechas_especificas: '',
  fecha_inicio: hoyLocalISO(), fecha_fin: '',
  cubre_dias_no_laborables: false, notas: '',
}

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
  plantillas, asignaciones, bloques, ausencias, diasNoLaborables, personal,
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
  const [formJornada, setFormJornada] = useState(formJornadaVacio)
  const [formRegla, setFormRegla] = useState(formReglaVacio)

  const empleados = useMemo(() => asignables(personal), [personal])
  const rango = useMemo(() => rangoMes(cursor.year, cursor.month), [cursor])
  const celdas = useMemo(() => gridMes(cursor.year, cursor.month), [cursor])

  const fuentes = useMemo(
    () => ({ bloques, reglas: asignaciones, plantillas, ausencias, noLaborables: diasNoLaborables }),
    [bloques, asignaciones, plantillas, ausencias, diasNoLaborables],
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
    setFormJornada(p === 'nueva' ? formJornadaVacio : {
      nombre: p.nombre, codigo: p.codigo ?? '', turno: p.turno,
      hora_inicio: p.hora_inicio.slice(0, 5), hora_fin: p.hora_fin.slice(0, 5),
      minutos_descanso: String(p.minutos_descanso),
      tolerancia_entrada_min: String(p.tolerancia_entrada_min),
      color: p.color ?? COLORES[0], notas: p.notas ?? '',
    })
    setModalJornada(p)
  }

  async function guardarJornada() {
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
      color: formJornada.color,
      notas: formJornada.notas.trim() || null,
    }
    const { error } = modalJornada === 'nueva'
      ? await createCondominioRow('plantillas_horario', { company_id: companyId, project_id: proyectoId, ...payload })
      : await updateCondominioRow('plantillas_horario', (modalJornada as PlantillaHorario).id, payload)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setModalJornada(null)
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
    onRefresh()
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
            <div className="table-scroll-wrapper" style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 720 }}>
                {/* Encabezado de días */}
                <div style={{ display: 'grid', gridTemplateColumns: '150px repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
                  <div />
                  {DIAS_SEMANA_CORTOS.map(d => (
                    <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', padding: '4px 0' }}>{d}</div>
                  ))}
                </div>

                {empleados.map(emp => {
                  const porFecha = Object.fromEntries((mes[emp.id] ?? []).map(c => [c.fecha, c]))
                  const horasEmp = (mes[emp.id] ?? []).reduce((a, c) => a + (horasDeCelda(c) ?? 0), 0)
                  return (
                    <div key={emp.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '150px repeat(7, 1fr)', gap: 3 }}>
                        <div style={{ padding: '6px 8px', background: 'var(--at-surface-2)', borderRadius: 6, alignSelf: 'start' }}>
                          <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--at-ink)' }}>{emp.nombre}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>{emp.cargo} · {formatHoras(horasEmp)}</div>
                        </div>
                        {celdas.map((dia, i) => {
                          if (dia === null) {
                            return <div key={i} style={{ minHeight: 34 }} />
                          }
                          const fecha = fechaISO(cursor.year, cursor.month, dia)
                          const c = porFecha[fecha]
                          const esHoy = fecha === hoy
                          const plantilla = c?.plantilla
                          const hayTurno = Boolean(c?.bloque || c?.regla)

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
                          } else if (c?.noLaborable) {
                            fondo = 'var(--at-chip)'; borde = 'var(--at-line)'
                          }

                          const etiqueta = c?.ausencia
                            ? '🌴'
                            : hayTurno
                              ? (plantilla?.codigo || plantilla?.nombre?.[0] || '•')
                              : c?.noLaborable ? '★' : ''

                          const titulo = [
                            `${fecha} · ${emp.nombre}`,
                            c?.ausencia && `Ausencia: ${c.ausencia.tipo.replace(/_/g, ' ')}`,
                            c?.noLaborable && `No laborable: ${c.noLaborable.nombre}`,
                            hayTurno && plantilla && `${plantilla.nombre} ${plantilla.hora_inicio.slice(0, 5)}–${plantilla.hora_fin.slice(0, 5)}`,
                            hayTurno && !c?.bloque && 'Previsto por la regla (sin generar)',
                            c?.enConflicto && 'En conflicto: el turno está programado pero no se puede cubrir',
                          ].filter(Boolean).join('\n')

                          return (
                            <div
                              key={i}
                              title={titulo}
                              style={{
                                minHeight: 34, borderRadius: 6, background: fondo,
                                border: `1px solid ${borde}`,
                                outline: esHoy ? '2px solid var(--at-accent)' : undefined,
                                display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center',
                                // Lo previsto por la regla pero aún no materializado
                                // se distingue de lo real: si no, "generar" parece
                                // que no hace nada.
                                opacity: hayTurno && !c?.bloque ? 0.55 : 1,
                              }}
                            >
                              <span style={{ fontSize: 9, color: texto, lineHeight: 1 }}>{dia}</span>
                              {etiqueta && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: texto, lineHeight: 1.2 }}>{etiqueta}</span>
                              )}
                            </div>
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
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 3, marginRight: 4 }} />★ No laborable</span>
          </div>
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
    </div>
  )
}

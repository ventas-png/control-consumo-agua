// Datos de la EMPRESA DEMO para las capturas de los manuales («Condominio Demo»).
// Todo es inventado: nombres, áreas, rutinas y fechas. Hoy = miércoles 25 de
// noviembre de 2026. Ningún dato sale de producción.
import type {
  AusenciaPersonal, AreaCondominio, AsignacionTurno, BloqueTurno, PersonalCondominio, PlantillaHorario,
  PlantillaTareaCargo, PlantillaTareaHerramienta, RutinaActividad, RutinaArea, RutinaLimpieza,
  TareaBloque, TareaBloqueSuministro, TurnoCalendarioLimpieza,
} from '../../src/types'

export const HOY = '2026-11-25'
export const CO = 'demo-empresa'
export const PR = 'demo-condominio'
const base = { company_id: CO, project_id: PR, created_at: '2026-10-01T12:00:00Z' }

// ── Operaciones → Áreas ─────────────────────────────────────────────────────
export const AREAS: AreaCondominio[] = [
  ['a_lobby', 'Lobby', '🏢', 'Entrada principal y recepción'],
  ['a_n1', 'Pasillo nivel 1', '🚪', null],
  ['a_n2', 'Pasillo nivel 2', '🚪', null],
  ['a_n3', 'Pasillo nivel 3', '🚪', null],
  ['a_gradas', 'Gradas', '🪜', 'Del sótano al nivel 3'],
  ['a_sotano', 'Sótano 1', '🅿️', 'Parqueo de residentes'],
].map(([id, nombre, icono, descripcion], i) => ({
  ...base, id: id as string, nombre: nombre as string, icono: icono as string,
  descripcion: descripcion as string | null, orden: i, activo: true,
}))
const areaPor = new Map(AREAS.map(a => [a.id, a]))

// ── RRHH → Plantillas: catálogo de actividades ──────────────────────────────
type Act = Partial<PlantillaTareaCargo> & { id: string; titulo: string; icono: string; duracion_estimada_min: number }
const act = (a: Act, i: number): PlantillaTareaCargo => ({
  ...base, cargo: 'conserje', servicio: 'limpieza', orden: i, activo: true,
  requiere_foto: false, requiere_comentario: false, requiere_checklist: false, checklist: [], ...a,
})
export const PLANTILLAS: PlantillaTareaCargo[] = ([
  { id: 'p_barrer', titulo: 'Barrido de piso', icono: '🧹', duracion_estimada_min: 8,
    descripcion: 'Desde el punto más lejano hacia la salida, recogiendo la basura al final.',
    checklist: ['Mover tapetes', 'Barrer hacia la salida', 'Recoger la basura'] },
  { id: 'p_trapear', titulo: 'Trapeado de piso', icono: '🪣', duracion_estimada_min: 10, requiere_foto: true,
    descripcion: 'Trapear con desinfectante diluido, en franjas.',
    instrucciones_seguridad: 'Colocar el rótulo de piso mojado antes de empezar' },
  { id: 'p_vidrios', titulo: 'Limpieza de vidrios', icono: '🪟', duracion_estimada_min: 6, requiere_checklist: true,
    checklist: ['Vidrio interior', 'Vidrio exterior', 'Marcos'] },
  { id: 'p_pasamanos', titulo: 'Limpieza de pasamanos', icono: '✋', duracion_estimada_min: 4 },
  { id: 'p_basureros', titulo: 'Vaciar basureros', icono: '🗑️', duracion_estimada_min: 3 },
  { id: 'p_aspirar', titulo: 'Aspirado de alfombra', icono: '🌀', duracion_estimada_min: 7, area_id: 'a_lobby' },
  { id: 'p_ronda', titulo: 'Ronda perimetral', icono: '🛡️', duracion_estimada_min: 20, cargo: 'guardia', servicio: 'seguridad' },
] satisfies Act[]).map(act)
const plantillaPor = new Map(PLANTILLAS.map(p => [p.id, p]))

// ── Asignación turnos → Jornadas ────────────────────────────────────────────
const jornada = (id: string, nombre: string, codigo: string, ini: string, fin: string, color: string, turno: PlantillaHorario['turno'], descanso: number): PlantillaHorario => ({
  ...base, id, nombre, codigo, hora_inicio: ini, hora_fin: fin, color, turno, cruza_medianoche: false,
  minutos_descanso: descanso, horas_jornada: null, tolerancia_entrada_min: 10, tolerancia_salida_min: 10,
  demora_compensable_hasta_min: 0, extra_requiere_autorizacion: true, activo: true, notas: null,
})
export const JORNADAS: PlantillaHorario[] = [
  jornada('h_d', 'Diurna', 'D', '07:00:00', '15:00:00', '#B96A3F', 'manana', 60),
  jornada('h_t', 'Tarde', 'T', '14:00:00', '22:00:00', '#1B3B36', 'tarde', 60),
  jornada('h_s', 'Sábado medio día', 'S', '07:00:00', '13:00:00', '#577B69', 'manana', 0),
]
const jorPor = new Map(JORNADAS.map(j => [j.id, j]))
export const CUPOS = [
  { id: 'c1', ...base, plantilla_horario_id: 'h_d', tipo: 'refaccion', minutos: 15 },
  { id: 'c2', ...base, plantilla_horario_id: 'h_d', tipo: 'almuerzo', minutos: 60 },
  { id: 'c3', ...base, plantilla_horario_id: 'h_t', tipo: 'refaccion', minutos: 15 },
  { id: 'c4', ...base, plantilla_horario_id: 'h_t', tipo: 'cena', minutos: 60 },
  { id: 'c5', ...base, plantilla_horario_id: 'h_s', tipo: 'refaccion', minutos: 15 },
]
export const TIPOS_PAUSA = [
  { codigo: 'refaccion', etiqueta: 'Refacción', descuenta: false, minutos_max: 30, orden: 1, configurado: true },
  { codigo: 'almuerzo', etiqueta: 'Almuerzo', descuenta: true, minutos_max: 60, orden: 2, configurado: true },
  { codigo: 'cena', etiqueta: 'Cena', descuenta: true, minutos_max: 60, orden: 3, configurado: true },
]

// ── RRHH → Personal ─────────────────────────────────────────────────────────
const persona = (id: string, nombre: string, cargo: string): PersonalCondominio => ({
  ...base, id, nombre, cargo, turno: 'diurno', estado: 'activo',
} as PersonalCondominio)
export const PERSONAL: PersonalCondominio[] = [
  persona('per_ana', 'Ana Pérez', 'conserje'),
  persona('per_luis', 'Luis Gómez', 'conserje'),
  persona('per_pedro', 'Pedro Ruiz', 'conserje'),
  persona('per_marta', 'Marta Ruiz', 'mantenimiento'),
]
const perPor = new Map(PERSONAL.map(p => [p.id, p]))

/** RRHH → Ausencias: Luis de vacaciones del 16 al 20 (por eso esos días no tienen turno). */
export const AUSENCIAS: AusenciaPersonal[] = [{
  ...base, id: 'aus1', personal_id: 'per_luis', tipo: 'vacaciones', fecha_inicio: '2026-11-16', fecha_fin: '2026-11-20',
  dias_habiles: 5, goce_salario: true, estado: 'aprobada', motivo: 'Vacaciones', personal_nombre: 'Luis Gómez', personal_cargo: 'conserje',
} as AusenciaPersonal]

// ── Asignación turnos → Reglas ──────────────────────────────────────────────
const regla = (id: string, per: string, jor: string, dias: number[], desde = '2026-11-01', hasta: string | null = null): AsignacionTurno => ({
  ...base, id, personal_id: per, plantilla_horario_id: jor, nombre: null, frecuencia: 'semanal',
  dias_semana: dias, intervalo_dias: null, dia_mes: null, dias_mes: [], mes_ancla: null, fechas_especificas: [],
  fecha_inicio: desde, fecha_fin: hasta, cubre_dias_no_laborables: false, activa: true, notas: null,
  personal_nombre: perPor.get(per)!.nombre, personal_cargo: perPor.get(per)!.cargo, plantilla_nombre: jorPor.get(jor)!.nombre,
})
export const REGLAS: AsignacionTurno[] = [
  regla('rg1', 'per_ana', 'h_d', [1, 2, 3, 4, 5]),
  regla('rg2', 'per_ana', 'h_s', [6]),
  // Luis sale de vacaciones del 16 al 20: su regla se corta y retoma el 23.
  regla('rg3', 'per_luis', 'h_t', [1, 2, 3, 4, 5], '2026-11-01', '2026-11-15'),
  regla('rg3b', 'per_luis', 'h_t', [1, 2, 3, 4, 5], '2026-11-23'),
  regla('rg4', 'per_pedro', 'h_t', [1, 2, 3, 4, 5]),
  regla('rg5', 'per_marta', 'h_d', [1, 2, 3, 4, 5]),
]

// ── Limpieza → Rutinas (recorridos) ─────────────────────────────────────────
type Recorrido = Array<[string, string[]]>   // [área, actividades]
const RECORRIDOS: Record<string, Recorrido> = {
  r_lobby: [['a_lobby', ['p_aspirar', 'p_vidrios', 'p_basureros', 'p_trapear']]],
  r_barrido: [
    ['a_n1', ['p_barrer', 'p_basureros']], ['a_n2', ['p_barrer', 'p_basureros']],
    ['a_n3', ['p_barrer', 'p_basureros']], ['a_gradas', ['p_barrer', 'p_pasamanos']],
  ],
  r_trapeado: [['a_n1', ['p_trapear']], ['a_n2', ['p_trapear']], ['a_n3', ['p_trapear']], ['a_gradas', ['p_trapear']]],
  r_sotano: [['a_sotano', ['p_barrer', 'p_basureros']]],
  r_temporada: [['a_lobby', ['p_vidrios']]],
}
export const RUTINAS: RutinaLimpieza[] = [
  { id: 'r_lobby', nombre: 'Limpieza de Lobby', descripcion: 'Primera parada del día, antes de la entrada de residentes', jor: 'h_d' },
  { id: 'r_barrido', nombre: 'Barrido de Pasillos y Gradas', descripcion: null, jor: 'h_d' },
  { id: 'r_trapeado', nombre: 'Trapeado de Pasillos y Gradas', descripcion: 'Después del barrido', jor: 'h_t' },
  { id: 'r_sotano', nombre: 'Limpieza de Sótanos', descripcion: null, jor: 'h_t' },
  { id: 'r_temporada', nombre: 'Vidrios de temporada', descripcion: 'Sólo en época de lluvia', jor: null, activa: false },
].map((r, i) => ({
  ...base, id: r.id, nombre: r.nombre, descripcion: r.descripcion, servicio: 'limpieza', area_id: null,
  plantilla_horario_id: r.jor, horario_nombre: r.jor ? jorPor.get(r.jor)!.nombre : undefined,
  activa: r.activa ?? true, orden: i,
}))
export const PARADAS: RutinaArea[] = []
export const PASOS: RutinaActividad[] = []
for (const [rid, rec] of Object.entries(RECORRIDOS)) {
  rec.forEach(([area, acts], i) => {
    const pid = `${rid}:${area}`
    PARADAS.push({ ...base, id: pid, rutina_id: rid, area_id: area, orden: i, notas: null })
    acts.forEach((a, j) => PASOS.push({ ...base, id: `${pid}:${a}`, rutina_id: rid, rutina_area_id: pid, plantilla_tarea_id: a, orden: j, obligatoria: true }))
  })
}
const tareasDe = (rid: string) => RECORRIDOS[rid].flatMap(([area, acts]) => acts.map(a => ({ area, a })))

// ── Turnos del mes y lo asignado ────────────────────────────────────────────
const iso = (d: number) => `2026-11-${String(d).padStart(2, '0')}`
const diaSemana = (d: number) => new Date(2026, 10, d, 12).getDay()   // 0 domingo
type Asig = { rid: string; hechas?: number }
interface Plan { per: string; dia: number; jor: string; asig: Asig[] }
const planes: Plan[] = []
for (let d = 1; d <= 30; d++) {
  const ds = diaSemana(d)
  if (ds === 0) continue
  // Ana: diurna lunes a viernes (Lobby + Barrido), sábado medio día (Trapeado)
  if (ds === 6) planes.push({ per: 'per_ana', dia: d, jor: 'h_s', asig: d <= 28 ? [{ rid: 'r_trapeado' }] : [] })
  else planes.push({ per: 'per_ana', dia: d, jor: 'h_d', asig: d <= 27 ? [{ rid: 'r_lobby', hechas: d === 25 ? 3 : undefined }, { rid: 'r_barrido', hechas: d === 25 ? 0 : undefined }] : [] })
  if (ds >= 1 && ds <= 5) {
    // Luis: tarde, de vacaciones del 16 al 20
    if (d < 16 || d > 20) {
      planes.push({ per: 'per_luis', dia: d, jor: 'h_t', asig: d <= 26 ? [{ rid: 'r_trapeado', hechas: d === 23 ? 2 : d >= 25 ? 0 : undefined }, { rid: 'r_sotano', hechas: d >= 25 ? 0 : undefined }] : [] })
    }
    // Pedro: tarde; tuvo Sótanos la primera quincena y desde el 16 nadie le asignó nada
    planes.push({ per: 'per_pedro', dia: d, jor: 'h_t', asig: d <= 13 ? [{ rid: 'r_sotano' }] : [] })
    // Marta: mantenimiento, no hace rutinas de limpieza
    planes.push({ per: 'per_marta', dia: d, jor: 'h_d', asig: [] })
  }
}
const bloqueId = (p: Plan) => `b_${p.per}_${p.dia}`
const estadoDe = (p: Plan) => (p.dia < 25 ? 'completado' : p.dia === 25 && p.per === 'per_ana' ? 'en_curso' : 'pendiente')

export const TURNOS_CAL: TurnoCalendarioLimpieza[] = planes.map(p => {
  const per = perPor.get(p.per)!
  const j = jorPor.get(p.jor)!
  const estado = estadoDe(p)
  return {
    bloque_id: bloqueId(p), personal_id: p.per, personal_nombre: per.nombre, personal_cargo: per.cargo,
    personal_estado: 'activo', fecha: iso(p.dia), turno: j.turno, estado,
    iniciado_en: estado !== 'pendiente' ? `${iso(p.dia)}T13:05:00Z` : null,
    cerrado_en: estado === 'completado' ? `${iso(p.dia)}T21:00:00Z` : null,
    plantilla_horario_id: j.id, jornada_nombre: j.nombre, jornada_codigo: j.codigo ?? null, jornada_color: j.color ?? null,
    hora_inicio: j.hora_inicio, hora_fin: j.hora_fin, horas_planificadas: p.jor === 'h_s' ? 6 : 8,
    rutinas: p.asig.map(a => {
      const n = tareasDe(a.rid).length
      const hechas = a.hechas ?? (p.dia < 25 ? n : 0)
      const pendientes = n - hechas
      return { rutina_id: a.rid, tareas: n, pendientes, hechas, trabajadas: hechas }
    }),
    otras_tareas: p.per === 'per_luis' && p.dia === 26 ? 1 : 0,
  }
})

export const BLOQUES: BloqueTurno[] = planes.map(p => {
  const t = TURNOS_CAL.find(x => x.bloque_id === bloqueId(p))!
  return {
    ...base, id: t.bloque_id, personal_id: p.per, turno: t.turno as BloqueTurno['turno'], fecha: t.fecha,
    estado: t.estado as BloqueTurno['estado'], iniciado_en: t.iniciado_en, cerrado_en: t.cerrado_en,
    plantilla_horario_id: p.jor, asignacion_id: null, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin,
    horas_planificadas: t.horas_planificadas, origen: 'recurrencia', personal_nombre: t.personal_nombre, personal_cargo: t.personal_cargo ?? undefined,
  } as BloqueTurno
})

/** Las tareas reales de un turno: el recorrido de sus rutinas, en orden. */
export function tareasDelTurno(bid: string): TareaBloque[] {
  const t = TURNOS_CAL.find(x => x.bloque_id === bid)
  if (!t) return []
  let orden = 0
  return t.rutinas.flatMap(r => tareasDe(r.rutina_id).map(({ area, a }, k) => {
    const p = plantillaPor.get(a)!
    const ar = areaPor.get(area)!
    const hecha = k < r.hechas
    return {
      id: `${bid}:${r.rutina_id}:${k}`, bloque_id: bid, plantilla_id: a, rutina_id: r.rutina_id, titulo: p.titulo,
      descripcion: p.descripcion ?? null, area_id: area, area_nombre: ar.nombre, area_icono: ar.icono, orden: orden++,
      requiere_foto: p.requiere_foto, requiere_comentario: p.requiere_comentario, requiere_checklist: p.requiere_checklist,
      checklist: p.checklist ?? [], checklist_completado: hecha && p.requiere_checklist ? (p.checklist ?? []).map((_, i) => i) : [],
      instrucciones_seguridad: p.instrucciones_seguridad ?? null, duracion_estimada_min: p.duracion_estimada_min,
      estado: hecha ? 'completada' : 'pendiente', completada_en: hecha ? `${t.fecha}T14:00:00Z` : null,
      foto_urls: [], created_at: `${t.fecha}T12:00:00Z`,
    } as TareaBloque
  }))
}

export function insumosDe(ids: string[]): TareaBloqueSuministro[] {
  const out: TareaBloqueSuministro[] = []
  for (const id of ids) {
    const plantilla = id.split(':')[1] && tareasPorId(id)?.plantilla_id
    if (plantilla === 'p_trapear') out.push({ ...base, id: `i_${id}`, tarea_id: id, suministro_id: 's_desinf', cantidad_planificada: 0.25, nombre_suministro: 'Desinfectante de pisos', unidad_medida: 'litro' })
    if (plantilla === 'p_vidrios') out.push({ ...base, id: `i_${id}`, tarea_id: id, suministro_id: 's_vidrio', cantidad_planificada: 0.1, nombre_suministro: 'Limpiavidrios', unidad_medida: 'litro' })
    if (plantilla === 'p_basureros') out.push({ ...base, id: `i_${id}`, tarea_id: id, suministro_id: 's_bolsas', cantidad_planificada: 2, nombre_suministro: 'Bolsas de basura', unidad_medida: 'unidad' })
  }
  return out
}
function tareasPorId(id: string) {
  const bid = id.split(':')[0]
  return tareasDelTurno(bid).find(t => t.id === id)
}

const herr = (plantilla: string, nombre: string, obligatoria: boolean): PlantillaTareaHerramienta => ({
  ...base, id: `h_${plantilla}_${nombre}`, plantilla_tarea_id: plantilla, inventario_id: null, equipo_id: `e_${nombre}`,
  cantidad: 1, obligatoria, equipo_nombre: nombre, equipo_estado: 'operativo',
} as PlantillaTareaHerramienta)
export const HERRAMIENTAS: PlantillaTareaHerramienta[] = [
  herr('p_barrer', 'Escoba', true), herr('p_barrer', 'Pala de basura', false),
  herr('p_trapear', 'Trapeador', true), herr('p_trapear', 'Cubeta con escurridor', true), herr('p_trapear', 'Rótulo de piso mojado', true),
  herr('p_vidrios', 'Paño de microfibra', false), herr('p_aspirar', 'Aspiradora', true),
]

/** Novedades de rutina de los últimos 30 días (lo que la vista Novedades lee). */
export const NOVEDADES: TareaBloque[] = [
  { id: 'nov1', bloque_id: 'b_per_luis_24', titulo: 'Trapeado de piso', area_id: 'a_gradas', area_nombre: 'Gradas',
    novedad: 'Luminaria fundida en el descanso entre nivel 2 y 3; queda oscuro en la noche.', prioridad: 'alta',
    requiere_mantenimiento: true, estado: 'con_observacion', rutina_id: 'r_trapeado' },
  { id: 'nov2', bloque_id: 'b_per_pedro_12', titulo: 'Vaciar basureros', area_id: 'a_sotano', area_nombre: 'Sótano 1',
    novedad: 'El lavamanos del cuarto de limpieza gotea constantemente.', prioridad: 'media',
    requiere_mantenimiento: true, estado: 'con_observacion', rutina_id: 'r_sotano' },
  { id: 'nov3', bloque_id: 'b_per_ana_19', titulo: 'Limpieza de vidrios', area_id: 'a_lobby', area_nombre: 'Lobby',
    novedad: 'Vidrio de la puerta principal rayado; no sale con limpieza.', prioridad: 'baja',
    requiere_mantenimiento: false, estado: 'con_observacion', rutina_id: 'r_lobby' },
].map(n => ({ orden: 0, requiere_foto: false, foto_urls: [], created_at: '2026-11-20T15:00:00Z', ...n } as TareaBloque))

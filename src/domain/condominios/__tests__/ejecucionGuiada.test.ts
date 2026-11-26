// Ejecución guiada de un turno, sin React: paradas del recorrido, a dónde se
// avanza y qué hay que preparar antes de iniciar.
import { describe, it, expect } from 'vitest'
import type { AreaCondominio, HerramientaDelTurno, TareaBloque, TareaBloqueSuministro } from '../../../types'
import {
  duracionLegible, estadoVisibleDelTurno, itemsPorConfirmar, paradaDe, paradasDelTurno, preparacionDelTurno,
  puntajeCierre, siguientePendiente, tareaHecha, tareaOpcional,
} from '../ejecucionGuiada'

function t(id: string, orden: number, over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id, bloque_id: 'b1', titulo: `Tarea ${id}`, orden, requiere_foto: false,
    estado: 'pendiente', foto_urls: [], created_at: '', ...over,
  } as TareaBloque
}
const areas = [
  { id: 'a8', nombre: 'Nivel 8', icono: '🏢' },
  { id: 'a7', nombre: 'Nivel 7', icono: '🏬' },
] as AreaCondominio[]

describe('paradasDelTurno', () => {
  it('agrupa tareas consecutivas de la misma área, en el orden del turno', () => {
    const ps = paradasDelTurno([
      t('3', 2, { area_id: 'a7', duracion_estimada_min: 5 }),
      t('1', 0, { area_id: 'a8', duracion_estimada_min: 5 }),
      t('2', 1, { area_id: 'a8', duracion_estimada_min: 3 }),
      t('4', 3, { area_id: 'a7' }),
    ], areas)
    expect(ps.map(p => [p.nombre, p.tareas.map(x => x.id), p.minutos, p.sinDuracion])).toEqual([
      ['Nivel 8', ['1', '2'], 8, 0],
      ['Nivel 7', ['3', '4'], 5, 1],
    ])
    expect(ps[0].icono).toBe('🏢')
  })

  it('volver a un área ya visitada es otra parada; sin área, se dice', () => {
    const ps = paradasDelTurno([
      t('1', 0, { area_id: 'a8' }), t('2', 1, { area_id: 'a7' }), t('3', 2, { area_id: 'a8' }), t('4', 3),
    ], areas)
    expect(ps.map(p => p.nombre)).toEqual(['Nivel 8', 'Nivel 7', 'Nivel 8', 'Sin área asignada'])
    expect(new Set(ps.map(p => p.clave)).size).toBe(4)
    expect(paradaDe(ps, '3')?.clave).toBe(ps[2].clave)
  })

  it('usa el nombre que trae la tarea aunque el área ya no esté en el catálogo', () => {
    const [p] = paradasDelTurno([t('1', 0, { area_id: 'vieja', area_nombre: 'Lobby', area_icono: '🛎️' })], areas)
    expect([p.nombre, p.icono]).toEqual(['Lobby', '🛎️'])
  })
})

describe('siguientePendiente', () => {
  const ts = [
    t('1', 0, { estado: 'completada' }), t('2', 1), t('3', 2, { estado: 'omitida' }), t('4', 3),
  ]
  it('la próxima pendiente detrás; si no hay, la primera que quedó atrás; si no, ninguna', () => {
    expect(siguientePendiente(ts, null)).toBe('2')
    expect(siguientePendiente(ts, '2')).toBe('4')
    expect(siguientePendiente(ts, '4')).toBe('2')
    expect(siguientePendiente(ts.map(x => ({ ...x, estado: 'completada' as const })), '2')).toBeNull()
  })
})

describe('preparacionDelTurno', () => {
  const tareas = [
    t('1', 0, { plantilla_id: 'barrer', area_id: 'a8', duracion_estimada_min: 5, requiere_foto: true, instrucciones_seguridad: 'Usar rótulo de área en mantenimiento' }),
    t('2', 1, { plantilla_id: 'barrer', area_id: 'a7', duracion_estimada_min: 5, instrucciones_seguridad: '  Usar rótulo de área en mantenimiento ' }),
    t('3', 2, { plantilla_id: 'vidrios', area_id: 'a7', requiere_foto: true }),
    t('4', 3, { plantilla_id: 'vidrios', estado: 'completada', instrucciones_seguridad: 'Arnés' }),
  ]
  // Escoba: equipo del catálogo (filas nuevas); Jalador: vínculo legado a Inventario. Ambos cuentan igual.
  // La forma es la de la RPC herramientas_del_turno (20261231000000).
  const herramientas: HerramientaDelTurno[] = [
    { plantilla_tarea_id: 'barrer', equipo_id: 'escoba', inventario_id: null, nombre: 'Escoba', estado: 'operativo', cantidad: 1, obligatoria: false },
    { plantilla_tarea_id: 'vidrios', equipo_id: 'escoba', inventario_id: null, nombre: 'Escoba', estado: 'operativo', cantidad: 2, obligatoria: true },
    { plantilla_tarea_id: 'vidrios', equipo_id: null, inventario_id: 'jalador', nombre: 'Jalador', estado: 'disponible', cantidad: 1, obligatoria: false },
  ]
  const insumos = [
    { id: 'i1', tarea_id: '1', suministro_id: 'alcohol', nombre_suministro: 'Alcohol 70%', cantidad_planificada: 0.5, unidad_medida: 'litro' },
    { id: 'i2', tarea_id: '2', suministro_id: 'alcohol', nombre_suministro: 'Alcohol 70%', cantidad_planificada: 0.25, unidad_medida: 'litro' },
    { id: 'i3', tarea_id: '3', suministro_id: 'bolsas', nombre_suministro: 'Bolsas', cantidad_planificada: 2, unidad_medida: 'unidad', movimiento_id: 'm1' },
    { id: 'i4', tarea_id: '3', suministro_id: 'trapo', nombre_suministro: 'Trapo', cantidad_planificada: 1, unidad_medida: 'unidad', no_usado_en: '2026-10-19' },
  ] as TareaBloqueSuministro[]
  const p = preparacionDelTurno(tareas, insumos, herramientas, areas)

  it('herramientas: la mayor cantidad por tarea, obligatoria si alguna la exige, lo obligatorio primero', () => {
    expect(p.herramientas.map(h => [h.nombre, h.cantidad, h.obligatoria, h.tareas])).toEqual([
      ['Escoba', 2, true, ['Tarea 1', 'Tarea 2', 'Tarea 3']],
      ['Jalador', 1, false, ['Tarea 3']],
    ])
  })

  it('insumos: se suman, sin lo ya consumido ni lo declarado no usado', () => {
    expect(p.insumos.map(i => [i.nombre, i.cantidad, i.unidad])).toEqual([['Alcohol 70%', 0.75, 'litro']])
  })

  it('indicaciones sin repetir; cámara si alguna pendiente pide foto; sólo cuenta lo pendiente', () => {
    expect(p.indicaciones).toEqual([{ texto: 'Usar rótulo de área en mantenimiento', tareas: ['Tarea 1', 'Tarea 2'] }])
    expect(p.conFoto).toBe(2)
    expect([p.pendientes, p.paradas.length, p.minutos, p.sinDuracion]).toEqual([3, 2, 10, 1])
    expect(itemsPorConfirmar(p)).toEqual([
      'herramienta:escoba', 'herramienta:jalador', 'insumo:alcohol', 'indicacion:0', 'camara',
    ])
  })

  it('si el recurso llega sin nombre, la herramienta se lista igual (no desaparece de lo que hay que llevar)', () => {
    const sinNombre: HerramientaDelTurno[] = [
      { plantilla_tarea_id: 'barrer', equipo_id: 'x', inventario_id: null, nombre: null, estado: null, cantidad: 1, obligatoria: true },
    ]
    expect(preparacionDelTurno(tareas, [], sinNombre, areas).herramientas.map(h => h.nombre)).toEqual(['Herramienta'])
  })

  it('sin nada que preparar, no hay nada que confirmar', () => {
    expect(itemsPorConfirmar(preparacionDelTurno([t('1', 0)], [], [], areas))).toEqual([])
  })
})

describe('duracionLegible', () => {
  it('minutos y horas', () => {
    expect([duracionLegible(40), duracionLegible(60), duracionLegible(85)]).toEqual(['40 min', '1 h', '1 h 25 min'])
  })
})

// 20261226000100 · decisión del dueño del producto: el opcional SUMA SI SE HACE
// y NO RESTA SI NO.
describe('puntajeCierre', () => {
  const hecha = (id: string, over: Partial<TareaBloque> = {}) => t(id, 0, { estado: 'completada', ...over })

  it('sin opcionales: hechas sobre todas, como siempre', () => {
    expect(puntajeCierre([hecha('1'), hecha('2'), t('3', 0), t('4', 0, { estado: 'omitida' })]))
      .toEqual({ puntaje: 50, hechas: 2, cuentan: 4 })
  })

  it('cuatro obligatorias hechas y una opcional sin hacer: 100%', () => {
    const ts = [hecha('1'), hecha('2'), hecha('3'), hecha('4', { estado: 'con_observacion' }), t('5', 0, { obligatoria: false })]
    expect(puntajeCierre(ts)).toEqual({ puntaje: 100, hechas: 4, cuentan: 4 })
  })

  it('la opcional hecha suma en el total y en lo hecho', () => {
    // 1 de 2 obligatorias + la opcional hecha: 2 de 3, no 1 de 2.
    const ts = [hecha('1'), t('2', 0), hecha('3', { obligatoria: false })]
    expect(puntajeCierre(ts)).toEqual({ puntaje: 67, hechas: 2, cuentan: 3 })
  })

  it('la opcional omitida tampoco resta', () => {
    const ts = [hecha('1'), t('2', 0, { obligatoria: false, estado: 'omitida' })]
    expect(puntajeCierre(ts).puntaje).toBe(100)
  })

  it('la obligatoria omitida sí resta', () => {
    const ts = [hecha('1'), t('2', 0, { estado: 'omitida' })]
    expect(puntajeCierre(ts).puntaje).toBe(50)
  })

  it('sin tareas, 0; sólo opcionales sin hacer, 100 (no faltó nada exigido)', () => {
    expect(puntajeCierre([]).puntaje).toBe(0)
    expect(puntajeCierre([t('1', 0, { obligatoria: false }), t('2', 0, { obligatoria: false })]))
      .toEqual({ puntaje: 100, hechas: 0, cuentan: 0 })
  })

  it('sin el dato, la tarea es obligatoria', () => {
    expect(tareaOpcional(t('1', 0))).toBe(false)
    expect(tareaOpcional(t('1', 0, { obligatoria: true }))).toBe(false)
    expect(tareaOpcional(t('1', 0, { obligatoria: false }))).toBe(true)
  })

  it('hecha es completa o con observación; omitida no', () => {
    expect(['completada', 'con_observacion', 'omitida', 'pendiente'].map(e => tareaHecha(e as TareaBloque['estado'])))
      .toEqual([true, true, false, false])
  })
})

describe('estadoVisibleDelTurno', () => {
  it('cerrado con una obligatoria sin hacer se muestra Incompleto, no Completado', () => {
    expect(estadoVisibleDelTurno('completado', [t('1', 0, { estado: 'completada' }), t('2', 1)])).toBe('incompleto')
    expect(estadoVisibleDelTurno('completado', [t('1', 0), t('2', 1), t('3', 2)])).toBe('incompleto')
  })
  it('cerrado sin obligatorias pendientes sigue Completado: omitir, observar, anular u opcional no lo vuelven incompleto', () => {
    expect(estadoVisibleDelTurno('completado', [
      t('1', 0, { estado: 'completada' }), t('2', 1, { estado: 'con_observacion' }), t('3', 2, { estado: 'omitida' }),
      t('4', 3, { anulada_en: '2026-11-26T10:00:00Z' }), t('5', 4, { obligatoria: false }),
    ])).toBe('completado')
    expect(estadoVisibleDelTurno('completado', [])).toBe('completado')
  })
  it('lo abierto no cambia: pendiente y en curso se muestran tal cual', () => {
    expect(estadoVisibleDelTurno('en_curso', [t('1', 0)])).toBe('en_curso')
    expect(estadoVisibleDelTurno('pendiente', [t('1', 0)])).toBe('pendiente')
  })
})

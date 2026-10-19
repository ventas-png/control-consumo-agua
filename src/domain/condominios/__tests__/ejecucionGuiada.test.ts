// Ejecución guiada de un turno, sin React: paradas del recorrido, a dónde se
// avanza y qué hay que preparar antes de iniciar.
import { describe, it, expect } from 'vitest'
import type { AreaCondominio, PlantillaTareaHerramienta, TareaBloque, TareaBloqueSuministro } from '../../../types'
import {
  duracionLegible, itemsPorConfirmar, paradaDe, paradasDelTurno, preparacionDelTurno, siguientePendiente,
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
  const herramientas = [
    { plantilla_tarea_id: 'barrer', inventario_id: 'escoba', inventario_nombre: 'Escoba', cantidad: 1, obligatoria: false },
    { plantilla_tarea_id: 'vidrios', inventario_id: 'escoba', inventario_nombre: 'Escoba', cantidad: 2, obligatoria: true },
    { plantilla_tarea_id: 'vidrios', inventario_id: 'jalador', inventario_nombre: 'Jalador', cantidad: 1, obligatoria: false },
  ] as PlantillaTareaHerramienta[]
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

  it('sin nada que preparar, no hay nada que confirmar', () => {
    expect(itemsPorConfirmar(preparacionDelTurno([t('1', 0)], [], [], areas))).toEqual([])
  })
})

describe('duracionLegible', () => {
  it('minutos y horas', () => {
    expect([duracionLegible(40), duracionLegible(60), duracionLegible(85)]).toEqual(['40 min', '1 h', '1 h 25 min'])
  })
})

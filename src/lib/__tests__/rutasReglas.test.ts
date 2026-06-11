import { describe, it, expect } from 'vitest'
import {
  construirPayloadRuta,
  construirWhatsAppRuta,
  describirRecurrencia,
  estadoRuta,
  filtrarClientesDisponibles,
  filtrarContadoresDisponibles,
  filtrarUnidadesDisponibles,
  validarRuta,
  type RutaForm,
} from '../rutasReglas'
import type { Cliente, Contador, Ruta, Unidad } from '../../types'

function form(partial: Partial<RutaForm>): RutaForm {
  return {
    nombre: 'Zona Norte', descripcion: '', project_id: 'p1', fecha_programada: '2026-06-15',
    asignado_a: '', asignado_nombre: '', asignado_email: '', asignado_telefono: '',
    frecuencia: 'unica', dias_semana: [], intervalo_dias: '14', dia_mes: '1',
    fechas_especificas: [], hora_programada: '', recurrencia_activa: true,
    fecha_inicio: '', fecha_fin: '', recordatorio_anticipacion_min: 1440,
    recordatorio_canales: ['email', 'app'],
    ...partial,
  }
}

function ruta(partial: Partial<Ruta>): Ruta {
  return {
    id: 'r1', nombre: 'Ruta 1', tipo_ruta: 'clientes', cliente_ids: ['c1'],
    contador_ids: [], unidad_ids: [], completada: false, created_at: '2026-01-01',
    ...partial,
  }
}

describe('validarRuta', () => {
  const totales = { clientes: 1, contadores: 1, unidades: 1 }

  it('acepta una ruta única válida', () => {
    expect(validarRuta(form({}), 'clientes', totales)).toBeNull()
  })

  it('exige nombre, proyecto y al menos un elemento del tipo activo', () => {
    expect(validarRuta(form({ nombre: '  ' }), 'clientes', totales)).toMatch(/nombre/)
    expect(validarRuta(form({ project_id: '' }), 'clientes', totales)).toMatch(/proyecto/)
    expect(validarRuta(form({}), 'clientes', { ...totales, clientes: 0 })).toMatch(/cliente/)
    expect(validarRuta(form({}), 'contadores', { ...totales, contadores: 0 })).toMatch(/contador/)
    expect(validarRuta(form({}), 'unidades', { ...totales, unidades: 0 })).toMatch(/unidad/)
  })

  it('valida la periodicidad según la frecuencia', () => {
    expect(validarRuta(form({ fecha_programada: '' }), 'clientes', totales)).toMatch(/fecha programada/)
    expect(validarRuta(form({ frecuencia: 'semanal' }), 'clientes', totales)).toMatch(/día de la semana/)
    expect(validarRuta(form({ frecuencia: 'quincenal' }), 'clientes', totales)).toMatch(/fecha de inicio/)
    expect(validarRuta(form({ frecuencia: 'fechas' }), 'clientes', totales)).toMatch(/fecha específica/)
    expect(validarRuta(form({ frecuencia: 'semanal', dias_semana: [1] }), 'clientes', totales)).toBeNull()
  })
})

describe('construirPayloadRuta', () => {
  it('solo conserva los ids del tipo de ruta activo', () => {
    const p = construirPayloadRuta(form({}), 'contadores', ['cl1'], ['co1', 'co2'], ['u1'])
    expect(p.cliente_ids).toEqual([])
    expect(p.contador_ids).toEqual(['co1', 'co2'])
    expect(p.unidad_ids).toEqual([])
    expect(p.tipo_ruta).toBe('contadores')
  })

  it('ruta única: apaga recurrencia y limpia ventana de vigencia', () => {
    const p = construirPayloadRuta(form({ fecha_inicio: '2026-06-01', fecha_fin: '2026-12-31' }), 'clientes', ['c1'], [], [])
    expect(p.recurrencia_activa).toBe(false)
    expect(p.fecha_inicio).toBeNull()
    expect(p.fecha_fin).toBeNull()
    expect(p.intervalo_dias).toBeNull()
    expect(p.dias_semana).toEqual([])
  })

  it('quincenal: parsea el intervalo con fallback a 14', () => {
    const base = form({ frecuencia: 'quincenal', fecha_inicio: '2026-06-01' })
    expect(construirPayloadRuta(base, 'clientes', ['c1'], [], []).intervalo_dias).toBe(14)
    expect(construirPayloadRuta({ ...base, intervalo_dias: '10' }, 'clientes', ['c1'], [], []).intervalo_dias).toBe(10)
    expect(construirPayloadRuta({ ...base, intervalo_dias: 'x' }, 'clientes', ['c1'], [], []).intervalo_dias).toBe(14)
  })

  it('campos vacíos se normalizan a null', () => {
    const p = construirPayloadRuta(form({ descripcion: '  ', asignado_email: '' }), 'clientes', ['c1'], [], [])
    expect(p.descripcion).toBeNull()
    expect(p.asignado_email).toBeNull()
  })
})

describe('describirRecurrencia / estadoRuta', () => {
  it('describe cada frecuencia', () => {
    expect(describirRecurrencia(ruta({}))).toBe('Una vez')
    expect(describirRecurrencia(ruta({ frecuencia: 'diaria', hora_programada: '07:30:00' }))).toBe('Diaria · 07:30')
    expect(describirRecurrencia(ruta({ frecuencia: 'semanal', dias_semana: [5, 1] }))).toBe('Semanal: Lun, Vie')
    expect(describirRecurrencia(ruta({ frecuencia: 'quincenal', intervalo_dias: 10 }))).toBe('Cada 10 días')
    expect(describirRecurrencia(ruta({ frecuencia: 'mensual', dia_mes: 5 }))).toBe('Mensual · día 5')
    expect(describirRecurrencia(ruta({ frecuencia: 'fechas', fechas_especificas: ['2026-06-01', '2026-06-15'] }))).toBe('2 fecha(s)')
  })

  it('estado por fecha programada relativo a hoy', () => {
    const hoy = '2026-06-11'
    expect(estadoRuta(ruta({ completada: true }), hoy).label).toBe('Completada')
    expect(estadoRuta(ruta({ fecha_programada: '2026-06-10' }), hoy).label).toBe('Vencida')
    expect(estadoRuta(ruta({ fecha_programada: hoy }), hoy).label).toBe('Hoy')
    expect(estadoRuta(ruta({ fecha_programada: '2026-06-12' }), hoy).label).toBe('Pendiente')
    expect(estadoRuta(ruta({}), hoy).label).toBe('Pendiente')
  })
})

describe('filtros de disponibles', () => {
  const cliente = (id: string, nombre: string, codigo = id.toUpperCase()): Cliente =>
    ({ id, nombre, codigo } as Cliente)

  it('clientes: excluye los ya agregados y busca por nombre o código', () => {
    const todos = [cliente('c1', 'Ana'), cliente('c2', 'Beto', 'ZZ9')]
    expect(filtrarClientesDisponibles(todos, [todos[0]], '')).toEqual([todos[1]])
    expect(filtrarClientesDisponibles(todos, [], 'zz9')).toEqual([todos[1]])
    expect(filtrarClientesDisponibles(todos, [], 'ana')).toEqual([todos[0]])
  })

  it('contadores: requiere proyecto, activo y no repetido', () => {
    const co = (id: string, partial: Partial<Contador> = {}): Contador =>
      ({ id, numero_serie: `SN-${id}`, activo: true, project_id: 'p1', ...partial } as Contador)
    const todos = [co('a'), co('b', { activo: false }), co('c', { project_id: 'p2' })]
    expect(filtrarContadoresDisponibles(todos, [], '', 'p1').map(c => c.id)).toEqual(['a'])
    expect(filtrarContadoresDisponibles(todos, [], '', '')).toEqual([])
    expect(filtrarContadoresDisponibles(todos, [todos[0]], '', 'p1')).toEqual([])
    expect(filtrarContadoresDisponibles(todos, [], 'sn-a', 'p1').map(c => c.id)).toEqual(['a'])
  })

  it('unidades: mismo contrato que contadores, busca por nombre o tipo', () => {
    const un = (id: string, partial: Partial<Unidad> = {}): Unidad =>
      ({ id, nombre: `Apto ${id}`, tipo: 'apartamento', activo: true, project_id: 'p1', ...partial } as Unidad)
    const todos = [un('1'), un('2', { tipo: 'oficina' })]
    expect(filtrarUnidadesDisponibles(todos, [], 'oficina', 'p1').map(u => u.id)).toEqual(['2'])
    expect(filtrarUnidadesDisponibles(todos, [todos[1]], '', 'p1').map(u => u.id)).toEqual(['1'])
  })
})

describe('construirWhatsAppRuta', () => {
  it('null sin teléfono; normaliza tel de 8 dígitos con código de país', () => {
    expect(construirWhatsAppRuta(ruta({}), '502')).toBeNull()
    const r = construirWhatsAppRuta(ruta({ asignado_telefono: '5555-1234', asignado_nombre: 'Luis' }), '502')
    expect(r?.tel).toBe('50255551234')
    expect(r?.msg).toContain('Hola Luis')
    expect(r?.msg).toContain('Total de clientes: 1')
  })

  it('cuenta los elementos según el tipo de ruta y respeta tel internacional', () => {
    const r = construirWhatsAppRuta(
      ruta({ tipo_ruta: 'contadores', contador_ids: ['a', 'b'], asignado_telefono: '+502 4444 5678', descripcion: 'Sector 3' }),
      '502'
    )
    expect(r?.tel).toBe('50244445678')
    expect(r?.msg).toContain('Total de contadores: 2')
    expect(r?.msg).toContain('📝 Sector 3')
  })
})

import { describe, it, expect } from 'vitest'
import {
  registroCoincide,
  numeroContadorDeRegistro,
  unidadesDelProyecto,
  type HistorialFiltros,
} from '../historialFiltros'
import type { Registro, Contador, Unidad } from '../../types'

// ── Fixtures ────────────────────────────────────────────────────────────────

function mkContador(p: Partial<Contador> & { id: string }): Contador {
  return {
    project_id: 'proj-1', company_id: 'co-1', numero_serie: 'SN-000',
    tipo_agua: 'potable', lectura_inicial: 0, activo: true, unidad_id: null,
    ...p,
  } as Contador
}

function mkRegistro(p: Partial<Registro> & { id: string }): Registro {
  return {
    cliente_id: 'cli-1', cliente_nombre: 'Juan Perez', contador_id: null,
    project_id: 'proj-1', fecha: '2026-06-25', lectura_anterior: 0,
    lectura_actual: 10, consumo: 10, tarifa_aplicada: 5, canon_aplicado: 20,
    monto_calculado: 70, tipo_cobro: 'consumo', estado: 'pendiente',
    ...p,
  } as Registro
}

function mkUnidad(p: Partial<Unidad> & { id: string }): Unidad {
  return {
    project_id: 'proj-1', company_id: 'co-1', nombre: 'Apto 1A',
    tipo: 'apartamento', activo: true,
    ...p,
  } as Unidad
}

const FILTROS_VACIOS: HistorialFiltros = {
  texto: '', estado: '', proyecto: '', unidad: '', tipoAgua: '',
  fechaInicio: '', fechaFin: '',
}

// Contador con número de serie buscable, ligado a unidad u-1 / agua de rehúso.
const contadores = new Map<string, Contador>([
  ['c-1', mkContador({ id: 'c-1', numero_serie: 'MED-12345', unidad_id: 'u-1', tipo_agua: 'rehuso', project_id: 'proj-1' })],
  ['c-2', mkContador({ id: 'c-2', numero_serie: 'MED-99999', unidad_id: 'u-2', tipo_agua: 'potable', project_id: 'proj-2' })],
])

// ── numeroContadorDeRegistro ──────────────────────────────────────────────────

describe('numeroContadorDeRegistro', () => {
  it('resuelve el número de serie por contador_id', () => {
    const r = mkRegistro({ id: 'r-1', contador_id: 'c-1' })
    expect(numeroContadorDeRegistro(r, contadores)).toBe('MED-12345')
  })

  it('devuelve null cuando el registro no tiene contador', () => {
    const r = mkRegistro({ id: 'r-1', contador_id: null })
    expect(numeroContadorDeRegistro(r, contadores)).toBeNull()
  })

  it('devuelve null cuando el contador_id no existe en el índice', () => {
    const r = mkRegistro({ id: 'r-1', contador_id: 'desconocido' })
    expect(numeroContadorDeRegistro(r, contadores)).toBeNull()
  })
})

// ── registroCoincide ──────────────────────────────────────────────────────────

describe('registroCoincide', () => {
  it('sin filtros, todo coincide', () => {
    const r = mkRegistro({ id: 'r-1' })
    expect(registroCoincide(r, FILTROS_VACIOS, contadores)).toBe(true)
  })

  it('busca por nombre de cliente (case-insensitive)', () => {
    const r = mkRegistro({ id: 'r-1', cliente_nombre: 'MELBA AZUCENA' })
    expect(registroCoincide(r, { ...FILTROS_VACIOS, texto: 'melba' }, contadores)).toBe(true)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, texto: 'pedro' }, contadores)).toBe(false)
  })

  it('busca por número de contador (la mejora pedida)', () => {
    const r = mkRegistro({ id: 'r-1', cliente_nombre: 'Juan', contador_id: 'c-1' })
    expect(registroCoincide(r, { ...FILTROS_VACIOS, texto: 'MED-12345' }, contadores)).toBe(true)
    // coincidencia parcial / case-insensitive
    expect(registroCoincide(r, { ...FILTROS_VACIOS, texto: 'med-123' }, contadores)).toBe(true)
    // un número distinto no coincide
    expect(registroCoincide(r, { ...FILTROS_VACIOS, texto: '99999' }, contadores)).toBe(false)
  })

  it('un registro sin contador no rompe la búsqueda por número', () => {
    const r = mkRegistro({ id: 'r-1', cliente_nombre: 'Juan', contador_id: null })
    expect(registroCoincide(r, { ...FILTROS_VACIOS, texto: 'MED' }, contadores)).toBe(false)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, texto: 'juan' }, contadores)).toBe(true)
  })

  it('filtra por estado', () => {
    const r = mkRegistro({ id: 'r-1', estado: 'pagado' })
    expect(registroCoincide(r, { ...FILTROS_VACIOS, estado: 'pagado' }, contadores)).toBe(true)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, estado: 'mora' }, contadores)).toBe(false)
  })

  it('filtra por proyecto', () => {
    const r = mkRegistro({ id: 'r-1', project_id: 'proj-2' })
    expect(registroCoincide(r, { ...FILTROS_VACIOS, proyecto: 'proj-2' }, contadores)).toBe(true)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, proyecto: 'proj-1' }, contadores)).toBe(false)
  })

  it('filtra por unidad vía el contador', () => {
    const r = mkRegistro({ id: 'r-1', contador_id: 'c-1' }) // unidad u-1
    expect(registroCoincide(r, { ...FILTROS_VACIOS, unidad: 'u-1' }, contadores)).toBe(true)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, unidad: 'u-2' }, contadores)).toBe(false)
  })

  it('filtra por tipo de agua vía el contador', () => {
    const r = mkRegistro({ id: 'r-1', contador_id: 'c-1' }) // rehuso
    expect(registroCoincide(r, { ...FILTROS_VACIOS, tipoAgua: 'rehuso' }, contadores)).toBe(true)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, tipoAgua: 'potable' }, contadores)).toBe(false)
  })

  it('filtra por rango de fechas (inclusivo en ambos extremos)', () => {
    const r = mkRegistro({ id: 'r-1', fecha: '2026-06-15' })
    expect(registroCoincide(r, { ...FILTROS_VACIOS, fechaInicio: '2026-06-01', fechaFin: '2026-06-30' }, contadores)).toBe(true)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, fechaInicio: '2026-07-01' }, contadores)).toBe(false)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, fechaFin: '2026-06-10' }, contadores)).toBe(false)
    // el extremo "Hasta" incluye el día completo (hasta 23:59:59)
    expect(registroCoincide(r, { ...FILTROS_VACIOS, fechaFin: '2026-06-15' }, contadores)).toBe(true)
  })

  it('combina varios filtros (AND)', () => {
    const r = mkRegistro({ id: 'r-1', cliente_nombre: 'Ana', contador_id: 'c-1', estado: 'pagado', project_id: 'proj-1' })
    const filtros: HistorialFiltros = { ...FILTROS_VACIOS, texto: 'MED-123', estado: 'pagado', proyecto: 'proj-1', unidad: 'u-1' }
    expect(registroCoincide(r, filtros, contadores)).toBe(true)
    // basta que uno falle para excluir
    expect(registroCoincide(r, { ...filtros, estado: 'mora' }, contadores)).toBe(false)
  })
})

// ── unidadesDelProyecto ───────────────────────────────────────────────────────

describe('unidadesDelProyecto', () => {
  const unidades = [
    mkUnidad({ id: 'u-1', project_id: 'proj-1', nombre: 'Apto 1A' }),
    mkUnidad({ id: 'u-2', project_id: 'proj-2', nombre: 'Casa 7' }),
    mkUnidad({ id: 'u-3', project_id: 'proj-1', nombre: 'Apto 2B' }),
  ]

  it('sin proyecto seleccionado devuelve todas las unidades', () => {
    expect(unidadesDelProyecto(unidades, '')).toHaveLength(3)
  })

  it('recorta a las unidades del proyecto seleccionado', () => {
    const res = unidadesDelProyecto(unidades, 'proj-1')
    expect(res.map(u => u.id)).toEqual(['u-1', 'u-3'])
  })

  it('proyecto sin unidades devuelve lista vacía', () => {
    expect(unidadesDelProyecto(unidades, 'proj-x')).toEqual([])
  })
})

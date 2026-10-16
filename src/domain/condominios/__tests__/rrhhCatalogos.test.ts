import { describe, it, expect } from 'vitest'
import {
  CARGOS_DEFAULT, TURNOS_DEFAULT, RE_CODIGO_CATALOGO,
  slugDesdeNombre, activos, ordenarCatalogo, etiquetaCargo, iconoCargo, etiquetaTurno, iconoTurno,
  opcionesSelect, primerActivo, validarEntradaCatalogo, mensajeErrorCatalogo,
} from '../rrhhCatalogos'
import type { CatalogoRrhhItem } from '../../../types'

function item(over: Partial<CatalogoRrhhItem> = {}): CatalogoRrhhItem {
  return {
    id: 'c1', company_id: 'co1', project_id: 'p1', codigo: 'conserje', nombre: 'Conserje',
    descripcion: null, icono: '🧹', orden: 10, activo: true,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const catalogo = [
  item({ id: 'c1', codigo: 'conserje', nombre: 'Conserje', icono: '🧹', orden: 10 }),
  item({ id: 'c2', codigo: 'jardinero', nombre: 'Jardinero', icono: '🌿', orden: 30, activo: false }),
  item({ id: 'c3', codigo: 'supervisor_piscina', nombre: 'Supervisor/a de piscina', icono: '🏊', orden: 5 }),
]

describe('los defaults son los que siembra la migración', () => {
  it('seis cargos y tres turnos, con códigos válidos', () => {
    expect(CARGOS_DEFAULT.map(c => c.codigo)).toEqual(['conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'])
    expect(TURNOS_DEFAULT.map(t => t.codigo)).toEqual(['diurno', 'nocturno', 'rotativo'])
    for (const d of [...CARGOS_DEFAULT, ...TURNOS_DEFAULT]) expect(d.codigo).toMatch(RE_CODIGO_CATALOGO)
  })
})

describe('slugDesdeNombre — espejo del CHECK del código', () => {
  it('propone un código válido desde el nombre de pantalla', () => {
    expect(slugDesdeNombre('Supervisor de piscina')).toBe('supervisor_de_piscina')
    expect(slugDesdeNombre('  Jardinería / Áreas verdes ')).toBe('jardineria_areas_verdes')
    expect(slugDesdeNombre('--Turno--')).toBe('turno')
    expect(slugDesdeNombre('x'.repeat(60))).toHaveLength(40)
    expect(slugDesdeNombre('')).toBe('')
  })
  it('lo que propone siempre pasa el CHECK (salvo vacío)', () => {
    for (const n of ['Recepcionista', 'Guardia Nocturno 2', 'Ñandú & Co', 'Fin de semana']) {
      expect(slugDesdeNombre(n), n).toMatch(RE_CODIGO_CATALOGO)
    }
  })
})

describe('etiquetas e íconos: catálogo → de siempre → crudo', () => {
  it('resuelve por código normalizado contra el catálogo', () => {
    expect(etiquetaCargo('supervisor_piscina', catalogo)).toBe('Supervisor/a de piscina')
    expect(iconoCargo(' Conserje ', catalogo)).toBe('🧹')
    expect(etiquetaCargo('jardinero', catalogo)).toBe('Jardinero') // inactivo, pero existe
  })
  it('sin catálogo cae a los de siempre; sin nada, al código', () => {
    expect(etiquetaCargo('guardia', [])).toBe('Guardia')
    expect(iconoCargo('guardia')).toBe('💂')
    expect(etiquetaCargo('Polivalente', catalogo)).toBe('Polivalente')
    expect(iconoCargo('Polivalente', catalogo)).toBe('👤')
    expect(etiquetaTurno('nocturno')).toBe('Nocturno')
    expect(iconoTurno('mixto')).toBe('🕐')
    expect(etiquetaCargo(null)).toBe('')
  })
})

describe('activos y orden', () => {
  it('ordena por orden y nombre; activos filtra', () => {
    expect(ordenarCatalogo(catalogo).map(c => c.codigo)).toEqual(['supervisor_piscina', 'conserje', 'jardinero'])
    expect(activos(catalogo).map(c => c.codigo)).toEqual(['supervisor_piscina', 'conserje'])
    expect(primerActivo(catalogo)).toBe('supervisor_piscina')
    expect(primerActivo([])).toBe('conserje')
    expect(primerActivo([], TURNOS_DEFAULT)).toBe('diurno')
  })
})

describe('opcionesSelect — lo que ofrece un <select>', () => {
  it('sólo los activos, en orden, con ícono', () => {
    const o = opcionesSelect(catalogo)
    expect(o.map(x => x.value)).toEqual(['supervisor_piscina', 'conserje'])
    expect(o[0].label).toBe('🏊 Supervisor/a de piscina')
  })
  it('el valor actual inactivo se agrega al final marcado «(inactivo)»', () => {
    const o = opcionesSelect(catalogo, 'jardinero')
    expect(o.at(-1)).toMatchObject({ value: 'jardinero', inactivo: true, historico: false })
    expect(o.at(-1)!.label).toBe('🌿 Jardinero (inactivo)')
  })
  it('el valor actual fuera del catálogo se agrega como «(histórico)»', () => {
    const o = opcionesSelect(catalogo, 'Polivalente')
    expect(o.at(-1)).toMatchObject({ value: 'Polivalente', historico: true, label: 'Polivalente (histórico)' })
    // Un código de siempre que el condominio borró: se nombra con su etiqueta de siempre.
    expect(opcionesSelect(catalogo, 'otro').at(-1)!.label).toBe('Otro (histórico)')
  })
  it('sin catálogo ofrece los de siempre (entorno sin la migración)', () => {
    expect(opcionesSelect([]).map(o => o.value)).toEqual(CARGOS_DEFAULT.map(c => c.codigo))
    expect(opcionesSelect([], 'diurno', TURNOS_DEFAULT).map(o => o.value)).toEqual(['diurno', 'nocturno', 'rotativo'])
  })
  it('el valor actual activo no se duplica', () => {
    expect(opcionesSelect(catalogo, 'conserje')).toHaveLength(2)
  })
})

describe('validarEntradaCatalogo — lo que la BD va a rechazar, dicho antes', () => {
  it('acepta una entrada nueva válida', () => {
    expect(validarEntradaCatalogo({ codigo: 'recepcionista', nombre: 'Recepcionista', orden: 70 }, catalogo)).toBeNull()
  })
  it('nombre corto o largo, código mal formado, orden negativo', () => {
    expect(validarEntradaCatalogo({ codigo: 'x1', nombre: 'X' }, catalogo)).toMatch(/entre 2 y 60/)
    expect(validarEntradaCatalogo({ codigo: 'Mal Código', nombre: 'Mal código' }, catalogo)).toMatch(/minúsculas/)
    expect(validarEntradaCatalogo({ codigo: '_x', nombre: 'Equis' }, catalogo)).toMatch(/minúsculas/)
    expect(validarEntradaCatalogo({ codigo: 'neg', nombre: 'Negativo', orden: -1 }, catalogo)).toMatch(/mayor o igual a 0/)
  })
  it('código repetido (incluso inactivo) y nombre repetido normalizado', () => {
    expect(validarEntradaCatalogo({ codigo: 'jardinero', nombre: 'Jardinero 2' }, catalogo)).toMatch(/Ya existe el código «jardinero» \(Jardinero, inactivo\)/)
    expect(validarEntradaCatalogo({ codigo: 'conserje2', nombre: '  CONSERJE ' }, catalogo)).toMatch(/Ya existe «Conserje»/)
  })
  it('renombrar sin chocar consigo mismo', () => {
    expect(validarEntradaCatalogo({ codigo: 'conserje', nombre: 'Conserje' }, catalogo, 'c1')).toBeNull()
  })
})

describe('mensajeErrorCatalogo — SQLSTATE y prefijos de la migración', () => {
  it('en uso (23503) muestra el detalle del trigger', () => {
    const m = mensajeErrorCatalogo({ code: '23503', message: 'RRHH_CARGO_EN_USO: el cargo "jardinero" lo usan 1 empleado(s), 0 actividad(es) y 1 programación(es): desactívalo en vez de borrarlo' })
    expect(m).toBe('Está en uso: el cargo "jardinero" lo usan 1 empleado(s), 0 actividad(es) y 1 programación(es): desactívalo en vez de borrarlo')
  })
  it('duplicado, inmutable, forma, permiso, valor fuera del catálogo', () => {
    expect(mensajeErrorCatalogo({ code: '23505', message: 'duplicate key' }, 'turno')).toMatch(/Ya existe un tipo de turno/)
    expect(mensajeErrorCatalogo({ code: '23514', message: 'RRHH_CATALOGO_INMUTABLE: el código…' })).toMatch(/no se cambian/)
    expect(mensajeErrorCatalogo({ code: '23514', message: 'new row violates check constraint' })).toMatch(/Revisa el código/)
    expect(mensajeErrorCatalogo({ code: '42501', message: 'permission denied' }, 'cargo')).toMatch(/permiso.*cargos/)
    expect(mensajeErrorCatalogo({ code: '23514', message: 'RRHH_CARGO: el cargo "portero" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)' }))
      .toBe('el cargo "portero" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)')
    expect(mensajeErrorCatalogo({ message: 'otra cosa' })).toBe('otra cosa')
  })
})

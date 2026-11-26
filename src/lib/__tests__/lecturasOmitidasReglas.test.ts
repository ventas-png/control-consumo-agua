import { describe, it, expect } from 'vitest'
import {
  validarOmision, fotoObligatoria, rutaDePendientes, esRutaDePendientes,
  diasPendiente, etiquetaMotivo, PREFIJO_RUTA_PENDIENTES,
} from '../lecturasOmitidasReglas'

describe('validarOmision — lo que la pantalla exige antes de mandar', () => {
  it('sin motivo no se puede saltar', () => {
    expect(validarOmision({ motivo: '', detalle: '', tieneFoto: true })).toMatch(/motivo/)
  })

  it('la foto es obligatoria salvo cuando acercarse es el riesgo', () => {
    expect(validarOmision({ motivo: 'acceso_obstruido', detalle: '', tieneFoto: false })).toMatch(/foto/)
    expect(validarOmision({ motivo: 'acceso_obstruido', detalle: '', tieneFoto: true })).toBeNull()
    expect(validarOmision({ motivo: 'riesgo_seguridad', detalle: '', tieneFoto: false })).toBeNull()
    expect(fotoObligatoria('riesgo_seguridad')).toBe(false)
    expect(fotoObligatoria('propiedad_cerrada')).toBe(true)
    expect(fotoObligatoria('')).toBe(false)
  })

  it('«otro» pide explicarlo (como exige el servidor)', () => {
    expect(validarOmision({ motivo: 'otro', detalle: '  ab ', tieneFoto: true })).toMatch(/detalle/)
    expect(validarOmision({ motivo: 'otro', detalle: 'Portón con candado', tieneFoto: true })).toBeNull()
  })
})

describe('rutaDePendientes — retomar las lecturas que faltaron', () => {
  const ahora = new Date('2026-11-25T10:00:00Z')

  it('arma una ruta por contadores, sin repetir y sólo con las que tienen contador', () => {
    const ruta = rutaDePendientes(
      [{ contador_id: 'c1' }, { contador_id: null }, { contador_id: 'c2' }, { contador_id: 'c1' }],
      'Pendientes', ahora,
    )
    expect(ruta).toMatchObject({
      tipo_ruta: 'contadores', contador_ids: ['c1', 'c2'], nombre: 'Pendientes',
      completada: false, frecuencia: 'unica', project_id: null,
    })
    expect(ruta!.id).toBe(`${PREFIJO_RUTA_PENDIENTES}${ahora.getTime()}`)
    expect(esRutaDePendientes(ruta)).toBe(true)
  })

  it('sin contadores no hay ruta que recorrer', () => {
    expect(rutaDePendientes([{ contador_id: null }], 'x', ahora)).toBeNull()
  })

  it('una ruta de la base nunca se confunde con una de pendientes', () => {
    expect(esRutaDePendientes({ id: '40000000-0000-0000-0000-000000000001' })).toBe(false)
    expect(esRutaDePendientes(null)).toBe(false)
  })
})

describe('diasPendiente y etiquetas', () => {
  it('cuenta días completos y nunca negativos', () => {
    const ahora = new Date('2026-11-25T12:00:00Z')
    expect(diasPendiente('2026-11-25T08:00:00Z', ahora)).toBe(0)
    expect(diasPendiente('2026-11-22T11:00:00Z', ahora)).toBe(3)
    expect(diasPendiente('2026-11-26T08:00:00Z', ahora)).toBe(0)
  })

  it('traduce el motivo, y deja tal cual uno desconocido', () => {
    expect(etiquetaMotivo('acceso_obstruido')).toBe('Contador obstruido')
    expect(etiquetaMotivo('nuevo_motivo')).toBe('nuevo_motivo')
  })
})

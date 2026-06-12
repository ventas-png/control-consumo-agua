import { describe, it, expect } from 'vitest'
import { estimarTotalMensualCents, proyectarTotalConLimitesCents } from '../businessBilling'

// Precios del seed real (20260528000060): bundle $15 base, $10/proyecto extra,
// $1/unidad principal, $0.80/unidad adicional.
const bundle = {
  base_activation_cents: 1500,
  extra_project_cents: 1000,
  unit_primary_cents: 100,
  unit_extra_cents: 80,
}

describe('estimarTotalMensualCents', () => {
  it('replica el caso real del reporte: 6 proyectos, 22 primarias + 62 extra = $136.60', () => {
    expect(estimarTotalMensualCents(bundle, 6, 22, 62)).toBe(13660)
  })

  it('1 proyecto no cobra proyectos extra', () => {
    expect(estimarTotalMensualCents(bundle, 1, 10, 0)).toBe(1500 + 1000 * 0 + 10 * 100)
  })

  it('0 proyectos no produce extra negativo', () => {
    expect(estimarTotalMensualCents(bundle, 0, 0, 0)).toBe(1500)
  })
})

describe('proyectarTotalConLimitesCents', () => {
  it('con 1 proyecto, todas las unidades del límite son primarias', () => {
    expect(proyectarTotalConLimitesCents(bundle, 1, 100, 22)).toBe(
      estimarTotalMensualCents(bundle, 1, 100, 0),
    )
  })

  it('con varios proyectos, las unidades nuevas se estiman a tarifa extra', () => {
    // límite 400 unidades, hoy 22 primarias → 22 a $1 + 378 a $0.80
    expect(proyectarTotalConLimitesCents(bundle, 6, 400, 22)).toBe(
      estimarTotalMensualCents(bundle, 6, 22, 378),
    )
  })

  it('si el límite es menor que las primarias actuales, se acota', () => {
    expect(proyectarTotalConLimitesCents(bundle, 3, 10, 22)).toBe(
      estimarTotalMensualCents(bundle, 3, 10, 0),
    )
  })
})

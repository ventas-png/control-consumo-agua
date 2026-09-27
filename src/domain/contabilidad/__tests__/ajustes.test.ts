// Reglas de pantalla de las solicitudes de ajuste (20261011000000). El
// servidor las vuelve a aplicar (supabase/tests/conta_ajustes); aquí se fija
// que la pantalla no ofrezca lo que el servidor rechazaría.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

import { accionesSolicitud, textoSolicitudEnviada } from '../ajustes'

const YO = 'u-yo'
const OTRO = 'u-otro'

describe('accionesSolicitud · E1 (cuatro ojos, autoaprobación sólo del dueño)', () => {
  it('la solicitud de otra persona la aprueba quien tiene permiso', () => {
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: OTRO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(a).toMatchObject({ aprobar: true, autoaprobar: false, rechazar: true, cancelar: false })
  })

  it('la propia NO la aprueba un admin (ni con permiso)', () => {
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(a.aprobar).toBe(false)
    expect(a.autoaprobar).toBe(false)
    expect(a.cancelar).toBe(true)
  })

  it('la propia sólo la autoaprueba el company_owner (con confirmación en la pantalla)', () => {
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'company_owner', puedeAprobar: true })
    expect(a).toMatchObject({ aprobar: false, autoaprobar: true })
  })

  it('no hay excepción por «único aprobador»: sin rol de dueño, la propia no se aprueba', () => {
    // Un usuario que es el único con permiso de aprobar en su empresa.
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'operator', puedeAprobar: true })
    expect(a.aprobar || a.autoaprobar).toBe(false)
  })

  it('sin permiso de aprobar no hay aprobar, rechazar ni reintentar', () => {
    const a = accionesSolicitud({ estado: 'fallida', solicitado_por: OTRO, autoaprobada: false },
      { userId: YO, rol: 'operator', puedeAprobar: false })
    expect(a).toEqual({ aprobar: false, autoaprobar: false, rechazar: false, reintentar: false, cancelar: false })
  })

  it('fallida: reintenta otra persona; quien la pidió, sólo si fue su autoaprobación', () => {
    const otro = accionesSolicitud({ estado: 'fallida', solicitado_por: OTRO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(otro.reintentar).toBe(true)
    const propia = accionesSolicitud({ estado: 'fallida', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(propia.reintentar).toBe(false)
    const autoaprobada = accionesSolicitud({ estado: 'fallida', solicitado_por: YO, autoaprobada: true },
      { userId: YO, rol: 'company_owner', puedeAprobar: true })
    expect(autoaprobada.reintentar).toBe(true)
  })

  it('ejecutada, rechazada o cancelada: sin acciones (no vencen ni se reabren)', () => {
    for (const estado of ['ejecutada', 'rechazada', 'cancelada'] as const) {
      const a = accionesSolicitud({ estado, solicitado_por: YO, autoaprobada: false },
        { userId: YO, rol: 'company_owner', puedeAprobar: true })
      expect(Object.values(a).some(Boolean)).toBe(false)
    }
  })
})

describe('textoSolicitudEnviada', () => {
  it('deja claro que nada cambia hasta la aprobación', () => {
    expect(textoSolicitudEnviada({ solicitud_id: 's', estado: 'pendiente', repetida: false })).toMatch(/Nada cambia hasta que otra persona/)
    expect(textoSolicitudEnviada({ solicitud_id: 's', estado: 'pendiente', repetida: true })).toMatch(/ya estaba registrada/)
  })
})

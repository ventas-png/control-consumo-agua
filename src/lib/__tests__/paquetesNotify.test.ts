// Contrato de "¿el aviso llegó de verdad?".
//
// La edge function responde 200 aunque no haya entregado nada (residente sin
// correo ni teléfono, canales caídos). Tratar ese 200 como éxito era lo que
// hacía que la UI dijera "Se avisó al residente" sin haber avisado a nadie.
import { describe, it, expect, vi } from 'vitest'

// El módulo importa el cliente de Supabase al cargarse (lanza sin env vars);
// `avisoEntregado` es lógica pura y no lo usa.
vi.mock('../supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: {} }) } } }))

import { avisoEntregado } from '../paquetesNotify'

describe('avisoEntregado', () => {
  it('respeta el veredicto del servidor cuando viene', () => {
    expect(avisoEntregado({ delivered: true })).toBe(true)
    expect(avisoEntregado({ delivered: false })).toBe(false)
  })

  it('el flag del servidor manda sobre los contadores', () => {
    // Si el servidor dice que no entregó, no lo contradecimos con aritmética.
    expect(avisoEntregado({ delivered: false, notified: 3 })).toBe(false)
  })

  it('sin flag (edge function anterior) lo deriva de los canales', () => {
    expect(avisoEntregado({ notified: 1 })).toBe(true)
    expect(avisoEntregado({ emailed: 1 })).toBe(true)
    expect(avisoEntregado({ whatsapp: 'sent' })).toBe(true)
  })

  it('cero canales entregados NO es entrega, aunque la llamada haya ido bien', () => {
    expect(avisoEntregado({ success: true, notified: 0, emailed: 0, whatsapp: 'not_configured' })).toBe(false)
    expect(avisoEntregado({ notified: 0, emailed: 0, whatsapp: 'error' })).toBe(false)
    expect(avisoEntregado({})).toBe(false)
  })

  it('un skip del servidor tampoco es entrega', () => {
    expect(avisoEntregado({ success: true, skipped: 'no_cliente' })).toBe(false)
    expect(avisoEntregado({ success: true, skipped: 'already_notified' })).toBe(false)
  })
})

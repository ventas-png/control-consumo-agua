// com:N4 — Agregador puro de stats de entrega de emails por comunicado: mapea
// los estados del ciclo de vida de notifications_outbox (queued/sending → sent/
// delivered → read | bounced | failed/suppressed) a los contadores que muestra
// la tarjeta de difusión. Sin I/O: la query vive en fetchBroadcastEmailStats.
import { describe, it, expect, vi } from 'vitest'

// broadcasts.ts importa lib/supabase a nivel de módulo (para las funciones con
// I/O); el agregador es puro, así que basta un stub vacío.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

import { computeEmailStatsByBroadcast } from '../broadcasts'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'

describe('comunicacion/computeEmailStatsByBroadcast', () => {
  it('clasifica cada estado del outbox en su contador', () => {
    const stats = computeEmailStatsByBroadcast([
      { status: 'queued', broadcast_id: A },
      { status: 'sending', broadcast_id: A },
      { status: 'sent', broadcast_id: A },
      { status: 'delivered', broadcast_id: A },
      { status: 'read', broadcast_id: A },
      { status: 'bounced', broadcast_id: A },
      { status: 'failed', broadcast_id: A },
      { status: 'suppressed', broadcast_id: A },
    ])
    expect(stats[A]).toEqual({
      pendientes: 2,   // queued + sending
      enviados: 3,     // sent + delivered + read (aceptados por Gmail)
      abiertos: 1,     // read (píxel)
      rebotados: 1,
      fallidos: 2,     // failed + suppressed
    })
  })

  it('un read cuenta como enviado Y abierto (no doble-descuenta)', () => {
    const stats = computeEmailStatsByBroadcast([{ status: 'read', broadcast_id: A }])
    expect(stats[A].enviados).toBe(1)
    expect(stats[A].abiertos).toBe(1)
  })

  it('separa por broadcast y no cruza contadores', () => {
    const stats = computeEmailStatsByBroadcast([
      { status: 'sent', broadcast_id: A },
      { status: 'bounced', broadcast_id: B },
    ])
    expect(stats[A]).toEqual({ pendientes: 0, enviados: 1, abiertos: 0, rebotados: 0, fallidos: 0 })
    expect(stats[B]).toEqual({ pendientes: 0, enviados: 0, abiertos: 0, rebotados: 1, fallidos: 0 })
  })

  it('ignora filas sin broadcast_id y estados desconocidos (forward-compat)', () => {
    const stats = computeEmailStatsByBroadcast([
      { status: 'sent', broadcast_id: null },
      { status: 'estado_nuevo_futuro', broadcast_id: A },
    ])
    expect(stats[A]).toEqual({ pendientes: 0, enviados: 0, abiertos: 0, rebotados: 0, fallidos: 0 })
    expect(Object.keys(stats)).toEqual([A])
  })

  it('lista vacía → objeto vacío (la UI muestra el chip plano "Email")', () => {
    expect(computeEmailStatsByBroadcast([])).toEqual({})
  })
})

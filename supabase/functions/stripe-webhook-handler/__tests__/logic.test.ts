// Tests de la lógica pura de stripe-webhook-handler. Corre bajo vitest (no
// Deno), tratando el módulo como TS normal.
//
// ANTES estas pruebas cubrían `buildPagoRow`: qué fila de `pagos` armaba el
// webhook a mano. Esa función ya no existe, y su desaparición es el arreglo —
// construir el pago aquí dejaba el cobro registrado y el recibo con el saldo
// íntegro, porque nadie acreditaba nada. Ahora eso lo hace
// `conciliar_pago_externo` en una sola transacción.
//
// Lo que queda para el edge, y es lo que se prueba, es EL CÓDIGO HTTP. No es
// cosmético: Stripe reintenta ante cualquier respuesta que no sea 2xx, así que
// un 200 significa «no me lo traigas más». Esa frase sólo es cierta cuando el
// evento se procesó entero, y distinguir eso de «alguien lo tiene en vuelo» es
// justo lo que separaba un reintento sano de un cobro perdido en silencio.

import { describe, it, expect } from 'vitest'
import {
  decidirCruceDeEmpresa,
  decidirTrasConciliar,
  decidirTrasReclamo,
} from '../logic.ts'

describe('decidirTrasReclamo', () => {
  it('si el evento se reclamó, hay que procesarlo', () => {
    expect(decidirTrasReclamo({ reclamado: true, ya_completado: false }))
      .toEqual({ accion: 'procesar' })
  })

  it('duplicado de un evento YA COMPLETADO: 200 y no se re-aplica', () => {
    const d = decidirTrasReclamo({ reclamado: false, ya_completado: true })
    expect(d).toMatchObject({ accion: 'responder', status: 200 })
    expect(d.accion === 'responder' && d.body.already_processed).toBe(true)
  })

  it('duplicado de un evento SIN completar: 409 reintentable, NO 200', () => {
    // Es la invariante de este PR. El handler viejo respondía 200 a cualquier
    // duplicado, así que un evento reclamado y luego caído quedaba marcado como
    // visto para siempre: Stripe dejaba de reintentarlo y el cobro nunca se
    // acreditaba. Un 200 aquí es la forma de perder un pago sin que salte nada.
    const d = decidirTrasReclamo({
      reclamado: false, ya_completado: false, estado_previo: 'procesando',
    })
    expect(d).toMatchObject({ accion: 'responder', status: 409 })
    expect(d.accion === 'responder' && d.body.retryable).toBe(true)
    expect(d.accion === 'responder' && d.body.already_processed).toBeUndefined()
  })

  it('un estado previo "fallido" que no se pudo re-reclamar tampoco da 200', () => {
    const d = decidirTrasReclamo({
      reclamado: false, ya_completado: false, estado_previo: 'fallido',
    })
    expect(d).toMatchObject({ accion: 'responder', status: 409 })
  })
})

describe('decidirTrasConciliar', () => {
  it('conciliación correcta: 200 con el pago, si liquidó y el saldo', () => {
    const d = decidirTrasConciliar(
      { ok: true, pago_id: 'pago-1', liquidado: true, saldo_restante: 0 }, null,
    )
    expect(d).toMatchObject({ accion: 'responder', status: 200 })
    expect(d.accion === 'responder' && d.body).toMatchObject({
      received: true, conciliado: true, pago_id: 'pago-1', liquidado: true, saldo_restante: 0,
    })
  })

  it('abono parcial: liquidado false y el saldo que queda', () => {
    const d = decidirTrasConciliar(
      { ok: true, pago_id: 'pago-2', liquidado: false, saldo_restante: 45.5 }, null,
    )
    expect(d.accion === 'responder' && d.body).toMatchObject({
      liquidado: false, saldo_restante: 45.5,
    })
  })

  it('la RPC dice ya_conciliado: 200 y se marca already_processed', () => {
    const d = decidirTrasConciliar(
      { ok: true, ya_conciliado: true, pago_id: 'pago-3', liquidado: true, saldo_restante: 0 }, null,
    )
    expect(d).toMatchObject({ accion: 'responder', status: 200 })
    expect(d.accion === 'responder' && d.body.already_processed).toBe(true)
  })

  it('fallo al conciliar: 500 REINTENTABLE, nunca 200', () => {
    // El dinero ya salió de la tarjeta y la transacción revirtió entera: no hay
    // nada escrito a medias, sólo un cobro sin acreditar. Que Stripe lo traiga
    // de nuevo es exactamente lo que se quiere.
    const d = decidirTrasConciliar(null, { message: 'deadlock detected' })
    expect(d).toMatchObject({ accion: 'responder', status: 500 })
    expect(d.accion === 'responder' && d.body.retryable).toBe(true)
    expect(d.accion === 'responder' && String(d.body.error)).toContain('deadlock detected')
  })

  it('un cuerpo vacío de la RPC no se lee como liquidado', () => {
    const d = decidirTrasConciliar(null, null)
    expect(d.accion === 'responder' && d.body).toMatchObject({
      liquidado: false, saldo_restante: 0, pago_id: null,
    })
  })
})

describe('decidirCruceDeEmpresa', () => {
  it('misma empresa: se procesa', () => {
    expect(decidirCruceDeEmpresa('co-1', 'co-1')).toEqual({ accion: 'procesar' })
  })

  it('empresa distinta: 400 y NO reintentable', () => {
    // Sin esto, el secreto de webhook de la empresa A serviría para conciliar
    // un cobro de la empresa B. Y no es reintentable: reenviarlo daría igual.
    const d = decidirCruceDeEmpresa('co-1', 'co-2')
    expect(d).toMatchObject({ accion: 'responder', status: 400 })
    expect(d.accion === 'responder' && d.body.retryable).toBe(false)
  })
})

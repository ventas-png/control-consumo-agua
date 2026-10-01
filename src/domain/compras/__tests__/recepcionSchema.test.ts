// Esquema de la recepción por línea (Bloque B): aceptado / rechazado / motivo.
import { describe, expect, it } from 'vitest'
import { recepcionFormSchema } from '../schemas'

const LINEA = '3f2c1a9e-8d4b-4e6a-9b1c-2a7d5e8f0c11'
const ORDEN = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

const base = (lineas: unknown[]) => ({
  orden_compra_id: ORDEN, fecha: '2026-10-01', documento_referencia: null, notas: null, lineas,
})

describe('recepcionFormSchema', () => {
  it('acepta una recepción parcial con lo rechazado y su motivo', () => {
    const r = recepcionFormSchema.safeParse(base([
      { orden_compra_linea_id: LINEA, cantidad: 40, cantidad_rechazada: 5, motivo_rechazo: 'Envases dañados', observacion: null },
    ]))
    expect(r.success).toBe(true)
  })

  it('lo rechazado sin motivo no pasa', () => {
    const r = recepcionFormSchema.safeParse(base([
      { orden_compra_linea_id: LINEA, cantidad: 40, cantidad_rechazada: 5, observacion: null },
    ]))
    expect(r.success).toBe(false)
    expect(JSON.stringify(r)).toMatch(/motivo/i)
  })

  it('una entrega totalmente rechazada (aceptado 0) sí es válida: queda constancia', () => {
    const r = recepcionFormSchema.safeParse(base([
      { orden_compra_linea_id: LINEA, cantidad: 0, cantidad_rechazada: 10, motivo_rechazo: 'No cumple la especificación', observacion: null },
    ]))
    expect(r.success).toBe(true)
  })

  it('un renglón sin aceptado ni rechazado no pasa', () => {
    const r = recepcionFormSchema.safeParse(base([
      { orden_compra_linea_id: LINEA, cantidad: 0, observacion: null },
    ]))
    expect(r.success).toBe(false)
  })

  it('el tipo por defecto es bienes y admite conformidad de servicio con su clave de idempotencia', () => {
    const b = recepcionFormSchema.parse(base([{ orden_compra_linea_id: LINEA, cantidad: 1, observacion: null }]))
    expect(b.tipo).toBe('bienes')
    const s = recepcionFormSchema.parse({
      ...base([{ orden_compra_linea_id: LINEA, cantidad: 1, observacion: null }]),
      tipo: 'servicio', clave_idempotencia: 'abc-123',
    })
    expect(s.tipo).toBe('servicio')
    expect(s.clave_idempotencia).toBe('abc-123')
  })

  it('un tipo desconocido no pasa', () => {
    const r = recepcionFormSchema.safeParse({ ...base([{ orden_compra_linea_id: LINEA, cantidad: 1, observacion: null }]), tipo: 'otro' })
    expect(r.success).toBe(false)
  })
})

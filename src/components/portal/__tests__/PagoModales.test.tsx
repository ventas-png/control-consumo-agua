import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Registro, UserSession } from '../../../types'

const h = vi.hoisted(() => ({
  iniciarPagoRegistro: vi.fn(),
  confirmarPago: vi.fn(),
  createPago: vi.fn(),
  uploadComprobantePago: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/portal/mutations', () => ({
  iniciarPagoRegistro: h.iniciarPagoRegistro,
  confirmarPago: h.confirmarPago,
}))
vi.mock('../../../domain/cobros/mutations', () => ({
  createPago: h.createPago,
  uploadComprobantePago: h.uploadComprobantePago,
}))

const { PagoEnLineaModal } = await import('../PagoEnLineaModal')
const { PagoManualModal } = await import('../PagoManualModal')

const registro = {
  id: 'r1', fecha: '2026-10-14', consumo: 12, monto_calculado: 100, monto_pagado: 0,
  tarifa_aplicada: 5, canon_aplicado: 20, estado: 'pendiente',
} as unknown as Registro

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
})
afterEach(cleanup)

describe('PagoEnLineaModal', () => {
  it('es la ventana compartida: pantalla completa en el teléfono y Esc la cierra', () => {
    const onClose = vi.fn()
    render(<PagoEnLineaModal registro={registro} moneda="Q" onClose={onClose} onPagado={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: '💳 Pagar en línea' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(screen.getByLabelText(/Monto a Pagar/)).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mientras procesa el cobro no se puede cerrar', async () => {
    h.iniciarPagoRegistro.mockReturnValue(new Promise(() => {})) // cobro en curso
    const onClose = vi.fn()
    render(<PagoEnLineaModal registro={registro} moneda="Q" onClose={onClose} onPagado={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '💳 Pagar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '⏳ Procesando...' })).toBeDefined())
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('Cerrar modal'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('PagoManualModal', () => {
  const currentUser = { user_id: 'u1', role: 'cliente', name: 'Ana' } as unknown as UserSession

  it('cada campo tiene su etiqueta y no registra sin comprobante', async () => {
    render(<PagoManualModal registro={registro} moneda="Q" currentUser={currentUser} onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByRole('dialog', { name: '📄 Registrar pago' })).toBeDefined()
    fireEvent.change(screen.getByLabelText(/Monto Pagado/), { target: { value: '50' } })
    expect(screen.getByLabelText(/Forma de Pago/)).toBeDefined()
    expect(screen.getByLabelText(/Banco \/ Referencia/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '📤 Registrar Pago' }))
    await waitFor(() => expect(h.createPago).not.toHaveBeenCalled())
    expect(screen.getByLabelText(/Número de Comprobante/)).toBeDefined()
  })
})

// Total de la factura de energía: se deriva del desglose en vivo y es lo que se
// guarda. Antes solo lo llenaba "Calcular desde tarifa" (una factura capturada
// a mano se guardaba con total 0) y ese cálculo copiaba `subtotal`, que no es
// columna de facturas_energia, así que guardar después de calcular fallaba.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { FacturaEnergia, FuenteEnergia, TarifaEnergia } from '../../../types'

vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn() }))

const { default: FacturaEnergiaModal } = await import('../FacturaEnergiaModal')

const tarifa = {
  id: 't1', nombre: 'BT1', precio_kwh_energia: 1.234567, precio_kw_potencia: 0, cargo_fijo: 12.5,
  alumbrado_publico: 13, alumbrado_tipo: 'porcentual', iva_porcentaje: 12, precio_kwh_exportado: 0.8, moneda: 'Q',
} as unknown as TarifaEnergia
const fuentes = [
  { id: 'solar', nombre: 'Paneles casa club', modo_suministro: 'solar_autonomo', tarifa_id: null },
  { id: 'hibrida', nombre: 'Bomba pozo norte', modo_suministro: 'hibrido', tarifa_id: 't1' },
] as unknown as FuenteEnergia[]

/** Campo por el texto de su etiqueta (etiqueta y campo comparten contenedor). */
function campo(etiqueta: string | RegExp) {
  const label = screen.getByText(etiqueta, { selector: 'label' })
  const control = label.parentElement!.querySelector('input, select, textarea')
  if (!control) throw new Error(`Sin campo para ${String(etiqueta)}`)
  return control as HTMLInputElement
}
const escribir = (etiqueta: string | RegExp, valor: string) => fireEvent.change(campo(etiqueta), { target: { value: valor } })
const totalMostrado = () => screen.getByRole('status', { name: 'Total de la factura' }).textContent

function abrir(factura: Partial<FacturaEnergia> = {}) {
  const onSave = vi.fn(async (_f: Partial<FacturaEnergia>) => {})
  render(
    <FacturaEnergiaModal
      factura={factura}
      fuentesEnergia={fuentes}
      facturasEnergia={[]}
      tarifasEnergia={[tarifa]}
      proveedoresEnergia={[]}
      moneda="Q"
      isEditing={!!factura.id}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  )
  return onSave
}

function datosBase(fuente: string) {
  escribir(/Fuente de Energía/, fuente)
  escribir(/Período inicio/, '2026-09-01')
  escribir(/Período fin/, '2026-09-30')
}

async function guardar(onSave: ReturnType<typeof abrir>) {
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  return onSave.mock.calls[0][0]
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('FacturaEnergiaModal — total', () => {
  it('capturada a mano: el total sigue al desglose y se guarda (el crédito resta)', async () => {
    const onSave = abrir()
    datosBase('solar')
    expect(totalMostrado()).toBe('Q 0.00')

    escribir('Energía', '100')
    escribir('IVA', '12')
    expect(totalMostrado()).toBe('Q 112.00')
    escribir('Otros', '5')
    escribir('Crédito exportación', '20')
    expect(totalMostrado()).toBe('Q 97.00')

    const guardado = await guardar(onSave)
    expect(guardado.monto_total).toBe(97)
    // El crédito se guarda en negativo, como lo deja el cálculo desde tarifa.
    expect(guardado.monto_credito_exportacion).toBe(-20)
  })

  it('desde tarifa: montos a centavos, total del desglose y sin `subtotal` al guardar', async () => {
    const onSave = abrir()
    datosBase('hibrida')
    escribir('Consumidos', '100')
    escribir('Exportados', '10')
    fireEvent.click(screen.getByRole('button', { name: /Calcular desde tarifa/ }))

    // energía 123.4567 → 123.46; alumbrado 13% de 135.9567 → 17.67;
    // crédito −8; IVA 12% de 145.631071 → 17.48.
    expect(campo('Energía').value).toBe('123.46')
    expect(campo('Alumbrado').value).toBe('17.67')
    expect(campo('IVA').value).toBe('17.48')
    expect(totalMostrado()).toBe('Q 163.11')

    // Ajustar un monto a mano (la factura real manda) mueve el total.
    escribir('Otros', '1.5')
    expect(totalMostrado()).toBe('Q 164.61')

    const guardado = await guardar(onSave)
    expect('subtotal' in guardado).toBe(false)
    expect(guardado.monto_total).toBe(164.61)
    expect(guardado.monto_credito_exportacion).toBe(-8)
  })

  it('al editar una factura guardada con total 0, se guarda el total del desglose', async () => {
    const onSave = abrir({
      id: 'fe1', fuente_energia_id: 'solar', periodo_inicio: '2026-08-01', periodo_fin: '2026-08-31',
      kwh_consumidos: 50, monto_energia: 200, monto_iva: 24, monto_total: 0, estado: 'pendiente',
    })
    expect(totalMostrado()).toBe('Q 224.00')
    const guardado = await guardar(onSave)
    expect(guardado.monto_total).toBe(224)
  })
})

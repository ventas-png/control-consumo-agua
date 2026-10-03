// Seguimiento del contrato y selector del contrato de una orden.
//
// Se fija lo que una persona VE: contratado, comprometido, recibido, facturado y pagado como indicadores
// DISTINTOS, cada moneda aparte, «sin límite total» cuando el contrato no tiene monto máximo (sin inventar un total)
// y, para quien no ve Contabilidad, que facturas y pagos no aparecen. Quién ve qué lo decide el servidor
// (supabase/tests/compras_bloque_b/assert_contratos_compras.sql); la pantalla muestra lo que le llega.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const q = vi.hoisted(() => ({ contratos: [] as unknown[] }))
vi.mock('../../../domain/proveedores/contratosCompras', async (orig) => ({
  ...(await orig<typeof import('../../../domain/proveedores/contratosCompras')>()),
  useContratosParaOrdenQuery: () => ({ data: q.contratos, isLoading: false }),
}))

import { SeguimientoContratoContenido } from '../ContratoSeguimientoModal'
import { ContratoSelector } from '../ContratoSelector'
import type { ContratoProveedorCatalogo, SeguimientoContrato } from '../../../types/proveedores'

afterEach(cleanup)
beforeEach(() => { q.contratos = [] })

function seg(extra: Partial<SeguimientoContrato> = {}, contrato: Partial<SeguimientoContrato['contrato']> = {}): SeguimientoContrato {
  return {
    contrato: {
      id: 'c1', referencia: 'CT-01', estado: 'activo', vigente: true, modalidad: 'por_demanda', periodicidad: null, moneda: 'GTQ',
      importe_periodico: null, fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', indefinido: false,
      monto_maximo_original: 1000, ampliaciones_total: 1000, monto_maximo_vigente: 2000, sin_limite_total: false, renovado_de: null,
      proveedor: { id: 'p1', codigo: 'PRV-00001', nombre: 'Ferretería Norte', estado: 'autorizado' }, ...contrato,
    },
    contabilidad_visible: true,
    por_moneda: [
      { moneda: 'GTQ', ordenes: 2, comprometido: 1400, recibido: 600, facturado: 672, pagado: 300, pendiente_por_recibir: 800,
        pendiente_por_facturar: 400, diferencia_precio_facturada: 10, monto_maximo_vigente: 2000, disponible: 600 },
      { moneda: 'USD', ordenes: 1, comprometido: 112, recibido: 100, facturado: 112, pagado: 0, pendiente_por_recibir: 0,
        pendiente_por_facturar: 0, diferencia_precio_facturada: 0, monto_maximo_vigente: null, disponible: null },
    ],
    ordenes: [
      { id: 'o1', numero: 'OC-000001', concepto: 'Material', estado: 'emitida', moneda: 'GTQ', revision: 0, created_at: '2026-02-01', valor_orden: 600,
        compromete: true, comprometido: 600, recibido: 600, facturado: 672, pagado: 300, pendiente_por_recibir: 0, pendiente_por_facturar: 0,
        diferencia_precio_facturada: 10, con_excepcion: true },
      { id: 'o2', numero: 'OC-000002', concepto: 'Borrador', estado: 'borrador', moneda: 'GTQ', revision: 0, created_at: '2026-02-02', valor_orden: 300,
        compromete: false, comprometido: 0, recibido: 0, facturado: 0, pagado: 0, pendiente_por_recibir: 0, pendiente_por_facturar: 0,
        diferencia_precio_facturada: 0, con_excepcion: false },
    ],
    recepciones: [{ id: 'r1', numero: 'REC-1', fecha: '2026-03-01', tipo: 'bienes', estado: 'registrada', orden_id: 'o1', orden_numero: 'OC-000001', aceptado: 6, rechazado: 0 }],
    facturas: [{ id: 'f1', numero_factura: 'F-1', fecha_emision: '2026-03-02', estado: 'aprobada', moneda: 'GTQ', monto_total: 672, monto_pagado: 300, saldo: 372, orden_id: 'o1', orden_numero: 'OC-000001' }],
    pagos: [{ id: 'g1', numero_factura: 'F-1', monto_pago: 300, monto_aplicado: 300, estado: 'pagada', metodo_pago: 'transferencia', referencia: 'TRF-300', fecha_pago: '2026-03-05', orden_id: 'o1', orden_numero: 'OC-000001' }],
    excepciones: [{ id: 'x1', orden_id: 'o1', orden_numero: 'OC-000001', etapa: 'aprobar', causas: 'vigencia', motivo: 'Contrato en renovación', autorizado_por: 'u', revision: 0, created_at: '2026-02-03T10:00:00Z' }],
    ampliaciones: [{ id: 'a1', monto_anterior: 1000, incremento: 1000, monto_nuevo: 2000, moneda: 'GTQ', motivo: 'Adenda 1', referencia_documento: 'AD-1', autorizado_por: 'u', created_at: '2026-04-01T10:00:00Z' }],
    renovaciones: [{ id: 'c2', referencia: 'CT-01-R1', estado: 'borrador', fecha_inicio: '2027-01-01', fecha_fin: null }],
    eventos: [],
    ...extra,
  }
}

describe('seguimiento del contrato', () => {
  it('contratado, comprometido, recibido, facturado y pagado son indicadores distintos y cada moneda va aparte', () => {
    render(<SeguimientoContratoContenido s={seg()} />)
    const gtq = within(screen.getByTestId('moneda-GTQ'))
    expect(gtq.getByTestId('ind-GTQ-comprometido').textContent).toMatch(/1[.,\s]?400/)
    expect(gtq.getByTestId('ind-GTQ-recibido').textContent).toMatch(/600/)
    expect(gtq.getByTestId('ind-GTQ-facturado').textContent).toMatch(/672/)
    expect(gtq.getByTestId('ind-GTQ-pagado').textContent).toMatch(/300/)
    expect(gtq.getByTestId('ind-GTQ-pend-facturar').textContent).toMatch(/400/)
    expect(gtq.getByTestId('ind-GTQ-dif-precio')).toBeTruthy()
    expect(gtq.getByTestId('ind-GTQ-disponible').textContent).toMatch(/600/)
    const usd = within(screen.getByTestId('moneda-USD'))
    expect(usd.getByTestId('ind-USD-comprometido').textContent).toMatch(/112/)
    expect(usd.queryByTestId('ind-USD-disponible')).toBeNull()   // el disponible solo existe en la moneda del contrato
  })

  it('el monto máximo vigente se explica: original + ampliaciones documentadas', () => {
    render(<SeguimientoContratoContenido s={seg()} />)
    const t = screen.getByTestId('seg-monto-maximo').textContent ?? ''
    expect(t).toMatch(/2[.,\s]?000/)
    expect(t).toMatch(/original/)
    expect(screen.getByTestId('seg-ampliaciones').textContent).toMatch(/Adenda 1/)
  })

  it('un contrato SIN monto máximo dice «Sin límite total» y no inventa un total; el recurrente muestra su importe periódico', () => {
    render(<SeguimientoContratoContenido s={seg({ por_moneda: [] }, {
      sin_limite_total: true, monto_maximo_original: null, ampliaciones_total: null, monto_maximo_vigente: null,
      modalidad: 'recurrente', periodicidad: 'mensual', importe_periodico: 500, fecha_fin: null, indefinido: true,
    })} />)
    expect(screen.getByTestId('seg-sin-limite').textContent).toMatch(/Sin límite total/)
    expect(screen.queryByTestId('seg-monto-maximo')).toBeNull()
    expect(screen.getByTestId('seg-importe-periodico').textContent).toMatch(/500/)
    expect(screen.getByTestId('seg-contratado').textContent).toMatch(/indefinida/)
  })

  it('una orden borrador no compromete monto y se dice', () => {
    render(<SeguimientoContratoContenido s={seg()} />)
    expect(within(screen.getByTestId('seg-ordenes')).getByText('no compromete')).toBeTruthy()
  })

  it('la excepción autorizada queda a la vista con su motivo y lo que cubre', () => {
    render(<SeguimientoContratoContenido s={seg()} />)
    const t = screen.getByTestId('seg-excepciones').textContent ?? ''
    expect(t).toMatch(/Contrato en renovación/)
    expect(t).toMatch(/fuera de vigencia/)
  })

  it('muestra la vigencia de hoy', () => {
    const { rerender } = render(<SeguimientoContratoContenido s={seg()} />)
    expect(screen.getByTestId('contrato-vigencia').textContent).toMatch(/Vigente hoy/)
    rerender(<SeguimientoContratoContenido s={seg({}, { vigente: false })} />)
    expect(screen.getByTestId('contrato-vigencia').textContent).toMatch(/No vigente hoy/)
  })

  it('Operaciones (sin Contabilidad): no hay facturado, pagado, facturas ni pagos', () => {
    const s = seg({
      contabilidad_visible: false, facturas: [], pagos: [],
      por_moneda: [{ moneda: 'GTQ', ordenes: 1, comprometido: 600, recibido: 600, facturado: null, pagado: null, pendiente_por_recibir: 0,
        pendiente_por_facturar: null, diferencia_precio_facturada: null, monto_maximo_vigente: 2000, disponible: 1400 }],
    })
    render(<SeguimientoContratoContenido s={s} />)
    expect(screen.queryByTestId('ind-GTQ-facturado')).toBeNull()
    expect(screen.queryByTestId('ind-GTQ-pagado')).toBeNull()
    expect(screen.queryByTestId('ind-GTQ-pend-facturar')).toBeNull()
    expect(screen.queryByTestId('seg-facturas')).toBeNull()
    expect(screen.queryByTestId('seg-pagos')).toBeNull()
    expect(screen.getByTestId('sin-contabilidad')).toBeTruthy()
    expect(screen.getByTestId('ind-GTQ-recibido')).toBeTruthy()
  })

  it('Contabilidad ve facturas y pagos del contrato', () => {
    render(<SeguimientoContratoContenido s={seg()} />)
    expect(within(screen.getByTestId('seg-facturas')).getByText('F-1')).toBeTruthy()
    expect(within(screen.getByTestId('seg-pagos')).getByText('TRF-300')).toBeTruthy()
  })

  it('la renovación se muestra ligada: el contrato anterior conserva su historial', () => {
    render(<SeguimientoContratoContenido s={seg({}, { renovado_de: 'c0' })} />)
    const t = screen.getByTestId('seg-renovaciones').textContent ?? ''
    expect(t).toMatch(/CT-01-R1/)
    expect(t).toMatch(/conserva sus condiciones, documentos e historial/)
  })
})

describe('selector de contrato de una orden', () => {
  const contrato = (over: Partial<ContratoProveedorCatalogo>): ContratoProveedorCatalogo => ({
    id: 'k1', company_id: 'e', project_id: 'p', proveedor_id: 'pv', referencia: 'CT-01', proveedor_nombre: 'X', servicio: 'otro',
    fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', estado: 'activo', created_at: '2026-01-01', moneda: 'GTQ', monto_maximo: 1000, ...over,
  })
  const montar = (props: Partial<React.ComponentProps<typeof ContratoSelector>> = {}) => {
    const qc = new QueryClient()
    return render(
      <QueryClientProvider client={qc}>
        <ContratoSelector companyId="e" projectId="p" proveedorId="pv" value={null} onChange={vi.fn()} {...props} />
      </QueryClientProvider>,
    )
  }

  it('ofrece «Sin contrato» y los contratos vigentes con su moneda y su límite', () => {
    q.contratos = [contrato({}), contrato({ id: 'k2', referencia: 'CT-02', monto_maximo: null, fecha_fin: null })]
    montar()
    const opts = screen.getAllByRole('option').map((o) => o.textContent)
    expect(opts[0]).toBe('Sin contrato')
    expect(opts[1]).toMatch(/CT-01.*GTQ.*límite.*1[.,\s]?000/)
    expect(opts[2]).toMatch(/CT-02.*sin límite total.*indefinido/)
  })

  it('elegir un contrato avisa con su id y su fila', async () => {
    q.contratos = [contrato({})]
    const onChange = vi.fn()
    montar({ onChange })
    const sel = screen.getByRole('combobox') as HTMLSelectElement
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(sel, { target: { value: 'k1' } })
    expect(onChange).toHaveBeenCalledWith('k1', expect.objectContaining({ referencia: 'CT-01' }))
  })

  it('sin contratos vigentes lo dice y la orden se compra sin contrato', () => {
    montar()
    expect(screen.getByTestId('contrato-ayuda').textContent).toMatch(/no tiene contratos vigentes/)
  })

  it('sin proveedor elegido no se puede elegir contrato', () => {
    montar({ proveedorId: null })
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByTestId('contrato-ayuda').textContent).toMatch(/Elige primero el proveedor/)
  })

  it('en la contabilidad de la empresa (sin proyecto) no hay contratos: se explica', () => {
    montar({ projectId: null })
    expect(screen.getByTestId('contrato-sin-proyecto')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

// Seguimiento compartido de la orden (Bloque B).
//
// Se fija lo que una persona VE: los cuatro indicadores por separado, las
// diferencias de la factura a la vista y, para quien no ve Contabilidad, que las
// facturas y los pagos no aparecen. Quién ve qué lo decide el servidor
// (supabase/tests/compras_bloque_b/assert_seguimiento.sql); la pantalla solo
// muestra lo que le llega.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

import { SeguimientoOrdenContenido } from '../SeguimientoOrdenModal'
import type { SeguimientoOrden } from '../../../types/compras'

afterEach(cleanup)

function base(extra: Partial<SeguimientoOrden> = {}): SeguimientoOrden {
  return {
    orden: {
      id: 'o1', numero: 'OC-0001', concepto: 'Cloro y bomba', estado: 'recibida_parcial', revision: 1,
      project_id: 'p1', moneda: 'GTQ', fecha_requerida: null, aprobada_at: null, emitida_at: null, cerrada_at: null,
      solicitada_por: null, aprobada_por: null, motivo_devolucion: 'Corregir el precio', motivo_anulacion: null,
      proveedor: { id: 'pv', codigo: 'PRV-00001', nombre: 'Ferretería Norte', identificacion: '8100001-1', pais: 'GT', estado: 'autorizado' },
      contrato: null,
    },
    contabilidad_visible: true,
    indicadores: {
      comprometido: 2576, comprometido_neto: 2300, recibido: 900, facturado: 1008, facturado_neto: 900, pagado: 0,
      pendiente_por_recibir: 1400, pendiente_por_facturar: 0,
    },
    lineas: [
      { id: 'l1', linea: 1, descripcion: 'Cloro industrial', destino: 'inventario', unidad: 'litro', precio_unitario: 10,
        cantidad_ordenada: 100, cantidad_aceptada: 40, cantidad_rechazada: 5, cantidad_pendiente: 60,
        cantidad_facturada: 40, cantidad_pendiente_facturar: 0,
        cuenta: { id: 'c', codigo: '1106', nombre: 'Inventario' }, cuenta_origen: 'regla_compra' },
    ],
    recepciones: [{ id: 'r1', numero: 'REC-1', fecha: '2026-10-01', tipo: 'bienes', estado: 'registrada', recibido_por: null,
      destino_fisico: 'Bodega general', documento_referencia: 'REM-1', tiene_respaldo: true, respaldos: 1, motivo_anulacion: null, aceptado: 40, rechazado: 5 }],
    movimientos_inventario: [{ id: 'm1', tipo: 'entrada', cantidad: 40, fecha: '2026-10-01', suministro_id: 's1', origen: 'recepcion_lineas' }],
    activos: [{ id: 'a1', codigo: 'ACT-1', nombre: 'Bomba de agua', estado: 'activo', costo: 500 }],
    eventos: [
      { tipo: 'estado', estado_anterior: 'borrador', estado_nuevo: 'aprobada', motivo: null, revision: 0, origen: 'usuario', actor_id: 'u', created_at: '2026-09-30T10:00:00Z' },
      { tipo: 'estado', estado_anterior: 'emitida', estado_nuevo: 'recibida_parcial', motivo: null, revision: 1, origen: 'sistema', actor_id: null, created_at: '2026-10-01T10:00:00Z' },
    ],
    facturas: [{
      id: 'f1', numero_factura: 'F-0001', fecha_emision: '2026-10-01', estado: 'aprobada', moneda: 'GTQ', monto_total: 1008, iva_monto: 108,
      monto_pagado: 0, saldo: 1008, contabilizada: true, match_forzado: true, justificacion: 'Alza pactada por escrito.',
      diferencias: [{ linea: 1, descripcion: 'Cloro industrial', motivo: 'Precio 20 % arriba del pedido', dif_precio: 2, dif_iva: null,
        moneda_orden: 'GTQ', moneda_factura: 'GTQ', cantidad_factura: 40 }],
    }],
    ...extra,
  }
}

describe('SeguimientoOrdenContenido', () => {
  it('muestra comprometido, recibido, facturado y pagado como indicadores SEPARADOS', () => {
    render(<SeguimientoOrdenContenido s={base()} monedaBase="GTQ" />)
    expect(within(screen.getByTestId('ind-comprometido')).getByText(/2,576/)).toBeTruthy()
    expect(within(screen.getByTestId('ind-recibido')).getByText(/900/)).toBeTruthy()
    expect(within(screen.getByTestId('ind-facturado')).getByText(/1,008/)).toBeTruthy()
    expect(screen.getByTestId('ind-pagado')).toBeTruthy()
    // El comprometido muestra también su neto sin IVA, comparable con lo recibido.
    expect(within(screen.getByTestId('ind-comprometido')).getByText(/sin IVA/)).toBeTruthy()
  })

  it('muestra el proveedor del catálogo, la revisión y el motivo de la devolución', () => {
    render(<SeguimientoOrdenContenido s={base()} monedaBase="GTQ" />)
    expect(screen.getByText('Ferretería Norte')).toBeTruthy()
    expect(screen.getByText(/PRV-00001/)).toBeTruthy()
    expect(screen.getByText(/Revisión 1/)).toBeTruthy()
    expect(screen.getByText(/Corregir el precio/)).toBeTruthy()
  })

  it('lista aceptado, rechazado y pendiente por renglón, con su cuenta y origen', () => {
    render(<SeguimientoOrdenContenido s={base()} monedaBase="GTQ" />)
    const fila = screen.getByText('Cloro industrial').closest('tr')!
    expect(within(fila).getByText('1106 Inventario (regla)')).toBeTruthy()
    expect(within(fila).getByText('60')).toBeTruthy() // pendiente
    expect(within(fila).getByText('5')).toBeTruthy()  // rechazado
  })

  it('muestra recepciones, inventario, activos e historial (con lo automático marcado)', () => {
    render(<SeguimientoOrdenContenido s={base()} monedaBase="GTQ" />)
    expect(within(screen.getByTestId('seg-recepciones')).getByText(/Bodega general/)).toBeTruthy()
    expect(within(screen.getByTestId('seg-recepciones')).getByText(/rechazado 5/)).toBeTruthy()
    expect(within(screen.getByTestId('seg-inventario')).getByText(/Entrada de inventario/)).toBeTruthy()
    expect(within(screen.getByTestId('seg-inventario')).getByText(/ACT-1/)).toBeTruthy()
    expect(within(screen.getByTestId('seg-historial')).getByText(/\(automático\)/)).toBeTruthy()
  })

  it('deja a la vista las diferencias de la factura y que se aprobó con justificación', () => {
    render(<SeguimientoOrdenContenido s={base()} monedaBase="GTQ" />)
    const dif = screen.getByTestId('dif-f1')
    expect(within(dif).getByText(/Precio 20 % arriba del pedido/)).toBeTruthy()
    expect(screen.getByText('Aprobada con diferencias')).toBeTruthy()
    expect(screen.getByText(/Alza pactada por escrito/)).toBeTruthy()
    expect(screen.getByText('Contabilizada')).toBeTruthy()
  })

  it('para quien NO ve Contabilidad no hay facturas, facturado ni pagado', () => {
    const s = base({
      contabilidad_visible: false,
      facturas: undefined,
      indicadores: { comprometido: 2576, comprometido_neto: 2300, recibido: 900, facturado: null, facturado_neto: null, pagado: null,
        pendiente_por_recibir: 1400, pendiente_por_facturar: null },
    })
    render(<SeguimientoOrdenContenido s={s} monedaBase="GTQ" />)
    expect(screen.queryByTestId('ind-facturado')).toBeNull()
    expect(screen.queryByTestId('ind-pagado')).toBeNull()
    expect(screen.queryByTestId('seg-facturas')).toBeNull()
    expect(screen.getByTestId('sin-contabilidad')).toBeTruthy()
    // Lo operativo sí se ve.
    expect(screen.getByTestId('ind-recibido')).toBeTruthy()
    expect(screen.getByTestId('seg-recepciones')).toBeTruthy()
  })

  it('un proveedor que ya no está autorizado se avisa', () => {
    const s = base()
    s.orden.proveedor.estado = 'suspendido'
    render(<SeguimientoOrdenContenido s={s} monedaBase="GTQ" />)
    expect(screen.getByText(/Proveedor suspendido/)).toBeTruthy()
  })
})

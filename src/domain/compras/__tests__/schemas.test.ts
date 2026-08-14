import { describe, expect, it } from 'vitest'
import {
  activoFijoFormSchema,
  contrasenaFormSchema,
  ordenCompraFormSchema,
  pendienteDeFacturar,
  pendienteDeRecibir,
  proveedorDocumentoSchema,
  proveedorEstadoSchema,
  recepcionFormSchema,
  totalLinea,
  totalesOrden,
} from '../schemas'
import { proveedorHabilitado } from '../../../types/compras'

const UUID = '11111111-1111-1111-1111-111111111111'

const lineaBase = {
  descripcion: 'Cloro granular 45kg',
  destino_tipo: 'gasto' as const,
  suministro_id: null,
  cuenta_id: null,
  categoria: 'mantenimiento',
  cantidad: 10,
  unidad: 'saco',
  precio_unitario: 350,
  iva_monto: 420,
}

const ordenBase = {
  proveedor_id: UUID,
  project_id: null,
  concepto: 'Insumos de piscina',
  descripcion: null,
  condiciones_pago: null,
  dias_credito: 0,
  fecha_requerida: null,
  obra_id: null,
  notas: null,
  lineas: [lineaBase],
}

describe('ordenCompraFormSchema', () => {
  it('acepta una orden con al menos una línea', () => {
    expect(ordenCompraFormSchema.safeParse(ordenBase).success).toBe(true)
  })

  it('rechaza una orden sin líneas: no se compromete dinero sin decir a cambio de qué', () => {
    const r = ordenCompraFormSchema.safeParse({ ...ordenBase, lineas: [] })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/al menos una línea/i)
  })

  it('rechaza cantidad cero o negativa', () => {
    expect(ordenCompraFormSchema.safeParse({
      ...ordenBase, lineas: [{ ...lineaBase, cantidad: 0 }],
    }).success).toBe(false)
  })

  // Sin insumo, la recepción con destino inventario contabilizaría pero no
  // movería existencias — el error más silencioso posible.
  it('exige insumo del almacén cuando el destino es inventario', () => {
    const r = ordenCompraFormSchema.safeParse({
      ...ordenBase,
      lineas: [{ ...lineaBase, destino_tipo: 'inventario', suministro_id: null }],
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/Inventario/i)
  })

  it('acepta destino inventario cuando sí trae el insumo', () => {
    expect(ordenCompraFormSchema.safeParse({
      ...ordenBase,
      lineas: [{ ...lineaBase, destino_tipo: 'inventario', suministro_id: UUID }],
    }).success).toBe(true)
  })
})

describe('totales de la orden', () => {
  it('total de línea = cantidad × precio + IVA', () => {
    expect(totalLinea({ cantidad: 10, precio_unitario: 350, iva_monto: 420 })).toBe(3920)
  })

  it('suma las líneas como lo hace el trigger de la cabecera', () => {
    expect(totalesOrden([
      { cantidad: 10, precio_unitario: 350, iva_monto: 420 },
      { cantidad: 1, precio_unitario: 4500, iva_monto: 540 },
    ])).toEqual({ subtotal: 8000, iva: 960, total: 8960 })
  })

  it('redondea a dos decimales en vez de arrastrar el error binario', () => {
    // 3 × 0.615 = 1.8449999… en coma flotante.
    expect(totalLinea({ cantidad: 3, precio_unitario: 0.615 })).toBe(1.85)
  })
})

describe('pendientes de la línea de orden', () => {
  it('pendiente de recibir descuenta lo ya recibido', () => {
    expect(pendienteDeRecibir({ cantidad: 10, cantidad_recibida: 6 })).toBe(4)
  })

  it('no devuelve negativos si se recibió de más', () => {
    expect(pendienteDeRecibir({ cantidad: 10, cantidad_recibida: 12 })).toBe(0)
    expect(pendienteDeFacturar({ cantidad_recibida: 6, cantidad_facturada: 9 })).toBe(0)
  })

  it('el techo de lo facturable es lo RECIBIDO, no lo ordenado', () => {
    expect(pendienteDeFacturar({ cantidad_recibida: 6, cantidad_facturada: 2 })).toBe(4)
  })
})

describe('proveedorEstadoSchema', () => {
  it('autoriza sin exigir motivo', () => {
    expect(proveedorEstadoSchema.safeParse({
      estado: 'autorizado', autorizacion_vence: null, motivo_estado: null,
    }).success).toBe(true)
  })

  it('exige motivo para suspender o vetar', () => {
    for (const estado of ['suspendido', 'vetado'] as const) {
      const r = proveedorEstadoSchema.safeParse({ estado, autorizacion_vence: null, motivo_estado: null })
      expect(r.success).toBe(false)
    }
  })

  it('acepta la suspensión cuando trae motivo', () => {
    expect(proveedorEstadoSchema.safeParse({
      estado: 'suspendido', autorizacion_vence: null, motivo_estado: 'RTU vencido',
    }).success).toBe(true)
  })
})

describe('proveedorDocumentoSchema', () => {
  it('rechaza un vencimiento anterior a la emisión', () => {
    const r = proveedorDocumentoSchema.safeParse({
      tipo: 'rtu', numero: '123', archivo_url: null,
      emitido_el: '2026-08-10', vence_el: '2026-08-01', notas: null,
    })
    expect(r.success).toBe(false)
  })

  it('acepta un documento sin vencimiento', () => {
    expect(proveedorDocumentoSchema.safeParse({
      tipo: 'patente_comercio', numero: null, archivo_url: null,
      emitido_el: null, vence_el: null, notas: null,
    }).success).toBe(true)
  })
})

describe('proveedorHabilitado', () => {
  const hoy = '2026-08-14'

  it('solo un proveedor autorizado recibe órdenes', () => {
    expect(proveedorHabilitado({ estado: 'autorizado' }, hoy)).toBe(true)
    for (const estado of ['borrador', 'en_revision', 'suspendido', 'vetado'] as const) {
      expect(proveedorHabilitado({ estado }, hoy)).toBe(false)
    }
  })

  // El candado se cierra solo: nadie tiene que acordarse de suspender al
  // proveedor el día que se le vence el RTU.
  it('una autorización vencida deja de habilitar aunque el estado siga en autorizado', () => {
    expect(proveedorHabilitado({ estado: 'autorizado', autorizacion_vence: '2026-08-13' }, hoy)).toBe(false)
    expect(proveedorHabilitado({ estado: 'autorizado', autorizacion_vence: '2026-08-14' }, hoy)).toBe(true)
  })

  it('cae al booleano legacy cuando la fila no trae estado', () => {
    expect(proveedorHabilitado({ activo: true }, hoy)).toBe(true)
    expect(proveedorHabilitado({ activo: false }, hoy)).toBe(false)
  })
})

describe('recepcionFormSchema', () => {
  const base = {
    orden_compra_id: UUID,
    fecha: '2026-08-14',
    documento_referencia: 'Envío 8871',
    notas: null,
    lineas: [{ orden_compra_linea_id: UUID, cantidad: 6, costo_unitario: 350, observacion: null }],
  }

  it('acepta una recepción con renglones', () => {
    expect(recepcionFormSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza una recepción vacía', () => {
    expect(recepcionFormSchema.safeParse({ ...base, lineas: [] }).success).toBe(false)
  })
})

describe('contrasenaFormSchema', () => {
  const base = {
    proveedor_id: UUID,
    fecha_emision: '2026-08-14',
    fecha_pago_programada: '2026-08-29',
    entregada_por: null,
    recibida_por: null,
    observaciones: null,
    facturas: [{ factura_id: UUID, monto: 8288 }],
  }

  it('acepta una contraseña que agrupa facturas', () => {
    expect(contrasenaFormSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza una contraseña sin facturas', () => {
    expect(contrasenaFormSchema.safeParse({ ...base, facturas: [] }).success).toBe(false)
  })

  it('rechaza pagar antes de emitir', () => {
    const r = contrasenaFormSchema.safeParse({ ...base, fecha_pago_programada: '2026-08-01' })
    expect(r.success).toBe(false)
  })
})

describe('activoFijoFormSchema', () => {
  const base = {
    codigo: 'AF-000001', nombre: 'Bomba dosificadora', categoria: 'maquinaria' as const,
    numero_serie: null, ubicacion: null, fecha_alta: '2026-08-14',
    costo: 4500, valor_residual: 500, vida_util_meses: 60, notas: null,
  }

  it('acepta un activo bien formado', () => {
    expect(activoFijoFormSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza un valor residual mayor que el costo', () => {
    expect(activoFijoFormSchema.safeParse({ ...base, valor_residual: 5000 }).success).toBe(false)
  })

  it('rechaza vida útil de cero meses', () => {
    expect(activoFijoFormSchema.safeParse({ ...base, vida_util_meses: 0 }).success).toBe(false)
  })
})

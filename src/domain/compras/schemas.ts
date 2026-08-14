// Compras (Fase 6) — validación Zod de formularios.
//
// La validación AUTORITATIVA vive en los triggers de BD: el candado del
// proveedor autorizado, la sobre-recepción, el cuadre de 3 vías y el reparto de
// la contraseña se deciden en Postgres, donde no los puede saltar un cliente
// que hable directo con PostgREST. Esto es solo feedback inmediato en la UI.
import { z } from 'zod'
import { redondear2 } from '../../lib/business'

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD')

// ── Proveedor autorizado ────────────────────────────────────────────────────

export const proveedorEstadoSchema = z.object({
  estado: z.enum(['borrador', 'en_revision', 'autorizado', 'suspendido', 'vetado']),
  autorizacion_vence: fechaISO.nullable(),
  motivo_estado: z.string().trim().max(300).nullable(),
}).refine((p) => p.estado !== 'suspendido' && p.estado !== 'vetado'
  ? true
  : !!p.motivo_estado && p.motivo_estado.trim().length >= 3, {
  message: 'Suspender o vetar a un proveedor exige anotar el motivo',
  path: ['motivo_estado'],
})

export type ProveedorEstadoInput = z.infer<typeof proveedorEstadoSchema>

export const proveedorDocumentoSchema = z.object({
  tipo: z.enum(['rtu', 'patente_comercio', 'patente_sociedad', 'dpi_representante',
    'constancia_iva', 'referencia_bancaria', 'contrato', 'otro']),
  numero: z.string().trim().max(60).nullable(),
  archivo_url: z.string().trim().url('URL inválida').nullable().or(z.literal('').transform(() => null)),
  emitido_el: fechaISO.nullable(),
  vence_el: fechaISO.nullable(),
  notas: z.string().trim().max(300).nullable(),
}).refine((d) => !d.emitido_el || !d.vence_el || d.vence_el >= d.emitido_el, {
  message: 'El vencimiento no puede ser anterior a la emisión',
  path: ['vence_el'],
})

export type ProveedorDocumentoInput = z.infer<typeof proveedorDocumentoSchema>

// ── Orden de compra ─────────────────────────────────────────────────────────

export const ordenCompraLineaSchema = z.object({
  descripcion: z.string().trim().min(2, 'Describe qué se está pidiendo').max(300),
  destino_tipo: z.enum(['inventario', 'activo_fijo', 'servicio', 'gasto']),
  suministro_id: z.string().uuid().nullable(),
  cuenta_id: z.string().uuid().nullable(),
  categoria: z.string().trim().min(1),
  cantidad: z.number().positive('La cantidad debe ser mayor que 0'),
  unidad: z.string().trim().min(1).max(20),
  precio_unitario: z.number().min(0, 'El precio no puede ser negativo'),
  iva_monto: z.number().min(0).default(0),
})

export type OrdenCompraLineaInput = z.infer<typeof ordenCompraLineaSchema>

export const ordenCompraFormSchema = z.object({
  proveedor_id: z.string().uuid('Selecciona un proveedor autorizado'),
  project_id: z.string().uuid().nullable(),
  concepto: z.string().trim().min(3, 'El concepto es obligatorio').max(300),
  descripcion: z.string().trim().max(1000).nullable(),
  condiciones_pago: z.string().trim().max(200).nullable(),
  dias_credito: z.number().int().min(0).max(365).default(0),
  fecha_requerida: fechaISO.nullable(),
  obra_id: z.string().uuid().nullable(),
  notas: z.string().trim().max(500).nullable(),
  lineas: z.array(ordenCompraLineaSchema).min(1, 'La orden necesita al menos una línea'),
}).refine((o) => o.lineas.every((l) => l.destino_tipo !== 'inventario' || !!l.suministro_id), {
  message: 'Las líneas con destino Inventario deben apuntar a un insumo del almacén',
  path: ['lineas'],
})

export type OrdenCompraFormInput = z.infer<typeof ordenCompraFormSchema>

// ── Recepción ───────────────────────────────────────────────────────────────

export const recepcionLineaSchema = z.object({
  orden_compra_linea_id: z.string().uuid(),
  cantidad: z.number().positive('La cantidad recibida debe ser mayor que 0'),
  costo_unitario: z.number().min(0).default(0),
  observacion: z.string().trim().max(300).nullable(),
})

export type RecepcionLineaInput = z.infer<typeof recepcionLineaSchema>

export const recepcionFormSchema = z.object({
  orden_compra_id: z.string().uuid('Selecciona la orden de compra'),
  fecha: fechaISO,
  documento_referencia: z.string().trim().max(60).nullable(),
  notas: z.string().trim().max(500).nullable(),
  lineas: z.array(recepcionLineaSchema).min(1, 'Indica al menos un renglón recibido'),
})

export type RecepcionFormInput = z.infer<typeof recepcionFormSchema>

// ── Contraseña de pago ──────────────────────────────────────────────────────

export const contrasenaFormSchema = z.object({
  proveedor_id: z.string().uuid('Selecciona el proveedor'),
  fecha_emision: fechaISO,
  fecha_pago_programada: fechaISO,
  entregada_por: z.string().trim().max(120).nullable(),
  recibida_por: z.string().trim().max(120).nullable(),
  observaciones: z.string().trim().max(500).nullable(),
  facturas: z.array(z.object({
    factura_id: z.string().uuid(),
    monto: z.number().positive(),
  })).min(1, 'La contraseña debe cubrir al menos una factura'),
}).refine((c) => c.fecha_pago_programada >= c.fecha_emision, {
  message: 'La fecha de pago no puede ser anterior a la emisión',
  path: ['fecha_pago_programada'],
})

export type ContrasenaFormInput = z.infer<typeof contrasenaFormSchema>

// ── Activo fijo ─────────────────────────────────────────────────────────────

export const activoFijoFormSchema = z.object({
  codigo: z.string().trim().min(1, 'El código es obligatorio').max(40),
  nombre: z.string().trim().min(2, 'El nombre es obligatorio').max(200),
  categoria: z.enum(['mobiliario', 'computo', 'maquinaria', 'vehiculo', 'otro']),
  numero_serie: z.string().trim().max(80).nullable(),
  ubicacion: z.string().trim().max(150).nullable(),
  fecha_alta: fechaISO,
  costo: z.number().min(0, 'El costo no puede ser negativo'),
  valor_residual: z.number().min(0).default(0),
  vida_util_meses: z.number().int().positive('La vida útil debe ser mayor que 0').max(1200),
  notas: z.string().trim().max(500).nullable(),
}).refine((a) => a.valor_residual <= a.costo, {
  message: 'El valor residual no puede superar el costo',
  path: ['valor_residual'],
})

export type ActivoFijoFormInput = z.infer<typeof activoFijoFormSchema>

// ── Cálculos puros (probados en __tests__) ──────────────────────────────────

/** Total de una línea de orden: cantidad × precio + IVA. Espeja el trigger. */
export function totalLinea(l: { cantidad: number; precio_unitario: number; iva_monto?: number }): number {
  return redondear2(redondear2(l.cantidad * l.precio_unitario) + (l.iva_monto ?? 0))
}

/** Totales de la cabecera desde sus líneas. Espeja compras_tg_oc_totales. */
export function totalesOrden(lineas: { cantidad: number; precio_unitario: number; iva_monto?: number }[]) {
  const subtotal = redondear2(
    lineas.reduce((s, l) => s + redondear2(l.cantidad * l.precio_unitario), 0),
  )
  const iva = redondear2(lineas.reduce((s, l) => s + (l.iva_monto ?? 0), 0))
  return { subtotal, iva, total: redondear2(subtotal + iva) }
}

/** Lo que todavía se puede recibir de una línea de orden. */
export function pendienteDeRecibir(l: { cantidad: number; cantidad_recibida: number }): number {
  return Math.max(0, redondear2(l.cantidad - l.cantidad_recibida))
}

/** Lo recibido que aún no se factura: el techo de lo que una factura puede cobrar. */
export function pendienteDeFacturar(l: { cantidad_recibida: number; cantidad_facturada: number }): number {
  return Math.max(0, redondear2(l.cantidad_recibida - l.cantidad_facturada))
}

// CxP — validación Zod de formularios. La validación autoritativa (estados,
// inmutabilidad, saldos) vive en los triggers de BD; esto da feedback en UI.
import { z } from 'zod'
import { redondear2 } from '../../lib/business'

export const proveedorFormSchema = z.object({
  nombre: z.string().trim().min(2, 'El nombre es obligatorio (mín. 2 caracteres)').max(150),
  nit: z.string().trim().max(20).nullable(),
  rfc: z.string().trim().max(20).nullable(),
  email: z.string().trim().email('Email inválido').nullable().or(z.literal('').transform(() => null)),
  telefono: z.string().trim().max(30).nullable(),
  direccion: z.string().trim().max(300).nullable(),
  contacto_nombre: z.string().trim().max(120).nullable(),
  dias_credito: z.number().int().min(0, 'Días de crédito ≥ 0').max(365),
  categoria_default: z.string().trim().nullable(),
  notas: z.string().trim().max(500).nullable(),
  // PR A (identidad compartida). Opcionales: los llamadores anteriores no los
  // envían y el servidor asigna el código si falta. Ver domain/proveedores.
  codigo: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/, 'Código: letras, dígitos y . _ / - (máx. 40)')
    .nullable().or(z.literal('').transform(() => null)).optional(),
  pais: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'País: código de 2 letras (GT, MX…)')
    .nullable().or(z.literal('').transform(() => null)).optional(),
  abastece: z.array(z.enum(['servicios', 'suministros', 'equipos'])).optional(),
  alcance: z.enum(['empresa', 'proyectos']).optional(),
})

export type ProveedorFormInput = z.infer<typeof proveedorFormSchema>

export const facturaProveedorFormSchema = z.object({
  proveedor_id: z.string().uuid('Selecciona el proveedor'),
  project_id: z.string().uuid().nullable(),
  numero_factura: z.string().trim().max(50).nullable(),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD'),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  concepto: z.string().trim().min(3, 'El concepto es obligatorio').max(300),
  categoria: z.string().trim().min(1),
  moneda: z.string().trim().toUpperCase().length(3).nullable(),
  monto_total: z.number().positive('El monto debe ser mayor que 0'),
  iva_monto: z.number().min(0).default(0),
  notas: z.string().trim().max(500).nullable(),
  /** Orden que origina la factura (cuadre de 3 vías). Con orden, la factura se
   *  captura por renglón: ver `facturaRenglonSchema`. */
  orden_compra_id: z.string().uuid().nullable().optional(),
}).refine((f) => f.iva_monto <= f.monto_total, {
  message: 'El IVA no puede exceder el total',
  path: ['iva_monto'],
})

export type FacturaProveedorFormInput = z.infer<typeof facturaProveedorFormSchema>

/** Un renglón de factura contra un renglón de la orden. El servidor cuadra
 *  cantidad, precio, IVA y moneda de cada uno al aprobar (compras_validar_match);
 *  aquí solo se exige que sea capturable. */
export const facturaRenglonSchema = z.object({
  orden_compra_linea_id: z.string().uuid('Renglón de orden inválido'),
  descripcion: z.string().trim().min(1).max(300),
  cantidad: z.number().positive('La cantidad a facturar debe ser mayor que 0'),
  precio_unitario: z.number().min(0, 'El precio no puede ser negativo'),
  iva_monto: z.number().min(0, 'El IVA no puede ser negativo'),
})

export type FacturaRenglonInput = z.infer<typeof facturaRenglonSchema>

/** Entrada de `compras_factura_crear`: la factura, sus renglones (con orden) y la
 *  clave de idempotencia de ESTE intento de captura. */
export type FacturaCrearInput = FacturaProveedorFormInput & {
  clave_idempotencia: string
  renglones?: FacturaRenglonInput[]
}

/** Quita el código técnico del servidor («COMPRAS_FACTURA_X: texto») para mostrar
 *  solo el texto, que está escrito para leerse tal cual. */
export function textoErrorServidor(mensaje: string): string {
  return mensaje.replace(/^\s*(?:[A-Z][A-Z0-9]*_)+[A-Z0-9]+:\s*/, '').trim() || mensaje
}

/** Totales de una factura capturada por renglón (mismo redondeo que el servidor:
 *  total del renglón = round(cantidad × precio, 2) + IVA). */
export function totalesFactura(renglones: Pick<FacturaRenglonInput, 'cantidad' | 'precio_unitario' | 'iva_monto'>[]) {
  const subtotal = redondear2(renglones.reduce((s, r) => s + redondear2(r.cantidad * r.precio_unitario), 0))
  const iva = redondear2(renglones.reduce((s, r) => s + r.iva_monto, 0))
  return { subtotal, iva, total: redondear2(subtotal + iva) }
}

export const ordenPagoFormSchema = z.object({
  factura_id: z.string().uuid('Selecciona la factura'),
  monto: z.number().positive('El monto debe ser mayor que 0'),
  metodo_pago: z.enum(['efectivo', 'transferencia', 'deposito', 'cheque', 'tarjeta', 'otro']),
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  referencia: z.string().trim().max(100).nullable(),
  notas: z.string().trim().max(500).nullable(),
})

export type OrdenPagoFormInput = z.infer<typeof ordenPagoFormSchema>

/** Saldo pendiente de una factura (lo máximo que puede pagar una orden). */
export function saldoFactura(f: { monto_total: number; monto_pagado: number }): number {
  // PR-22: era la OCTAVA copia del redondeo defectuoso —embebida en la expresión,
  // por eso no salía al buscar `function redondear2`. Es la que decide cuánto
  // puede pagar una orden contra una factura de proveedor.
  return redondear2(f.monto_total - f.monto_pagado)
}

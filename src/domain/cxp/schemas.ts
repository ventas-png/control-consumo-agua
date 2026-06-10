// CxP — validación Zod de formularios. La validación autoritativa (estados,
// inmutabilidad, saldos) vive en los triggers de BD; esto da feedback en UI.
import { z } from 'zod'

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
}).refine((f) => f.iva_monto <= f.monto_total, {
  message: 'El IVA no puede exceder el total',
  path: ['iva_monto'],
})

export type FacturaProveedorFormInput = z.infer<typeof facturaProveedorFormSchema>

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
  return Math.round((f.monto_total - f.monto_pagado + Number.EPSILON) * 100) / 100
}

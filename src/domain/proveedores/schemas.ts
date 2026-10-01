// Proveedores compartidos (PR A) — validación Zod de formularios.
// La validación AUTORITATIVA vive en la BD (triggers y RPC); esto da feedback
// en pantalla antes de enviar y espeja las mismas reglas.
import { z } from 'zod'
import {
  ESTADOS_CON_MOTIVO,
  PERIODICIDADES,
  TIPOS_ABASTECIMIENTO,
  type EstadoContratoProveedor,
} from '../../types/proveedores'

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD')
const texto = (max: number) => z.string().trim().max(max)
const opcional = (max: number) => texto(max).nullable().or(z.literal('').transform(() => null))

// ── Proveedor: campos nuevos (se suman a proveedorFormSchema de CxP) ─────────

export const proveedorIdentidadSchema = z.object({
  /** Vacío = lo asigna el servidor (PRV-00001…). */
  codigo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/, 'Código: letras, dígitos y . _ / - (máx. 40)')
    .nullable()
    .or(z.literal('').transform(() => null)),
  pais: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'País: código de 2 letras (GT, MX…)')
    .nullable()
    .or(z.literal('').transform(() => null)),
  abastece: z.array(z.enum(TIPOS_ABASTECIMIENTO as unknown as [string, ...string[]])),
  alcance: z.enum(['empresa', 'proyectos']),
})
export type ProveedorIdentidadInput = z.infer<typeof proveedorIdentidadSchema>

// ── Contactos ────────────────────────────────────────────────────────────────

export const contactoFormSchema = z.object({
  nombre: texto(120).min(2, 'El nombre del contacto es obligatorio'),
  cargo: opcional(80),
  email: z.string().trim().email('Correo inválido').nullable().or(z.literal('').transform(() => null)),
  telefono: opcional(30),
  es_principal: z.boolean(),
  notas: opcional(300),
})
export type ContactoFormInput = z.infer<typeof contactoFormSchema>

// ── Habilitación por proyecto ────────────────────────────────────────────────

export const habilitacionFormSchema = z
  .object({
    estado: z.enum(['pendiente', 'habilitado', 'suspendido', 'retirado']),
    motivo_estado: opcional(300),
    vigente_hasta: fechaISO.nullable().or(z.literal('').transform(() => null)),
    dias_credito: z.number().int().min(0).max(365).nullable(),
    condiciones_pago: opcional(200),
    notas: opcional(300),
  })
  .refine((v) => !['suspendido', 'retirado'].includes(v.estado) || !!v.motivo_estado, {
    message: 'Suspender o retirar exige indicar el motivo',
    path: ['motivo_estado'],
  })
export type HabilitacionFormInput = z.infer<typeof habilitacionFormSchema>

// ── Contratos ────────────────────────────────────────────────────────────────

export const SERVICIOS_CONTRATO = [
  'limpieza', 'jardineria', 'seguridad', 'mantenimiento', 'elevadores', 'piscina', 'otro',
] as const

const importe = z.number().min(0, 'El importe no puede ser negativo').max(1e12)

export const contratoFormSchema = z
  .object({
    proveedor_id: z.string().uuid('Elige un proveedor del catálogo'),
    referencia: opcional(60),
    servicio: z.enum(SERVICIOS_CONTRATO),
    modalidad: z.enum(['recurrente', 'por_demanda'], { message: 'Indica si es recurrente o por demanda' }),
    periodicidad: z.enum(PERIODICIDADES as unknown as [string, ...string[]]).nullable(),
    moneda: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Moneda de 3 letras (GTQ, USD)')
      .nullable()
      .or(z.literal('').transform(() => null)),
    importe_periodico: importe.nullable(),
    monto_maximo: importe.nullable(),
    alcance: opcional(600),
    descripcion: opcional(600),
    fecha_inicio: fechaISO,
    fecha_fin: fechaISO.nullable().or(z.literal('').transform(() => null)),
    contacto_id: z.string().uuid().nullable(),
    /** Contacto ESPECÍFICO del contrato (se guarda como fotografía; no toca el del catálogo). */
    proveedor_contacto: opcional(120),
    proveedor_telefono: opcional(30),
    proveedor_email: z.string().trim().email('Correo inválido').nullable().or(z.literal('').transform(() => null)),
    responsable_id: z.string().uuid().nullable(),
    notas: opcional(600),
  })
  .superRefine((v, ctx) => {
    if (v.modalidad === 'recurrente' && !v.periodicidad) {
      ctx.addIssue({ code: 'custom', path: ['periodicidad'], message: 'Un servicio recurrente necesita su periodicidad' })
    }
    if (v.modalidad === 'por_demanda' && v.importe_periodico != null) {
      ctx.addIssue({
        code: 'custom', path: ['importe_periodico'],
        message: 'Una compra por demanda no lleva importe periódico (usa el monto máximo si hay tope)',
      })
    }
    if ((v.importe_periodico != null || v.monto_maximo != null) && !v.moneda) {
      ctx.addIssue({ code: 'custom', path: ['moneda'], message: 'Con importes, indica la moneda' })
    }
    if (v.fecha_fin && v.fecha_fin < v.fecha_inicio) {
      ctx.addIssue({ code: 'custom', path: ['fecha_fin'], message: 'La fecha de fin es anterior a la de inicio' })
    }
  })
export type ContratoFormInput = z.infer<typeof contratoFormSchema>

/** ¿Está completo para ACTIVAR? Espejo de los requisitos del trigger (modalidad, moneda, periodicidad+importe, responsable). */
export function faltantesParaActivar(c: {
  modalidad?: string | null
  moneda?: string | null
  periodicidad?: string | null
  importe_periodico?: number | null
  responsable_id?: string | null
}): string[] {
  const f: string[] = []
  if (!c.modalidad) f.push('modalidad')
  if (!c.moneda) f.push('moneda')
  if (c.modalidad === 'recurrente') {
    if (!c.periodicidad) f.push('periodicidad')
    if (c.importe_periodico == null) f.push('importe periódico')
  }
  if (!c.responsable_id) f.push('responsable')
  return f
}

export const cambioEstadoContratoSchema = z
  .object({
    estado: z.enum(['activo', 'suspendido', 'vencido', 'terminado', 'cancelado']),
    motivo: texto(500).nullable().or(z.literal('').transform(() => null)),
  })
  .refine((v) => !ESTADOS_CON_MOTIVO.includes(v.estado as EstadoContratoProveedor) || !!v.motivo, {
    message: 'Este cambio de estado exige indicar el motivo',
    path: ['motivo'],
  })
export type CambioEstadoContratoInput = z.infer<typeof cambioEstadoContratoSchema>

// ── Reglas de compra (cuentas sugeridas) ─────────────────────────────────────

export const reglaCompraFormSchema = z
  .object({
    destino: z.enum(['gasto', 'costo', 'inventario', 'activo_fijo']),
    /** Una regla clasifica por categoría O por producto; nunca por ninguna. */
    clasifica_por: z.enum(['categoria', 'producto']),
    categoria: z.string().trim().nullable(),
    suministro_id: z.string().uuid().nullable(),
    proveedor_id: z.string().uuid().nullable(),
    cuenta_id: z.string().uuid('Elige la cuenta'),
    vigente_desde: fechaISO,
    notas: opcional(300),
  })
  .superRefine((v, ctx) => {
    if (v.clasifica_por === 'categoria' && !v.categoria) {
      ctx.addIssue({ code: 'custom', path: ['categoria'], message: 'Elige la categoría' })
    }
    if (v.clasifica_por === 'producto' && !v.suministro_id) {
      ctx.addIssue({ code: 'custom', path: ['suministro_id'], message: 'Elige el producto' })
    }
  })
export type ReglaCompraFormInput = z.infer<typeof reglaCompraFormSchema>

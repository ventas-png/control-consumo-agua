// agua:C6 — Schemas de Zod para el dominio Agua. Spike inicial.
//
// Por qué Zod (y no solo TypeScript): TS valida estáticamente las shapes a
// dev-time, pero no detecta strings vacíos, números fuera de rango, ni
// payloads malformados que llegan desde Supabase, imports CSV o cuerpos
// JSON. Zod corre en runtime y devuelve errores granulares por campo —
// ideal para inputs de usuario y boundaries de I/O.
//
// Roadmap de adopción (cond:A4 / agua:C6 part 2 +):
//   1. Este PR: schemas + tests. Sin adopción todavía (zero-blast-radius).
//   2. Migrar formularios uno por uno a `react-hook-form` con `zodResolver`
//      — los schemas ya son la fuente de verdad cliente↔DB.
//   3. Wrappers para `supabase.from(...).insert(payload)` que validen antes
//      de enviar (atrapa drifts entre TS types y reglas de negocio).
//   4. Edge functions: re-usar los mismos schemas para validar payloads
//      al entrar a la función (defense in depth con el CHECK constraint).
//
// Convención: los schemas terminan en `Schema`; los tipos inferidos derivan
// del schema (`type X = z.infer<typeof xSchema>`). Eso evita el doble
// mantenimiento (interface duplicada de la del schema).

import { z } from 'zod'

// ── Utilidades compartidas ──────────────────────────────────────────────────
// Convención: usamos `.trim()` en todos los strings de input de usuario para
// evitar que un espacio en blanco pase como valor "presente". `min(1)` se
// aplica después del trim así que rechaza correctamente "  ".

const nombreField = z.string().trim().min(1, 'El nombre es obligatorio')
const codigoField = z.string().trim().min(1, 'El código es obligatorio')
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email con formato inválido')
const telefonoField = z
  .string()
  .trim()
  .regex(
    /^(\+\d{7,15}|\d{8})$/,
    'Teléfono inválido (formato E.164 con + o exactamente 8 dígitos)',
  )

// `optional().or(literal(''))` permite que el campo venga ausente, undefined,
// null o como string vacío — todos equivalen a "no especificado".
const optionalEmail = z.union([emailField, z.literal(''), z.null()]).optional()
const optionalTelefono = z.union([telefonoField, z.literal(''), z.null()]).optional()
const optionalString = z.union([z.string().trim(), z.null()]).optional()

// ── Cliente ─────────────────────────────────────────────────────────────────
// Schema para INPUT de creación/edición de un cliente (el formulario en UI).
// No incluye `id`/`updated_at`/`updated_by` que son responsabilidad de la
// capa de datos (Supabase los genera).
export const clienteInputSchema = z.object({
  nombre: nombreField,
  codigo: codigoField,
  medidor: optionalString,
  lectura_inicial: z.coerce.number().min(0, 'Debe ser ≥ 0').optional(),
  email: optionalEmail,
  direccion: optionalString,
  telefono: optionalTelefono,
  whatsapp: optionalTelefono,
  puede_crear_cuenta: z.boolean().optional(),
  nacionalidad: optionalString,
  cui_dui: optionalString,
  fecha_nacimiento: optionalString, // 'YYYY-MM-DD'; validación de fecha real al integrar el form
  numero_facturacion: optionalString,
  telefono_alterno: optionalTelefono,
})

export type ClienteInput = z.infer<typeof clienteInputSchema>

// ── Contador ────────────────────────────────────────────────────────────────
// Mismas razones que cliente: input sin `id`/timestamps.
const tipoAguaEnum = z.enum([
  'potable',
  'rehuso',
  'piscina',
  'desalinada',
  'riego',
  'jacuzzi',
  'consumo_humano',
  'desmineralizada',
  'residuales_tratadas',
])

export const contadorInputSchema = z.object({
  project_id: z.string().uuid('project_id debe ser UUID'),
  company_id: z.string().uuid('company_id debe ser UUID'),
  numero_serie: z.string().trim().min(1, 'Número de serie obligatorio'),
  tipo_agua: tipoAguaEnum,
  descripcion: optionalString,
  marca: optionalString,
  modelo: optionalString,
  fecha_instalacion: optionalString,
  lectura_inicial: z.coerce.number().min(0, 'Lectura inicial debe ser ≥ 0'),
  activo: z.boolean(),
  tarifa_id: z.union([z.string().uuid(), z.null()]).optional(),
  unidad_id: z.union([z.string().uuid(), z.null()]).optional(),
})

export type ContadorInput = z.infer<typeof contadorInputSchema>

// ── Lectura (Registro) ──────────────────────────────────────────────────────
// Solo los campos que el operador captura. La regla de negocio
// `lectura_actual >= lectura_anterior` se valida con `validarLectura()` de
// `src/lib/business.ts` porque depende del estado (reset del medidor,
// promedio histórico). Acá nos limitamos a la SHAPE.
export const lecturaInputSchema = z.object({
  cliente_id: z.string().uuid('cliente_id debe ser UUID'),
  contador_id: z.union([z.string().uuid(), z.null()]).optional(),
  project_id: z.union([z.string().uuid(), z.null()]).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe ser YYYY-MM-DD'),
  lectura_anterior: z.coerce.number().min(0, 'Lectura anterior debe ser ≥ 0'),
  lectura_actual: z.coerce.number().min(0, 'Lectura actual debe ser ≥ 0'),
  notas: optionalString,
  // GPS opcional — viene del navegador al capturar en campo.
  gps: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  // Foto base64 opcional — comprimida client-side antes de enviar.
  foto: optionalString,
})

export type LecturaInput = z.infer<typeof lecturaInputSchema>

// ── Helper: parsing con error amigable ─────────────────────────────────────
// `safeParse + flatten` da un objeto `{ field: ["msg1", "msg2"] }` que es
// fácil de pintar en un formulario sin armar el árbol de ZodError a mano.
// Los formularios que adopten react-hook-form usarán `zodResolver` y no
// necesitarán este helper; sirve para sitios fuera-de-form (e.g. importadores
// CSV, validación pre-insert en repos).
export interface ParseFailure {
  ok: false
  fieldErrors: Record<string, string[]>
  formErrors: string[]
}
export interface ParseSuccess<T> {
  ok: true
  data: T
}
export type ParseResult<T> = ParseSuccess<T> | ParseFailure

export function safeValidate<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  const flat = result.error.flatten()
  return {
    ok: false,
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
    formErrors: flat.formErrors,
  }
}

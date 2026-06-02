// cond:C2 — Schemas de Zod para el dominio Condominios.
// Réplica del patrón establecido en `src/domain/agua/schemas.ts` (PR #284),
// aplicado a las 3 entidades core del módulo: Cuota, Visitante, Amenidad.
//
// Por qué Zod en condominios: agua:C2 / cond:C1 son los hallazgos críticos
// de validación. CHECK constraints en DB sólo cubren `monto > 0` y
// `fecha_vencimiento >= now()`; reglas como "concepto requiere `unidad_id`
// si no es 'CAM'" o "hora_salida >= hora_entrada" en visitantes son
// cliente-side. Zod nos da una capa runtime compartida UI ↔ insert wrapper.
//
// Roadmap (igual que agua/C6):
//   1. Este PR: schemas + tests. Sin adopción todavía (zero blast radius).
//   2. Migrar formularios de cuotas/visitantes/amenidades a `react-hook-form`
//      con `zodResolver`.
//   3. Wrapper `validatedInsert(supabase, schema, payload)` que valide antes
//      del `from(...).insert()` — atrapa drifts entre TS y reglas de negocio.

import { z } from 'zod'

// ── Helpers compartidos (mismo patrón que agua/schemas) ─────────────────────
const uuid = z.string().uuid('Debe ser UUID')
const optionalString = z.union([z.string().trim(), z.null()]).optional()
const optionalUuid = z.union([uuid, z.null()]).optional()
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe ser YYYY-MM-DD')
const optionalYmd = z.union([ymd, z.null()]).optional()
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora debe ser HH:MM (24h)')
const optionalHhmm = z.union([hhmm, z.null()]).optional()
// `YYYY-MM-DDTHH:MM:SS...` o `YYYY-MM-DD HH:MM:SS` — timestamp ISO o de Postgres.
const isoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/,
    'Timestamp inválido (ISO 8601 o Postgres)',
  )
const optionalIsoTimestamp = z.union([isoTimestamp, z.null()]).optional()

// ── CuotaCondominio ─────────────────────────────────────────────────────────
const conceptoCuota = z.enum(['mantenimiento', 'extraordinaria', 'CAM', 'amenidad', 'otro'])
const estadoCuota = z.enum(['pendiente', 'pagado', 'moroso'])

export const cuotaInputSchema = z
  .object({
    company_id: uuid,
    project_id: uuid,
    unidad_id: optionalUuid,
    concepto: conceptoCuota,
    monto: z.coerce.number().gt(0, 'El monto debe ser > 0'),
    periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo debe ser YYYY-MM'),
    fecha_vencimiento: optionalYmd,
    estado: estadoCuota,
    notas: optionalString,
  })
  // passthrough: preserva campos system-side (id, created_at, etc.) que no
  // están en el schema input pero pertenecen a la fila completa de DB.
  .passthrough()
  .superRefine((data, ctx) => {
    // Regla de negocio: cuotas que NO son 'CAM' deben tener unidad_id.
    // CAM (Cuota de Administración Mensual / general) es la única cuota
    // global a nivel proyecto sin unidad específica.
    if (data.concepto !== 'CAM' && (!data.unidad_id || data.unidad_id === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unidad_id'],
        message: `unidad_id es obligatorio para cuotas de tipo '${data.concepto}'`,
      })
    }
  })

export type CuotaInput = z.infer<typeof cuotaInputSchema>

// ── Visitante ───────────────────────────────────────────────────────────────
export const visitanteInputSchema = z
  .object({
    company_id: uuid,
    project_id: uuid,
    unidad_id: uuid,
    nombre: z.string().trim().min(1, 'El nombre es obligatorio'),
    identificacion: optionalString,
    placa_vehiculo: optionalString,
    motivo: optionalString,
    pre_autorizado_por: optionalString,
    hora_entrada: isoTimestamp,
    hora_salida: optionalIsoTimestamp,
    notas: optionalString,
    valido_hasta: optionalIsoTimestamp,
    es_menor: z.boolean().optional(),
    fecha_nacimiento: optionalYmd,
  })
  // passthrough: preserva campos system-side (id, created_at, etc.) que no
  // están en el schema input pero pertenecen a la fila completa de DB.
  .passthrough()
  .superRefine((data, ctx) => {
    // Regla: si vino hora_salida, debe ser >= hora_entrada.
    if (data.hora_salida) {
      const entrada = Date.parse(data.hora_entrada)
      const salida = Date.parse(data.hora_salida)
      if (Number.isFinite(entrada) && Number.isFinite(salida) && salida < entrada) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hora_salida'],
          message: 'hora_salida no puede ser anterior a hora_entrada',
        })
      }
    }
    // Regla: si `es_menor === true`, fecha_nacimiento es obligatoria.
    if (data.es_menor === true && !data.fecha_nacimiento) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fecha_nacimiento'],
        message: 'fecha_nacimiento obligatoria para menores de edad',
      })
    }
  })

export type VisitanteInput = z.infer<typeof visitanteInputSchema>

// ── Amenidad ────────────────────────────────────────────────────────────────
export const amenidadInputSchema = z
  .object({
    company_id: uuid,
    project_id: uuid,
    nombre: z.string().trim().min(1, 'El nombre es obligatorio'),
    descripcion: optionalString,
    capacidad_max: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    horario_inicio: optionalHhmm,
    horario_fin: optionalHhmm,
    requiere_deposito: z.boolean(),
    monto_deposito: z.union([z.coerce.number().min(0), z.null()]).optional(),
    requiere_tarifa: z.boolean(),
    tarifa_uso: z.union([z.coerce.number().min(0), z.null()]).optional(),
    tarifa_uso_finde: z.union([z.coerce.number().min(0), z.null()]).optional(),
    max_reservas_mes_unidad: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    horas_minimas_antelacion: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
    duracion_max_horas: z.union([z.coerce.number().positive(), z.null()]).optional(),
    minutos_preparacion_previa: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
    minutos_preparacion_posterior: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
    requiere_aprobacion: z.boolean(),
    reglamento: optionalString,
    activo: z.boolean(),
  })
  // passthrough: preserva campos system-side (id, created_at, etc.) que no
  // están en el schema input pero pertenecen a la fila completa de DB.
  .passthrough()
  .superRefine((data, ctx) => {
    // Regla: si requiere depósito, monto_deposito debe ser > 0.
    if (data.requiere_deposito && (!data.monto_deposito || data.monto_deposito <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['monto_deposito'],
        message: 'monto_deposito debe ser > 0 cuando requiere_deposito es true',
      })
    }
    // Regla: si requiere tarifa, tarifa_uso debe ser > 0.
    if (data.requiere_tarifa && (!data.tarifa_uso || data.tarifa_uso <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tarifa_uso'],
        message: 'tarifa_uso debe ser > 0 cuando requiere_tarifa es true',
      })
    }
    // Regla: si vinieron ambas horas, horario_fin > horario_inicio.
    if (data.horario_inicio && data.horario_fin) {
      const [hi, mi] = data.horario_inicio.split(':').map(Number)
      const [hf, mf] = data.horario_fin.split(':').map(Number)
      const minutosInicio = hi * 60 + mi
      const minutosFin = hf * 60 + mf
      if (minutosFin <= minutosInicio) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['horario_fin'],
          message: 'horario_fin debe ser posterior a horario_inicio',
        })
      }
    }
  })

export type AmenidadInput = z.infer<typeof amenidadInputSchema>

// Re-exportamos `safeValidate` desde agua/schemas para uso compartido —
// la helper es genérica sobre cualquier schema, no atada al dominio.
export { safeValidate, type ParseResult, type ParseFailure, type ParseSuccess } from '../agua/schemas'

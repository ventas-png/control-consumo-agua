// Validación ESTRICTA del body de create-charge (B6, auditoría 2026-07-16 S9).
// Patrón I22: módulo puro sin APIs de Deno — testeable bajo vitest. El handler
// rechaza con 400 ANTES de tocar la BD; antes el body se casteaba (`as ReqBody`)
// y los campos malformados llegaban hasta las queries.
//
// Nota de diseño: el plan pedía "esquemas zod"; en los edges el patrón del repo
// es lógica pura SIN dependencias (zod queda en el frontend/validatedInsert).
// Mismas garantías: shape estricto + mensajes accionables.

export interface CreateChargeBody {
  cliente_id?: string
  registro_id?: string | null
  cuota_id?: string | null
  company_id?: string
  project_id?: string | null
  monto?: number
  ambiente?: string
  descripcion?: string
  url_retorno?: string
  url_cancelacion?: string
}

export type ValidacionBody<T> =
  | { ok: true; body: T }
  | { ok: false; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidOpcional(v: unknown, campo: string): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || !UUID_RE.test(v)) {
    throw new Error(`${campo} inválido (se espera UUID)`)
  }
  return v
}

function textoOpcional(v: unknown, campo: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new Error(`${campo} debe ser texto`)
  if (v.length > max) throw new Error(`${campo} excede ${max} caracteres`)
  return v
}

function urlOpcional(v: unknown, campo: string): string | undefined {
  const s = textoOpcional(v, campo, 2000)
  if (s === undefined || s === '') return undefined
  if (!/^https?:\/\//i.test(s)) throw new Error(`${campo} debe ser una URL http(s)`)
  return s
}

/**
 * Valida el body crudo de create-charge. Reglas:
 *  · ids (cliente/registro/cuota/company/project) → UUID válido si vienen.
 *  · exactamente un ítem a pagar: cuota_id o registro_id (el handler ya resuelve
 *    la lógica fina, pero un body sin ninguno no tiene sentido y antes avanzaba
 *    hasta fallar en la BD).
 *  · monto: número finito ≥ 0 (0/ausente = saldo completo, contrato del handler)
 *    con techo de sanidad.
 *  · ambiente: 'sandbox' | 'prod' si viene (solo lo honra service_role).
 *  · urls de retorno/cancelación: http(s), largo acotado.
 */
export function validarCreateChargeBody(raw: unknown): ValidacionBody<CreateChargeBody> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body inválido (se espera objeto JSON)' }
  }
  const r = raw as Record<string, unknown>
  try {
    const body: CreateChargeBody = {
      cliente_id: uuidOpcional(r.cliente_id, 'cliente_id') ?? undefined,
      registro_id: uuidOpcional(r.registro_id, 'registro_id'),
      cuota_id: uuidOpcional(r.cuota_id, 'cuota_id'),
      company_id: uuidOpcional(r.company_id, 'company_id') ?? undefined,
      project_id: uuidOpcional(r.project_id, 'project_id'),
      descripcion: textoOpcional(r.descripcion, 'descripcion', 500),
      url_retorno: urlOpcional(r.url_retorno, 'url_retorno'),
      url_cancelacion: urlOpcional(r.url_cancelacion, 'url_cancelacion'),
    }

    if (!body.cuota_id && !body.registro_id) {
      return { ok: false, error: 'se requiere cuota_id o registro_id' }
    }
    if (body.cuota_id && body.registro_id) {
      return { ok: false, error: 'cuota_id y registro_id son excluyentes' }
    }

    if (r.monto !== undefined && r.monto !== null) {
      const m = r.monto
      if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) {
        return { ok: false, error: 'monto debe ser un número ≥ 0' }
      }
      if (m > 10_000_000) {
        return { ok: false, error: 'monto fuera de rango' }
      }
      body.monto = m
    }

    if (r.ambiente !== undefined && r.ambiente !== null) {
      // Dominio real de normalizarAmbientePago: SOLO 'prod' cobra real.
      if (r.ambiente !== 'sandbox' && r.ambiente !== 'prod') {
        return { ok: false, error: "ambiente debe ser 'sandbox' o 'prod'" }
      }
      body.ambiente = r.ambiente
    }

    return { ok: true, body }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Cobros pluggable — Edge function `create-charge`: crea un cobro con el PAYFAC
// EFECTIVO del tenant (vía la abstracción pluggable), análoga a `timbrar-documento`
// del lado fiscal.
//
// A diferencia de `create-payment-intent` (Stripe DEDICADO, que NO se toca), esta
// función es PROVIDER-AGNOSTIC: resuelve el payfac efectivo (override locación↔
// empresa), carga sus credenciales de la bóveda (service_role) y llama
// provider.crearCobro(). Hoy enchufa sandbox (simulado) y QPayPro (real, checkout
// hospedado). Stripe se redirige a su flujo dedicado.
//
// Flujo:
//   1. CORS + auth (verify_jwt=false; service_role o JWT de un usuario del tenant).
//   2. Resolver config de pago efectiva + cargar credenciales del ambiente.
//   3. Construir el CobroCanonico desde el registro/cliente.
//   4. provider.crearCobro() → ResultadoCobro normalizado.
//   5. Registrar el payment_request (provider, estado, provider_ref).
//   6. Responder { ok, estado, redirectUrl?, clientSecret?, referencia, payment_request_id }.
//
// SEGURIDAD: las credenciales NUNCA se devuelven. No pasa datos de tarjeta por
// nuestro servidor (QPayPro usa checkout hospedado).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { captureEdgeException } from '../_shared/sentry.ts'
import {
  getPaymentProvider,
  resolverConfigPagoEfectiva,
  normalizarMonedaISO,
  type AmbientePago,
  type CobroCanonico,
  type ConfigPagoEmpresa,
  type ConfigPagoLocacion,
  type EstadoCobroProveedor,
} from '../_shared/payments/index.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''

interface ReqBody {
  cliente_id?: string
  registro_id?: string | null
  company_id?: string
  project_id?: string | null
  monto?: number
  ambiente?: string
  descripcion?: string
  url_retorno?: string
  url_cancelacion?: string
}

/** Mapea el estado normalizado del provider al estado de payment_requests. */
function estadoPaymentRequest(estado: EstadoCobroProveedor): string {
  switch (estado) {
    case 'aprobado':
      return 'succeeded'
    case 'rechazado':
    case 'error':
      return 'failed'
    default:
      // 'pendiente' | 'requiere_accion' → esperando confirmación/retorno.
      return 'pending'
  }
}

/** Credenciales del ambiente desde el jsonb opaco de la bóveda. */
function credsDeAmbiente(credenciales: unknown, ambiente: AmbientePago): Record<string, unknown> | null {
  if (typeof credenciales !== 'object' || credenciales === null) return null
  const v = (credenciales as Record<string, unknown>)[ambiente]
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()

    // ── 1) Auth: service_role (interno) o JWT de un usuario del tenant ──
    let callerCompanyId: string | null = null
    let internal = false
    if (token && token === SERVICE_ROLE_KEY) {
      internal = true
    } else if (token) {
      // Validamos el JWT con un client anon que lleva el token del llamante.
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: { user }, error } = await callerClient.auth.getUser()
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      const { data: au } = await admin
        .from('app_users')
        .select('company_id')
        .eq('id', user.id)
        .maybeSingle()
      callerCompanyId = (au as { company_id?: string } | null)?.company_id ?? null
      if (!callerCompanyId) return json({ error: 'Forbidden' }, 403)
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody
    const clienteId = body.cliente_id
    const registroId = body.registro_id ?? null
    const projectId = body.project_id ?? null
    const monto = Number(body.monto)
    const ambiente: AmbientePago = body.ambiente === 'prod' ? 'prod' : 'sandbox'

    if (!clienteId || !body.company_id || !(monto > 0)) {
      return json({ error: 'Parámetros inválidos (cliente_id, company_id, monto > 0).' }, 400)
    }
    const companyId = body.company_id

    // Autorización por tenant: el llamante debe pertenecer a la empresa del cobro.
    if (!internal && callerCompanyId !== companyId) {
      return json({ error: 'No autorizado para cobrar a nombre de otra empresa' }, 403)
    }

    // ── 2) Config de pago efectiva + credenciales del ambiente ──
    const { data: company, error: compErr } = await admin
      .from('companies')
      .select('id, proveedor_pago, default_currency')
      .eq('id', companyId)
      .maybeSingle()
    if (compErr) return json({ error: compErr.message }, 500)
    if (!company) return json({ error: 'Empresa no encontrada' }, 404)

    let projectRow: { proveedor_pago?: string | null; moneda?: string | null } | null = null
    if (projectId) {
      const { data: proj } = await admin
        .from('projects')
        .select('proveedor_pago, moneda')
        .eq('id', projectId)
        .maybeSingle()
      projectRow = (proj as typeof projectRow) ?? null
    }

    const empresaConfig: ConfigPagoEmpresa = {
      proveedorPago: (company as { proveedor_pago?: string | null }).proveedor_pago ?? null,
      monedaDefault: (company as { default_currency?: string | null }).default_currency ?? null,
    }
    const config = resolverConfigPagoEfectiva(
      empresaConfig,
      projectRow ? ({ proveedorPago: projectRow.proveedor_pago ?? null } as ConfigPagoLocacion) : null,
    )

    // Moneda del COBRO: la del RECIBO (projects.moneda, p. ej. 'Q' = GTQ), NO el
    // default genérico de la empresa (companies.default_currency, que puede estar
    // en otra moneda como 'usd'). La normalizamos al código ISO 4217 que el payfac
    // espera (x_currency_code en QPayPro). Fallback: default de la empresa → 'GTQ'.
    const monedaCobro = normalizarMonedaISO(
      projectRow?.moneda ??
        (company as { default_currency?: string | null }).default_currency ??
        config.moneda,
    )

    // Stripe usa su flujo dedicado: no pasa por el adapter genérico.
    if (config.proveedorPago === 'stripe') {
      return json(
        { error: 'Stripe se cobra por su flujo dedicado: usa la función create-payment-intent.' },
        400,
      )
    }

    let credLookup = admin.from('payfac_secrets').select('credenciales').eq('company_id', companyId)
    credLookup = projectId === null ? credLookup.is('project_id', null) : credLookup.eq('project_id', projectId)
    const { data: secretRow } = await credLookup.maybeSingle()
    const credenciales = credsDeAmbiente((secretRow as { credenciales?: unknown } | null)?.credenciales, ambiente)

    // ── 3) Construir el CobroCanonico (datos del cliente para el recibo) ──
    const { data: cliente } = await admin
      .from('clientes')
      .select('nombre, email, telefono, nit')
      .eq('id', clienteId)
      .maybeSingle()
    const cli = (cliente as { nombre?: string; email?: string; telefono?: string; nit?: string } | null) ?? null

    const base = APP_URL || origin || ''
    const cobro: CobroCanonico = {
      monto,
      moneda: monedaCobro,
      descripcion: body.descripcion?.trim() || `Pago de servicio — ${cli?.nombre ?? 'Cliente'}`,
      referenciaInterna: registroId ?? clienteId,
      pagador: {
        nombre: cli?.nombre ?? null,
        email: cli?.email ?? null,
        telefono: cli?.telefono ?? null,
        identificador: cli?.nit ?? null,
      },
      urlRetorno: body.url_retorno ?? (base ? `${base}/portal?pago=ok` : null),
      urlCancelacion: body.url_cancelacion ?? (base ? `${base}/portal?pago=cancelado` : null),
      metadata: { company_id: companyId, cliente_id: clienteId, ...(registroId ? { registro_id: registroId } : {}) },
    }

    // ── 4) Crear el cobro con el payfac efectivo ──
    const provider = getPaymentProvider({
      companyId,
      proveedor: config.proveedorPago,
      ambiente,
      moneda: monedaCobro,
      credenciales,
    })

    let resultado
    try {
      resultado = await provider.crearCobro(cobro)
    } catch (e) {
      // Stub no integrado (PayfacNoConfiguradoError) u otro fallo: respuesta clara.
      return json(
        { ok: false, estado: 'error', error: e instanceof Error ? e.message : 'No se pudo crear el cobro.' },
        400,
      )
    }

    // ── 5) Registrar el payment_request (auditoría + idempotencia por provider_ref) ──
    const { data: pr, error: prErr } = await admin
      .from('payment_requests')
      .insert({
        cliente_id: clienteId,
        registro_id: registroId,
        company_id: companyId,
        monto,
        provider: config.proveedorPago,
        estado: estadoPaymentRequest(resultado.estado),
        provider_ref: resultado.referencia ?? null,
        referencia: cobro.referenciaInterna,
      })
      .select('id')
      .maybeSingle()
    if (prErr) {
      // No bloquea el cobro ya creado; lo reportamos como advertencia.
      console.error('Error registrando payment_request:', prErr.message)
    }

    // ── 6) Responder (SIN credenciales) ──
    return json({
      ok: resultado.ok,
      estado: resultado.estado,
      proveedor: provider.nombre,
      referencia: resultado.referencia ?? null,
      redirectUrl: resultado.redirectUrl ?? null,
      clientSecret: resultado.clientSecret ?? null,
      payment_request_id: (pr as { id?: string } | null)?.id ?? null,
      error: resultado.error ?? null,
    })
  } catch (e) {
    await captureEdgeException(e, { function: 'create-charge' })
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})

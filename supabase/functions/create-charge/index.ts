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
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { validarCreateChargeBody } from './validate.ts'
import { captureEdgeException } from '../_shared/sentry.ts'
import { decryptJson } from '../_shared/secretsCrypto.ts'
import {
  credencialesEfectivasDeAmbiente,
  getPaymentProvider,
  resolverConfigPagoEfectiva,
  normalizarAmbientePago,
  normalizarMonedaISO,
  type AmbientePago,
  type CobroCanonico,
  type ConfigPagoEmpresa,
  type ConfigPagoLocacion,
  type EstadoCobroProveedor,
} from '../_shared/payments/index.ts'
import { residentePuedePagarCuota } from '../_shared/payments/reconcile.ts'
import { calcularComision, type ComisionConfigRow } from '../_shared/payments/comision.ts'
import { calcularRecargo, totalConRecargo, type RecargoConfigRow } from '../_shared/payments/recargo.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''

interface ReqBody {
  cliente_id?: string
  registro_id?: string | null
  /** Cuota de condominio a pagar (portal del residente). Alternativo a registro_id. */
  cuota_id?: string | null
  company_id?: string
  project_id?: string | null
  monto?: number
  /** Override del ambiente SOLO para llamadas internas (service_role); los demás
   *  cobran con el ambiente configurado por el tenant (ambiente_pago). */
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

    // ── 1) Auth: service_role (interno), JWT de un usuario del tenant, o JWT de
    //    un RESIDENTE (rol cliente). El residente no tiene company_id: se autoriza
    //    por PROPIEDAD del ítem (su unidad) más abajo. ──
    let callerCompanyId: string | null = null
    let callerClienteId: string | null = null
    let callerUserId: string | null = null
    let internal = false
    if (token && (await timingSafeEqualSecret(token, SERVICE_ROLE_KEY))) {
      internal = true
    } else if (token) {
      // Validamos el JWT con un client anon que lleva el token del llamante.
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: { user }, error } = await callerClient.auth.getUser()
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      callerUserId = user.id
      const { data: au } = await admin
        .from('app_users')
        .select('company_id, cliente_id')
        .eq('id', user.id)
        .maybeSingle()
      const auRow = au as { company_id?: string | null; cliente_id?: string | null } | null
      callerCompanyId = auRow?.company_id ?? null
      callerClienteId = auRow?.cliente_id ?? null
      // Un usuario de tenant sin company_id NI cliente_id no tiene sobre qué operar.
      if (!callerCompanyId && !callerClienteId) return json({ error: 'Forbidden' }, 403)
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    // Rate limit por usuario (auditoría S6: el camino de dinero no tenía tope).
    // Interno (service_role/cron) exento; fail-open si el contador falla.
    if (!internal && callerUserId) {
      const rl = await enforceRateLimit(admin, {
        subject: callerUserId,
        action: 'create_charge',
        max: 30,
        message: 'Demasiados intentos de pago en poco tiempo. Espera unos minutos e intenta de nuevo.',
      }, corsHeaders)
      if (rl) return rl
    }

    // B6 (S9): validación estricta del body ANTES de tocar la BD — shape,
    // UUIDs, monto acotado, ambiente permitido, URLs http(s). 400 accionable.
    const validacion = validarCreateChargeBody(await req.json().catch(() => ({})))
    if (!validacion.ok) {
      return new Response(JSON.stringify({ error: `body inválido: ${validacion.error}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const body: ReqBody = validacion.body
    const cuotaId = body.cuota_id ?? null
    const registroIdBody = body.registro_id ?? null

    // Valores del ÍTEM a pagar, resueltos según sea CUOTA (condominio) o REGISTRO (agua).
    let companyId: string
    let projectId: string | null
    let clienteId: string
    let registroId: string | null = null
    let monto: number
    let descripcionItem = ''

    if (cuotaId) {
      // ── Pago de una CUOTA de condominio (portal del residente o admin) ──
      const { data: cuotaRow, error: cuErr } = await admin
        .from('cuotas_condominio')
        .select('company_id, project_id, unidad_id, rol_responsable, concepto, periodo, monto, total_a_pagar, cuota_estado, deleted_at')
        .eq('id', cuotaId)
        .maybeSingle()
      if (cuErr) return json({ error: cuErr.message }, 500)
      const cuota = cuotaRow as {
        company_id: string; project_id: string | null; unidad_id: string | null
        rol_responsable: string | null
        concepto: string; periodo: string; monto: number; total_a_pagar: number | null
        cuota_estado: string; deleted_at: string | null
      } | null
      if (!cuota || cuota.deleted_at) return json({ error: 'Cuota no encontrada' }, 404)

      // Cliente dueño de la unidad de la cuota (unidades.cliente_id).
      const { data: uni } = await admin
        .from('unidades').select('cliente_id').eq('id', cuota.unidad_id ?? '').maybeSingle()
      const uniClienteId = (uni as { cliente_id?: string | null } | null)?.cliente_id ?? null

      // Rol del residente llamante en ESA unidad (espeja la RLS del SELECT de
      // cuotas_condominio): dueño (unidades.cliente_id) → 'propietario'; si no, su
      // membresía activa en unidad_residentes (tipo). null = no es residente.
      let callerRolEnUnidad: string | null = null
      if (callerClienteId) {
        if (uniClienteId === callerClienteId) {
          callerRolEnUnidad = 'propietario'
        } else if (cuota.unidad_id) {
          const { data: ur } = await admin
            .from('unidad_residentes')
            .select('tipo')
            .eq('unidad_id', cuota.unidad_id)
            .eq('cliente_id', callerClienteId)
            .eq('activo', true)
            .maybeSingle()
          callerRolEnUnidad = (ur as { tipo?: string } | null)?.tipo ?? null
        }
      }

      // AUTORIZACIÓN. Residente: debe ser residente activo de la unidad Y la cuota
      // no estar diferenciada (rol_responsable NULL) o ser de su rol — MISMA regla
      // que la RLS del portal ("ocultar del otro"), aplicada aquí server-side porque
      // la función carga con service_role (sin RLS). Usuario de tenant: su empresa.
      if (!internal) {
        if (callerClienteId) {
          if (!residentePuedePagarCuota(cuota.rol_responsable, callerRolEnUnidad)) {
            return json({ error: 'No autorizado para pagar esta cuota' }, 403)
          }
        } else if (callerCompanyId !== cuota.company_id) {
          return json({ error: 'No autorizado para cobrar cuotas de otra empresa' }, 403)
        }
      }

      // Solo cuotas emitidas/vencidas son pagables (no pendientes/pagadas/anuladas).
      if (cuota.cuota_estado !== 'emitida' && cuota.cuota_estado !== 'vencida') {
        return json({ error: `La cuota no está disponible para pago (estado: ${cuota.cuota_estado}).` }, 409)
      }

      // Saldo = total_a_pagar (con mora) − abonos ya registrados (pagos no borrados).
      const totalCuota = Number(cuota.total_a_pagar ?? cuota.monto)
      const { data: pagosPrevios } = await admin
        .from('pagos').select('monto').eq('cuota_id', cuotaId).is('deleted_at', null)
      const abonado = ((pagosPrevios as { monto: number }[] | null) ?? []).reduce((s, p) => s + Number(p.monto), 0)
      const saldo = Math.max(0, totalCuota - abonado)
      if (saldo <= 0) return json({ error: 'La cuota ya está saldada.' }, 409)

      // Monto: abono parcial pedido (acotado al saldo) o el saldo completo.
      const pedido = Number(body.monto)
      monto = pedido > 0 ? Math.min(pedido, saldo) : saldo
      companyId = cuota.company_id
      projectId = cuota.project_id
      // Pagador: el residente que paga (callerClienteId, p. ej. el inquilino) o, si
      // es staff/interno, el dueño de la unidad. Se necesita alguno para el recibo
      // y el payment_request (confirm-charge lo usa como dueño de la solicitud).
      clienteId = callerClienteId ?? uniClienteId ?? ''
      if (!clienteId) return json({ error: 'No hay cliente asociado para el pago de la cuota.' }, 409)
      descripcionItem = `${cuota.concepto} — ${cuota.periodo}`
    } else if (registroIdBody) {
      // ── Pago de un REGISTRO de agua (portal del residente o admin) ──
      const { data: regRow, error: regErr } = await admin
        .from('registros')
        .select('cliente_id, project_id, monto_calculado, total_a_pagar, monto_pagado, factura_estado, deleted_at')
        .eq('id', registroIdBody)
        .maybeSingle()
      if (regErr) return json({ error: regErr.message }, 500)
      const reg = regRow as {
        cliente_id: string | null; project_id: string | null
        monto_calculado: number | null; total_a_pagar: number | null; monto_pagado: number | null
        factura_estado: string | null; deleted_at: string | null
      } | null
      if (!reg || reg.deleted_at) return json({ error: 'Recibo no encontrado' }, 404)
      if (reg.factura_estado === 'anulada') return json({ error: 'El recibo está anulado.' }, 409)

      // registros no tiene company_id: se deriva del proyecto.
      let regCompanyId: string | null = null
      if (reg.project_id) {
        const { data: proj } = await admin.from('projects').select('company_id').eq('id', reg.project_id).maybeSingle()
        regCompanyId = (proj as { company_id?: string | null } | null)?.company_id ?? null
      }
      if (!regCompanyId) return json({ error: 'El recibo no tiene empresa asociada.' }, 409)

      // Propiedad: el residente debe ser el cliente del recibo; el usuario de
      // tenant, de la empresa; service_role es interno.
      if (!internal) {
        if (callerClienteId) {
          if (reg.cliente_id !== callerClienteId) return json({ error: 'No autorizado para pagar este recibo' }, 403)
        } else if (callerCompanyId !== regCompanyId) {
          return json({ error: 'No autorizado para cobrar recibos de otra empresa' }, 403)
        }
      }

      // Saldo = total_a_pagar (o monto_calculado) − monto_pagado.
      const totalReg = Number(reg.total_a_pagar ?? reg.monto_calculado ?? 0)
      const abonado = Number(reg.monto_pagado ?? 0)
      const saldo = Math.max(0, totalReg - abonado)
      if (saldo <= 0) return json({ error: 'El recibo ya está saldado.' }, 409)
      const pedido = Number(body.monto)
      monto = pedido > 0 ? Math.min(pedido, saldo) : saldo

      companyId = regCompanyId
      projectId = reg.project_id
      registroId = registroIdBody
      clienteId = reg.cliente_id ?? callerClienteId ?? ''
      if (!clienteId) return json({ error: 'El recibo no tiene cliente asociado.' }, 409)
      descripcionItem = body.descripcion?.trim() || 'Pago de servicio de agua'
    } else {
      // ── Cobro genérico (solo tenant/interno; requiere company_id + cliente_id) ──
      if (callerClienteId && !callerCompanyId) {
        return json({ error: 'El residente solo puede pagar cuotas o recibos específicos.' }, 403)
      }
      clienteId = body.cliente_id ?? ''
      monto = Number(body.monto)
      if (!clienteId || !body.company_id || !(monto > 0)) {
        return json({ error: 'Parámetros inválidos (cliente_id, company_id, monto > 0).' }, 400)
      }
      companyId = body.company_id
      projectId = body.project_id ?? null
      if (!internal && callerCompanyId !== companyId) {
        return json({ error: 'No autorizado para cobrar a nombre de otra empresa' }, 403)
      }
    }

    // ── 2) Config de pago efectiva + credenciales del ambiente ──
    const { data: company, error: compErr } = await admin
      .from('companies')
      .select('id, proveedor_pago, default_currency, ambiente_pago, pago_sandbox_demo')
      .eq('id', companyId)
      .maybeSingle()
    if (compErr) return json({ error: compErr.message }, 500)
    if (!company) return json({ error: 'Empresa no encontrada' }, 404)

    let projectRow: { proveedor_pago?: string | null; moneda?: string | null; ambiente_pago?: string | null } | null = null
    if (projectId) {
      const { data: proj } = await admin
        .from('projects')
        .select('proveedor_pago, moneda, ambiente_pago')
        .eq('id', projectId)
        .maybeSingle()
      projectRow = (proj as typeof projectRow) ?? null
    }

    const empresaConfig: ConfigPagoEmpresa = {
      proveedorPago: (company as { proveedor_pago?: string | null }).proveedor_pago ?? null,
      monedaDefault: (company as { default_currency?: string | null }).default_currency ?? null,
      ambientePago: (company as { ambiente_pago?: string | null }).ambiente_pago ?? null,
    }
    const config = resolverConfigPagoEfectiva(
      empresaConfig,
      projectRow
        ? ({
            proveedorPago: projectRow.proveedor_pago ?? null,
            ambientePago: projectRow.ambiente_pago ?? null,
          } as ConfigPagoLocacion)
        : null,
    )

    // Ambiente EFECTIVO del cobro: decisión del TENANT (ambiente_pago de la
    // locación/empresa), resuelta server-side. El body SOLO lo sobreescribe en
    // llamadas internas (service_role): un pagador no puede forzar sandbox (que
    // "aprobaría" un cobro simulado) ni prod.
    const ambiente: AmbientePago =
      internal && body.ambiente ? normalizarAmbientePago(body.ambiente) : config.ambiente

    // Moneda del COBRO: la del RECIBO (projects.moneda, p. ej. 'Q' = GTQ), NO el
    // default genérico de la empresa (companies.default_currency, que puede estar
    // en otra moneda como 'usd'). La normalizamos al código ISO 4217 que el payfac
    // espera (x_currency_code en QPayPro). Fallback: default de la empresa → 'GTQ'.
    const monedaCobro = normalizarMonedaISO(
      projectRow?.moneda ??
        (company as { default_currency?: string | null }).default_currency ??
        config.moneda,
    )

    // ── Gate anti-sandbox (auditoría C1): 'sandbox' es el DEFAULT de toda
    // empresa (NOT NULL DEFAULT), aprueba siempre y liquidaría deuda REAL sin
    // dinero real. Solo se permite si el tenant activó el flag explícito de
    // demo (pago_sandbox_demo) o en llamadas internas (service_role). ──
    const sandboxDemo = (company as { pago_sandbox_demo?: boolean | null }).pago_sandbox_demo === true
    if (config.proveedorPago === 'sandbox' && !internal && !sandboxDemo) {
      return json(
        { error: 'El pago en línea no está disponible: la empresa aún no ha configurado un proveedor de pagos.' },
        403,
      )
    }

    // Stripe usa su flujo dedicado: no pasa por el adapter genérico.
    if (config.proveedorPago === 'stripe') {
      return json(
        { error: 'Stripe se cobra por su flujo dedicado: usa la función create-payment-intent.' },
        400,
      )
    }

    // Credenciales EFECTIVAS con herencia locación→empresa (mismo criterio que
    // resolverConfigPagoEfectiva): un ítem con proyecto usa la fila del proyecto
    // si trae credenciales del ambiente; si no, hereda la fila de la empresa
    // (project_id NULL, donde la UI las conecta a nivel empresa).
    let credLookup = admin.from('payfac_secrets').select('project_id, credenciales').eq('company_id', companyId)
    credLookup = projectId === null
      ? credLookup.is('project_id', null)
      : credLookup.or(`project_id.eq.${projectId},project_id.is.null`)
    const { data: secretRows } = await credLookup
    const filas = ((secretRows as { project_id: string | null; credenciales?: unknown }[] | null) ?? [])
    // P0 #7: descifrar los blobs jsonb en reposo (dual-read: objeto legacy pasa igual).
    const credenciales = credencialesEfectivasDeAmbiente(
      await decryptJson(filas.find((f) => f.project_id !== null)?.credenciales),
      await decryptJson(filas.find((f) => f.project_id === null)?.credenciales),
      ambiente,
    )

    // ── 2c) Recargo por pago con tarjeta (config del TENANT, tabla
    // recargo_tarjeta_config): se SUMA al total que cobra el payfac; el abono
    // al recibo/cuota sigue siendo `monto` (payment_requests.monto, que es lo
    // que concilia confirm-charge). Aplica en TODOS los ambientes — es el
    // total del checkout del cliente final, no facturación de plataforma. ──
    const { data: recRows } = await admin
      .from('recargo_tarjeta_config')
      .select('canal, activo, pct, fijo')
      .eq('company_id', companyId)
    const recargoCalc = calcularRecargo(monto, config.proveedorPago, (recRows as RecargoConfigRow[] | null) ?? [])
    const totalCobro = totalConRecargo(monto, recargoCalc.recargo)

    // ── 3) Construir el CobroCanonico (datos del cliente para el recibo) ──
    const { data: cliente } = await admin
      .from('clientes')
      .select('nombre, email, telefono, nit')
      .eq('id', clienteId)
      .maybeSingle()
    const cli = (cliente as { nombre?: string; email?: string; telefono?: string; nit?: string } | null) ?? null

    const descripcionBase = descripcionItem || body.descripcion?.trim() || `Pago — ${cli?.nombre ?? 'Cliente'}`
    const base = APP_URL || origin || ''
    const cobro: CobroCanonico = {
      // El proveedor cobra el TOTAL (monto + recargo de tarjeta).
      monto: totalCobro,
      moneda: monedaCobro,
      descripcion: recargoCalc.recargo != null
        ? `${descripcionBase} · incluye recargo por pago con tarjeta ${recargoCalc.recargo.toFixed(2)} ${monedaCobro.toUpperCase()}`
        : descripcionBase,
      referenciaInterna: registroId ?? cuotaId ?? clienteId,
      pagador: {
        nombre: cli?.nombre ?? null,
        email: cli?.email ?? null,
        telefono: cli?.telefono ?? null,
        identificador: cli?.nit ?? null,
      },
      urlRetorno: body.url_retorno ?? (base ? `${base}/portal?pago=ok` : null),
      urlCancelacion: body.url_cancelacion ?? (base ? `${base}/portal?pago=cancelado` : null),
      metadata: {
        company_id: companyId, cliente_id: clienteId,
        ...(registroId ? { registro_id: registroId } : {}),
        ...(cuotaId ? { cuota_id: cuotaId } : {}),
      },
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

    // ── 4b) Comisión de plataforma (F7): config por empresa+canal, sellada en
    // el payment_request. SOLO ambiente prod — sandbox/demo jamás factura.
    let comisionCalc: ReturnType<typeof calcularComision> = { comision: null, detalle: null }
    if (ambiente === 'prod') {
      const { data: comRows } = await admin
        .from('comision_config')
        .select('canal, activo, pct, fijo')
        .eq('company_id', companyId)
      comisionCalc = calcularComision(monto, config.proveedorPago, (comRows as ComisionConfigRow[] | null) ?? [])
    }

    // ── 5) Registrar el payment_request (auditoría + idempotencia por provider_ref) ──
    const { data: pr, error: prErr } = await admin
      .from('payment_requests')
      .insert({
        cliente_id: clienteId,
        registro_id: registroId,
        cuota_id: cuotaId,
        company_id: companyId,
        monto,
        provider: config.proveedorPago,
        // Sello del ambiente del cobro: confirm-charge confirma contra ESTE
        // ambiente aunque el tenant cambie su config antes del retorno.
        ambiente,
        estado: estadoPaymentRequest(resultado.estado),
        provider_ref: resultado.referencia ?? null,
        referencia: cobro.referenciaInterna,
        comision: comisionCalc.comision,
        comision_detalle: comisionCalc.detalle,
        recargo: recargoCalc.recargo,
        recargo_detalle: recargoCalc.detalle,
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
      // Desglose del checkout: abono al recibo/cuota = monto; el proveedor
      // cobró total_cobrado (monto + recargo de tarjeta, si aplica).
      recargo: recargoCalc.recargo,
      total_cobrado: totalCobro,
      error: resultado.error ?? null,
    })
  } catch (e) {
    await captureEdgeException(e, { function: 'create-charge' })
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})

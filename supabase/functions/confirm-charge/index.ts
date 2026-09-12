// Cobros pluggable — Edge `confirm-charge`: CONFIRMA (server-side) un cobro en
// línea y lo CONCILIA (marca el pago). Complemento de create-charge.
//
// Por qué server-side: los params que el payfac devuelve al navegador tras el
// checkout NO son confiables (spoofeables). La única confirmación válida es
// preguntarle al provider (consultarEstado) desde el servidor. Aquí, si el
// provider reporta 'aprobado', se llama a `conciliar_pago_externo`, que en UNA
// transacción inserta el `pagos`, acredita el ítem y cierra la solicitud.
// Habilita ABONOS parciales.
//
// Idempotente: reintentos (retorno del portal + cron de reconciliación) no
// duplican el pago ni re-liquidan el ítem. La idempotencia NO es un `SELECT`
// previo —dos confirmaciones simultáneas lo pasaban las dos— sino un UNIQUE
// sobre `pagos.payment_request_id`, más el bloqueo de la solicitud dentro de
// la RPC (migración 20260911042839).
//
// Auth: service_role (cron), usuario de tenant, o RESIDENTE (rol cliente)
// dueño del ítem. verify_jwt=false en config.toml.
//
// Ítems soportados:
//   • F1 — CUOTA de condominio (payment_requests.cuota_id): el acumulador es la
//     suma de `pagos`; al liquidar transiciona cuotas_condominio a 'pagada'.
//   • F2 — REGISTRO de agua (payment_requests.registro_id): el acumulador vive en
//     `registros.monto_pagado`; al liquidar marca estado='pagado' y —si hay
//     factura emitida/vencida— factura_estado='pagada'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { validarConfirmChargeBody } from './validate.ts'
import { captureEdgeException } from '../_shared/sentry.ts'
import { decryptJson } from '../_shared/secretsCrypto.ts'
import {
  credencialesEfectivasDeAmbiente,
  getPaymentProvider,
  normalizarAmbientePago,
  resolverConfigPagoEfectiva,
  type AmbientePago,
  type ConfigPagoEmpresa,
  type ConfigPagoLocacion,
} from '../_shared/payments/index.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

interface ReqBody {
  payment_request_id?: string
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()

    // ── 1) Auth: service_role, usuario de tenant, o residente (rol cliente) ──
    let callerCompanyId: string | null = null
    let callerClienteId: string | null = null
    let callerUserId: string | null = null
    let internal = false
    if (token && (await timingSafeEqualSecret(token, SERVICE_ROLE_KEY))) {
      internal = true
    } else if (token) {
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: { user }, error } = await callerClient.auth.getUser()
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      callerUserId = user.id
      const { data: au } = await admin
        .from('app_users').select('company_id, cliente_id').eq('id', user.id).maybeSingle()
      const auRow = au as { company_id?: string | null; cliente_id?: string | null } | null
      callerCompanyId = auRow?.company_id ?? null
      callerClienteId = auRow?.cliente_id ?? null
      if (!callerCompanyId && !callerClienteId) return json({ error: 'Forbidden' }, 403)
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    // Rate limit por usuario (auditoría S6). El retorno del portal + polling
    // legítimo cabe de sobra en 60/h; interno (cron) exento; fail-open.
    if (!internal && callerUserId) {
      const rl = await enforceRateLimit(admin, {
        subject: callerUserId,
        action: 'confirm_charge',
        max: 60,
        message: 'Demasiadas confirmaciones de pago en poco tiempo. Espera unos minutos e intenta de nuevo.',
      }, corsHeaders)
      if (rl) return rl
    }

    // B6 (S9): validación estricta — payment_request_id obligatorio y UUID.
    const validacion = validarConfirmChargeBody(await req.json().catch(() => ({})))
    if (!validacion.ok) return json({ error: `body inválido: ${validacion.error}` }, 400)
    const prId = validacion.body.payment_request_id

    // ── 2) Cargar la solicitud de cobro ──
    const { data: prRow, error: prErr } = await admin
      .from('payment_requests')
      .select('id, cliente_id, cuota_id, registro_id, company_id, monto, provider, ambiente, estado, provider_ref')
      .eq('id', prId)
      .maybeSingle()
    if (prErr) return json({ error: prErr.message }, 500)
    const pr = prRow as {
      id: string; cliente_id: string | null; cuota_id: string | null; registro_id: string | null
      company_id: string; monto: number; provider: string; ambiente: string | null; estado: string
      provider_ref: string | null
    } | null
    if (!pr) return json({ error: 'Solicitud de cobro no encontrada' }, 404)

    // Ambiente SELLADO al crear el cobro (create-charge): se confirma contra el
    // MISMO ambiente aunque el tenant haya cambiado su config entre el checkout
    // y el retorno. No es un input del caller (era spoofeable / caía a sandbox).
    const ambiente: AmbientePago = normalizarAmbientePago(pr.ambiente)

    // El cobro es de una cuota (F1) o de un registro (F2), nunca ambos.
    const esCuota = !!pr.cuota_id
    const esRegistro = !!pr.registro_id
    if (!esCuota && !esRegistro) {
      return json({ error: 'confirm-charge concilia cuotas de condominio o recibos de agua.' }, 400)
    }
    if (!pr.cliente_id) {
      return json({ error: 'La solicitud de cobro no tiene cliente asociado.' }, 409)
    }

    // Ownership: el residente debe ser el cliente de la solicitud; el usuario de
    // tenant, de la empresa; service_role es interno.
    if (!internal) {
      if (callerClienteId) {
        if (pr.cliente_id !== callerClienteId) return json({ error: 'No autorizado' }, 403)
      } else if (callerCompanyId !== pr.company_id) {
        return json({ error: 'No autorizado' }, 403)
      }
    }

    // Idempotencia: ya conciliada.
    if (pr.estado === 'succeeded') {
      return json({ ok: true, estado: 'aprobado', already: true })
    }
    if (!pr.provider_ref) {
      return json({ error: 'La solicitud no tiene referencia del proveedor para confirmar.' }, 409)
    }

    // ── 2b) Del ítem (cuota o registro) aquí sólo hace falta el `project_id`:
    //    es el override del payfac por locación, que se necesita ANTES de
    //    preguntarle al proveedor. Los montos, el abonado y la decisión de
    //    liquidar ya no se leen aquí — los calcula `conciliar_pago_externo`
    //    con la fila bloqueada. Leerlos en el edge era justo el paso que
    //    permitía que dos confirmaciones partieran del mismo estado. ──
    let itemProjectId: string | null = null

    if (esCuota) {
      const { data: cuotaRow, error: cuErr } = await admin
        .from('cuotas_condominio')
        .select('project_id, deleted_at')
        .eq('id', pr.cuota_id)
        .maybeSingle()
      if (cuErr) return json({ error: cuErr.message }, 500)
      const cuota = cuotaRow as { project_id: string | null; deleted_at: string | null } | null
      if (!cuota || cuota.deleted_at) return json({ error: 'Cuota no encontrada' }, 404)
      itemProjectId = cuota.project_id
    } else {
      const { data: regRow, error: regErr } = await admin
        .from('registros')
        .select('project_id, deleted_at')
        .eq('id', pr.registro_id)
        .maybeSingle()
      if (regErr) return json({ error: regErr.message }, 500)
      const reg = regRow as { project_id: string | null; deleted_at: string | null } | null
      if (!reg || reg.deleted_at) return json({ error: 'Recibo no encontrado' }, 404)
      itemProjectId = reg.project_id
    }

    // ── 3) Resolver payfac + credenciales (por la empresa/proyecto del ítem) ──
    const { data: company } = await admin
      .from('companies').select('proveedor_pago, default_currency').eq('id', pr.company_id).maybeSingle()
    let projectProveedor: string | null = null
    if (itemProjectId) {
      const { data: proj } = await admin
        .from('projects').select('proveedor_pago').eq('id', itemProjectId).maybeSingle()
      projectProveedor = (proj as { proveedor_pago?: string | null } | null)?.proveedor_pago ?? null
    }
    const empresaConfig: ConfigPagoEmpresa = {
      proveedorPago: (company as { proveedor_pago?: string | null } | null)?.proveedor_pago ?? null,
      monedaDefault: (company as { default_currency?: string | null } | null)?.default_currency ?? null,
    }
    const config = resolverConfigPagoEfectiva(
      empresaConfig,
      itemProjectId ? ({ proveedorPago: projectProveedor } as ConfigPagoLocacion) : null,
    )

    // Credenciales EFECTIVAS con herencia locación→empresa (espeja create-charge):
    // la fila del proyecto aporta si trae credenciales del ambiente; si no,
    // hereda la fila de la empresa (project_id NULL).
    let credLookup = admin.from('payfac_secrets').select('project_id, credenciales').eq('company_id', pr.company_id)
    credLookup = itemProjectId === null
      ? credLookup.is('project_id', null)
      : credLookup.or(`project_id.eq.${itemProjectId},project_id.is.null`)
    const { data: secretRows } = await credLookup
    const filas = ((secretRows as { project_id: string | null; credenciales?: unknown }[] | null) ?? [])
    const credenciales = credencialesEfectivasDeAmbiente(
      await decryptJson(filas.find((f) => f.project_id !== null)?.credenciales),
      await decryptJson(filas.find((f) => f.project_id === null)?.credenciales),
      ambiente,
    )

    const provider = getPaymentProvider({
      companyId: pr.company_id, proveedor: config.proveedorPago, ambiente,
      moneda: config.moneda, credenciales,
    })

    // ── 4) Confirmar server-side ──
    let resultado
    try {
      resultado = await provider.consultarEstado(pr.provider_ref)
    } catch (e) {
      return json({ ok: false, estado: 'error', error: e instanceof Error ? e.message : 'Error consultando estado' }, 502)
    }

    if (resultado.estado !== 'aprobado') {
      // No aprobado aún: reflejar el estado sin conciliar.
      const nuevoEstado = resultado.estado === 'rechazado' || resultado.estado === 'error' ? 'failed' : 'pending'
      await admin.from('payment_requests').update({ estado: nuevoEstado }).eq('id', pr.id)
      return json({ ok: true, estado: resultado.estado, conciliado: false })
    }

    // ── 5) Aprobado → conciliar, en UNA transacción y del lado de la base ──
    // Esto eran cuatro pasos sueltos, cada uno en su propia transacción:
    // un `SELECT` de idempotencia por `referencia`, el INSERT del pago, la
    // acreditación del ítem y el cierre de la solicitud. Dos confirmaciones
    // simultáneas —el retorno del portal y el cron de reconciliación— pasaban
    // las dos el `SELECT` antes de que ninguna insertara: dos pagos y doble
    // acreditación. Y una rotura entre el INSERT y la acreditación dejaba el
    // pago registrado con el recibo sin acreditar, que el reintento ya no
    // arreglaba porque encontraba el pago y salía por «already».
    //
    // `conciliar_pago_externo` hace los cuatro pasos con la solicitud
    // bloqueada y en una sola transacción (migración 20260911042839), y la
    // idempotencia ya no es una consulta sino un UNIQUE sobre
    // `pagos.payment_request_id`. El edge sólo aporta el id: el monto, el
    // ítem, el método y la referencia salen de la fila bloqueada.
    const { data: conciliado, error: conciliarErr } = await admin.rpc(
      'conciliar_pago_externo', { p_payment_request_id: pr.id },
    )
    if (conciliarErr) {
      // El proveedor ya cobró y NADA quedó escrito: la transacción revirtió
      // entera. El cron lo reintenta y esta vez sí cuadra.
      return json({
        ok: false, estado: 'error',
        error: `Pago cobrado pero no conciliado: ${conciliarErr.message}`,
      }, 500)
    }
    const res = (conciliado ?? {}) as {
      pago_id?: string | null
      liquidado?: boolean
      saldo_restante?: number
      ya_conciliado?: boolean
    }

    return json({
      ok: true,
      estado: 'aprobado',
      conciliado: true,
      ...(res.ya_conciliado ? { already: true } : {}),
      liquidado: res.liquidado === true,
      cuota_liquidada: res.liquidado === true, // alias legacy (F1) — el frontend nuevo lee `liquidado`.
      saldo_restante: res.saldo_restante ?? 0,
      pago_id: res.pago_id ?? null,
    })
  } catch (e) {
    await captureEdgeException(e, { function: 'confirm-charge' })
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})

// Cobros pluggable — Edge `confirm-charge`: CONFIRMA (server-side) un cobro en
// línea y lo CONCILIA (marca el pago). Complemento de create-charge.
//
// Por qué server-side: los params que el payfac devuelve al navegador tras el
// checkout NO son confiables (spoofeables). La única confirmación válida es
// preguntarle al provider (consultarEstado) desde el servidor. Aquí, si el
// provider reporta 'aprobado', insertamos el `pagos` y —si el saldo llega a 0—
// liquidamos el ítem. Habilita ABONOS parciales.
//
// Idempotente: reintentos (retorno del portal + cron de reconciliación) no
// duplican el pago (guard por provider_ref) ni re-liquidan el ítem.
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
import { getCorsHeaders } from '../_shared/cors.ts'
import { captureEdgeException } from '../_shared/sentry.ts'
import { decryptJson } from '../_shared/secretsCrypto.ts'
import {
  credencialesEfectivasDeAmbiente,
  getPaymentProvider,
  resolverConfigPagoEfectiva,
  type AmbientePago,
  type ConfigPagoEmpresa,
  type ConfigPagoLocacion,
} from '../_shared/payments/index.ts'
import { planPagoCuota, round2, facturaTransicionaAPagada } from '../_shared/payments/reconcile.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

interface ReqBody {
  payment_request_id?: string
  ambiente?: string
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
    let internal = false
    if (token && token === SERVICE_ROLE_KEY) {
      internal = true
    } else if (token) {
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
      const { data: { user }, error } = await callerClient.auth.getUser()
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      const { data: au } = await admin
        .from('app_users').select('company_id, cliente_id').eq('id', user.id).maybeSingle()
      const auRow = au as { company_id?: string | null; cliente_id?: string | null } | null
      callerCompanyId = auRow?.company_id ?? null
      callerClienteId = auRow?.cliente_id ?? null
      if (!callerCompanyId && !callerClienteId) return json({ error: 'Forbidden' }, 403)
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody
    const prId = body.payment_request_id
    const ambiente: AmbientePago = body.ambiente === 'prod' ? 'prod' : 'sandbox'
    if (!prId) return json({ error: 'payment_request_id requerido' }, 400)

    // ── 2) Cargar la solicitud de cobro ──
    const { data: prRow, error: prErr } = await admin
      .from('payment_requests')
      .select('id, cliente_id, cuota_id, registro_id, company_id, monto, provider, estado, provider_ref')
      .eq('id', prId)
      .maybeSingle()
    if (prErr) return json({ error: prErr.message }, 500)
    const pr = prRow as {
      id: string; cliente_id: string | null; cuota_id: string | null; registro_id: string | null
      company_id: string; monto: number; provider: string; estado: string; provider_ref: string | null
    } | null
    if (!pr) return json({ error: 'Solicitud de cobro no encontrada' }, 404)

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

    // ── 2b) Cargar el ítem (cuota o registro): project_id (override del payfac),
    //    montos (plan de conciliación) y —en registro— el estado de la factura. ──
    let itemProjectId: string | null = null
    let planTotal = 0 // total a pagar del ítem (con mora/IVA si aplica)
    let abonosPrevios = 0 // ya pagado
    let regFacturaEstado: string | null = null

    if (esCuota) {
      const { data: cuotaRow, error: cuErr } = await admin
        .from('cuotas_condominio')
        .select('project_id, monto, total_a_pagar, deleted_at')
        .eq('id', pr.cuota_id)
        .maybeSingle()
      if (cuErr) return json({ error: cuErr.message }, 500)
      const cuota = cuotaRow as {
        project_id: string | null; monto: number; total_a_pagar: number | null; deleted_at: string | null
      } | null
      if (!cuota || cuota.deleted_at) return json({ error: 'Cuota no encontrada' }, 404)
      itemProjectId = cuota.project_id
      planTotal = Number(cuota.total_a_pagar ?? cuota.monto)
      // Acumulador de cuota = suma de pagos no borrados (no hay columna monto_pagado).
      const { data: pagosPrevios } = await admin
        .from('pagos').select('monto').eq('cuota_id', pr.cuota_id).is('deleted_at', null)
      abonosPrevios = ((pagosPrevios as { monto: number }[] | null) ?? []).reduce((s, p) => s + Number(p.monto), 0)
    } else {
      const { data: regRow, error: regErr } = await admin
        .from('registros')
        .select('project_id, monto_calculado, total_a_pagar, monto_pagado, factura_estado, deleted_at')
        .eq('id', pr.registro_id)
        .maybeSingle()
      if (regErr) return json({ error: regErr.message }, 500)
      const reg = regRow as {
        project_id: string | null; monto_calculado: number | null; total_a_pagar: number | null
        monto_pagado: number | null; factura_estado: string | null; deleted_at: string | null
      } | null
      if (!reg || reg.deleted_at) return json({ error: 'Recibo no encontrado' }, 404)
      itemProjectId = reg.project_id
      planTotal = Number(reg.total_a_pagar ?? reg.monto_calculado ?? 0)
      // Acumulador de registro = columna monto_pagado (la fila lleva el total pagado).
      abonosPrevios = Number(reg.monto_pagado ?? 0)
      regFacturaEstado = reg.factura_estado
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

    // ── 5) Aprobado → conciliar (idempotente por provider_ref) ──
    // ¿Ya existe un pago para esta referencia + ítem? (retorno + cron no duplican).
    let idemQuery = admin.from('pagos').select('id').eq('referencia', pr.provider_ref).is('deleted_at', null)
    idemQuery = esCuota ? idemQuery.eq('cuota_id', pr.cuota_id) : idemQuery.eq('registro_id', pr.registro_id)
    const { data: pagoExistente } = await idemQuery.maybeSingle()
    if (pagoExistente) {
      await admin.from('payment_requests').update({ estado: 'succeeded' }).eq('id', pr.id)
      return json({ ok: true, estado: 'aprobado', already: true })
    }

    const plan = planPagoCuota(planTotal, abonosPrevios, Number(pr.monto))

    const { data: nuevoPago, error: pagoErr } = await admin
      .from('pagos')
      .insert({
        cliente_id: pr.cliente_id,
        project_id: itemProjectId,
        monto: pr.monto,
        metodo: 'tarjeta_credito',
        estado: 'aplicado',
        verification_status: 'aplicado',
        tipo_aplicacion: plan.tipoAplicacion,
        referencia: pr.provider_ref,
        ...(esCuota ? { cuota_id: pr.cuota_id } : { registro_id: pr.registro_id }),
      })
      .select('id')
      .maybeSingle()
    if (pagoErr) return json({ ok: false, estado: 'error', error: `No se pudo registrar el pago: ${pagoErr.message}` }, 500)
    const pagoId = (nuevoPago as { id?: string } | null)?.id ?? null

    if (esCuota) {
      // Liquidada → transicionar la cuota a 'pagada' (misma forma que el pago manual).
      if (plan.liquida) {
        const ahora = new Date().toISOString()
        await admin.from('cuotas_condominio').update({
          cuota_estado: 'pagada',
          pagada_at: ahora,
          estado: 'pagado',
          fecha_pago: ahora.slice(0, 10),
          metodo_pago: `en_linea:${provider.nombre}`,
          referencia_pago: pr.provider_ref,
          pago_id: pagoId,
        }).eq('id', pr.cuota_id)
      }
    } else {
      // Registro: el acumulador vive en la fila → siempre actualiza monto_pagado.
      // Al liquidar marca estado='pagado' + fecha_pago y —si hay factura emitida/
      // vencida— transiciona factura_estado='pagada' (mismo guard que PagoModal).
      const nuevoAbonado = round2(abonosPrevios + Number(pr.monto))
      const patch: Record<string, unknown> = {
        monto_pagado: nuevoAbonado,
        estado: plan.liquida ? 'pagado' : 'pendiente',
      }
      if (plan.liquida) {
        const ahora = new Date().toISOString()
        patch.fecha_pago = ahora.slice(0, 10)
        if (facturaTransicionaAPagada(regFacturaEstado)) {
          patch.factura_estado = 'pagada'
          patch.pagada_at = ahora
        }
      }
      await admin.from('registros').update(patch).eq('id', pr.registro_id)
    }

    await admin.from('payment_requests').update({ estado: 'succeeded' }).eq('id', pr.id)

    return json({
      ok: true,
      estado: 'aprobado',
      conciliado: true,
      liquidado: plan.liquida,
      cuota_liquidada: plan.liquida, // alias legacy (F1) — el frontend nuevo lee `liquidado`.
      saldo_restante: plan.saldoRestante,
      pago_id: pagoId,
    })
  } catch (e) {
    await captureEdgeException(e, { function: 'confirm-charge' })
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})

#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Siembra los DATOS que los caminos de dinero de la suite E2E necesitan.
// ════════════════════════════════════════════════════════════════════════════
// scripts/seed-rls-sandbox.mjs siembra USUARIOS y una empresa de juguete. Con
// eso la suite entra al shell autenticado, pero los specs de dinero se
// auto-skipean en runtime porque el tenant está vacío:
//
//   agua-lectura-cobro.e2e.ts   → «la unidad no tiene contador sembrado»
//                                 «sin cargos pendientes para emitir»
//   condominios-cuota.e2e.ts    → «sin cuotas pendientes — generar/sembrar una cuota»
//                                 «sin cuotas cobrables — sembrar una cuota emitida»
//
// Los dos son specs OBLIGATORIOS: quedarse con cero pruebas ejecutadas los pone
// rojos en scripts/e2e-verificar.mjs. Este script cierra ese hueco.
//
// RE-EJECUTABLE, no sólo idempotente. La suite CONSUME lo que se siembra: emite
// la factura pendiente y paga la cuota emitida. Si el script sólo insertara
// cuando falta, la SEGUNDA corrida de CI encontraría todo consumido y volvería
// a skipear. Por eso cada corrida REPONE los estados de partida:
//
//   · 1 registro con factura_estado = 'pendiente'   → habilita "Emitir" en /cobros
//   · 1 cuota con cuota_estado = 'pendiente'        → habilita "Emitir" en /condominios/cuotas
//   · 1 cuota con cuota_estado = 'emitida'          → habilita "Pagar"
//
// Las filas se reconocen por MARCADORES estables (número de serie, periodo), no
// por id: correrlo dos veces no duplica nada.
//
// FAIL-CLOSED SOBRE EL PROYECTO. Escribe con service_role, así que exige
// E2E_EXPECTED_SUPABASE_REF y comprueba que coincide con el ref de la URL antes
// de tocar nada — la misma declaración que exige el preflight del job. Sin eso,
// cambiar una variable bastaría para sembrar (y ensuciar) el proyecto
// equivocado.
//
//   SEED_SERVICE_ROLE_KEY="<service_role>" \
//   VITE_SUPABASE_URL="https://<ref>.supabase.co" \
//   E2E_EXPECTED_SUPABASE_REF="<ref>" \
//   E2E_LOGIN_EMAIL="rls-owner@sandbox.invalid" \
//   node scripts/seed-e2e-tenant.mjs
//
// El tenant NO se pasa a mano: se resuelve desde E2E_LOGIN_EMAIL, así que
// siempre se siembra la empresa que la suite va a recorrer.
//
// ⚠️ La service_role no va a GitHub, no se imprime y no se guarda: entra por
//    SEED_SERVICE_ROLE_KEY y se queda en esta máquina.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

/** Marcadores estables: identifican lo sembrado sin depender de ids. */
export const MARCADORES = {
  tarifa: 'E2E · tarifa vigente',
  contador: 'E2E-CONTADOR-001',
  cliente: 'E2E · cargo de prueba',
  cuotaPendiente: 'E2E-PENDIENTE',
  cuotaEmitida: 'E2E-EMITIDA',
}

export const VARIABLES = [
  'SEED_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'E2E_EXPECTED_SUPABASE_REF',
  'E2E_LOGIN_EMAIL',
]

/** El ref sale del hostname: <ref>.supabase.co */
export function refDeUrl(url) {
  try {
    const h = new URL(url).hostname
    return h.endsWith('.supabase.co') ? h.slice(0, -'.supabase.co'.length) : null
  } catch {
    return null
  }
}

/**
 * Puerta previa a cualquier escritura.
 * @returns {{ ok: boolean, motivo?: string }}
 */
export function validarEntorno(env) {
  const faltan = VARIABLES.filter((v) => !env[v])
  if (faltan.length > 0) {
    return { ok: false, motivo: `Faltan variables: ${faltan.join(', ')}. Ver el encabezado de este archivo.` }
  }
  const ref = refDeUrl(env.VITE_SUPABASE_URL)
  if (!ref) {
    return { ok: false, motivo: `VITE_SUPABASE_URL no parece un proyecto de Supabase: "${env.VITE_SUPABASE_URL}".` }
  }
  if (ref !== env.E2E_EXPECTED_SUPABASE_REF) {
    return {
      ok: false,
      motivo:
        `La URL apunta a "${ref}" pero E2E_EXPECTED_SUPABASE_REF declara ` +
        `"${env.E2E_EXPECTED_SUPABASE_REF}". Este script escribe con service_role: ` +
        'no siembra hasta que ambas coincidan.',
    }
  }
  return { ok: true }
}

/**
 * El plan de siembra, PURO: dado el tenant resuelto, qué filas tienen que
 * existir y en qué estado. Separarlo de la E/S permite probar los marcadores,
 * los estados de partida y la reposición sin tocar una base.
 *
 * @param {{ companyId: string, projectId: string, unidadId: string, ahora: string }} ctx
 */
export function planDeSiembra({ companyId, projectId, unidadId, ahora }) {
  const hoy = ahora.slice(0, 10)

  return {
    tarifa: {
      busqueda: { company_id: companyId, project_id: projectId, nombre: MARCADORES.tarifa },
      fila: {
        company_id: companyId,
        project_id: projectId,
        nombre: MARCADORES.tarifa,
        tipo_agua: 'potable',
        precio_m3: 10,
        precio_m3_exceso: 15,
        canon_fijo: 0,
        consumo_minimo: 0,
        activa: true,
      },
    },

    contador: {
      busqueda: { company_id: companyId, numero_serie: MARCADORES.contador },
      fila: {
        company_id: companyId,
        project_id: projectId,
        unidad_id: unidadId,
        numero_serie: MARCADORES.contador,
        tipo_agua: 'potable',
        lectura_inicial: 0,
        activo: true,
        descripcion: 'Sembrado por scripts/seed-e2e-tenant.mjs — no borrar.',
      },
    },

    // El "cargo pendiente" que habilita el botón Emitir de /cobros.
    registro: {
      busqueda: { cliente_nombre: MARCADORES.cliente },
      fila: {
        project_id: projectId,
        cliente_nombre: MARCADORES.cliente,
        fecha: ahora,
        lectura_anterior: 0,
        lectura_actual: 100,
        consumo: 100,
        tarifa_aplicada: 10,
        monto_calculado: 1000,
        total_a_pagar: 1000,
        estado: 'pendiente',
      },
      // Repone el estado de partida aunque la corrida anterior lo haya emitido.
      reposicion: {
        factura_estado: 'pendiente',
        emitida_at: null,
        pagada_at: null,
        vencida_at: null,
        anulada_at: null,
        deleted_at: null,
      },
    },

    cuotas: [
      {
        // Habilita "Emitir".
        busqueda: { company_id: companyId, periodo: MARCADORES.cuotaPendiente },
        fila: {
          company_id: companyId,
          project_id: projectId,
          unidad_id: unidadId,
          concepto: 'mantenimiento',
          periodo: MARCADORES.cuotaPendiente,
          monto: 500,
          total_a_pagar: 500,
          fecha_vencimiento: hoy,
          estado: 'pendiente',
        },
        reposicion: {
          cuota_estado: 'pendiente',
          emitida_at: null,
          pagada_at: null,
          vencida_at: null,
          anulada_at: null,
          deleted_at: null,
        },
      },
      {
        // Habilita "Pagar".
        busqueda: { company_id: companyId, periodo: MARCADORES.cuotaEmitida },
        fila: {
          company_id: companyId,
          project_id: projectId,
          unidad_id: unidadId,
          concepto: 'mantenimiento',
          periodo: MARCADORES.cuotaEmitida,
          monto: 750,
          total_a_pagar: 750,
          fecha_vencimiento: hoy,
          estado: 'pendiente',
        },
        reposicion: {
          cuota_estado: 'emitida',
          emitida_at: ahora,
          pagada_at: null,
          vencida_at: null,
          anulada_at: null,
          deleted_at: null,
        },
      },
    ],
  }
}

/** Inserta si no existe; en cualquier caso aplica la reposición. */
async function asegurar(db, tabla, { busqueda, fila, reposicion }) {
  let q = db.from(tabla).select('id')
  for (const [k, v] of Object.entries(busqueda)) q = q.eq(k, v)
  const { data: existentes, error: eSel } = await q.limit(1)
  if (eSel) throw new Error(`${tabla}: no se pudo consultar (${eSel.message})`)

  let id = existentes?.[0]?.id
  let accion = 'reutilizada'
  if (!id) {
    const { data, error } = await db.from(tabla).insert(fila).select('id').single()
    if (error) throw new Error(`${tabla}: no se pudo insertar (${error.message})`)
    id = data.id
    accion = 'creada'
  }

  if (reposicion) {
    const { error } = await db.from(tabla).update(reposicion).eq('id', id)
    if (error) throw new Error(`${tabla}: no se pudo reponer el estado (${error.message})`)
  }
  return { id, accion }
}

/** Resuelve empresa + proyecto + unidad desde el email de la suite. */
async function resolverTenant(db, email) {
  const { data: usuarios, error: eU } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (eU) throw new Error(`no se pudo listar usuarios (${eU.message})`)
  const usuario = usuarios.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!usuario) {
    throw new Error(
      `E2E_LOGIN_EMAIL="${email}" no existe en este proyecto. Corré primero ` +
        'scripts/seed-rls-sandbox.mjs, o corregí el email.',
    )
  }

  const { data: perfil, error: eP } = await db
    .from('app_users')
    .select('company_id')
    .eq('id', usuario.id)
    .maybeSingle()
  if (eP) throw new Error(`no se pudo leer app_users (${eP.message})`)
  if (!perfil?.company_id) {
    throw new Error(`El usuario "${email}" existe en auth pero no tiene company_id en app_users.`)
  }
  const companyId = perfil.company_id

  const { data: proyectos, error: ePr } = await db
    .from('projects')
    .select('id')
    .eq('company_id', companyId)
    .limit(1)
  if (ePr) throw new Error(`no se pudieron leer los proyectos (${ePr.message})`)
  if (!proyectos?.length) {
    throw new Error(`La empresa ${companyId} no tiene ningún proyecto. Creá uno antes de sembrar.`)
  }
  const projectId = proyectos[0].id

  const { data: unidades, error: eUn } = await db
    .from('unidades')
    .select('id')
    .eq('company_id', companyId)
    .limit(1)
  if (eUn) throw new Error(`no se pudieron leer las unidades (${eUn.message})`)
  if (!unidades?.length) {
    throw new Error(`La empresa ${companyId} no tiene ninguna unidad. Creá una antes de sembrar.`)
  }

  return { companyId, projectId, unidadId: unidades[0].id }
}

export async function main(env = process.env, crear = createClient, log = console.log, err = console.error) {
  const puerta = validarEntorno(env)
  if (!puerta.ok) {
    err(`❌ ${puerta.motivo}`)
    return 1
  }

  const db = crear(env.VITE_SUPABASE_URL, env.SEED_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const tenant = await resolverTenant(db, env.E2E_LOGIN_EMAIL)
    log(`Tenant de ${env.E2E_LOGIN_EMAIL}: empresa ${tenant.companyId}, proyecto ${tenant.projectId}.`)

    const plan = planDeSiembra({ ...tenant, ahora: new Date().toISOString() })

    const tarifa = await asegurar(db, 'tarifas', plan.tarifa)
    log(`· tarifa "${MARCADORES.tarifa}" ${tarifa.accion}`)

    const contador = await asegurar(db, 'contadores', {
      ...plan.contador,
      fila: { ...plan.contador.fila, tarifa_id: tarifa.id },
    })
    log(`· contador ${MARCADORES.contador} ${contador.accion} (habilita /lecturas)`)

    const registro = await asegurar(db, 'registros', {
      ...plan.registro,
      fila: { ...plan.registro.fila, contador_id: contador.id },
    })
    log(`· cargo pendiente ${registro.accion} y repuesto a 'pendiente' (habilita "Emitir" en /cobros)`)

    for (const cuota of plan.cuotas) {
      const r = await asegurar(db, 'cuotas_condominio', cuota)
      log(`· cuota ${cuota.busqueda.periodo} ${r.accion} y repuesta a '${cuota.reposicion.cuota_estado}'`)
    }
  } catch (e) {
    err(`❌ ${e.message}`)
    return 1
  }

  log(
    '\n✅ Tenant sembrado. Volvé a correrlo antes de cada corrida de E2E si querés los ' +
      'mismos estados de partida: la suite consume el cargo pendiente y la cuota emitida.',
  )
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main())
}

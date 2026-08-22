#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Preflight FAIL-CLOSED del job "E2E (caminos de dinero/auth)".
// ════════════════════════════════════════════════════════════════════════════
// Decide, ANTES de instalar dependencias o abrir un navegador, si la suite
// Playwright puede correr. Tres desenlaces, y sólo UNO deja el check en verde:
//
//   run       — están las CINCO variables obligatorias y E2E_BASE_URL apunta a
//               un despliegue de PRUEBAS (nunca producción). Exit 0.
//   bloqueado — GitHub no entrega los Actions secrets por diseño (PR de fork o
//               de dependabot[bot]). Exit 1: el check queda ROJO.
//   fail      — TODO lo demás: falta una variable obligatoria, o la URL apunta
//               a producción o no es https. Exit 1.
//
// HISTORIA. Este job salía VERDE SIN EJECUTAR: sin `E2E_BASE_URL` emitía un
// warning y terminaba en éxito, y así estuvo contabilizándose como cobertura
// E2E que no existía. Es el mismo falso verde por omisión que el harness RLS
// eliminó con scripts/rls-preflight.mjs; este preflight replica esa decisión
// —incluida la de que fork y Dependabot también queden en rojo, porque un
// verde en un PR sin verificar es exactamente lo que autoriza a fusionar— y
// REUSA su clasificación de contextos sin secretos (motivoSinSecretos).
//
// LA GUARDA DE DESTINO ES TAN IMPORTANTE COMO LA DE PRESENCIA. Los specs
// escriben: capturan lecturas, emiten facturas, registran pagos, aceptan
// invitaciones. Apuntarlos a producción no es un job mal configurado, es un
// incidente. La lista de hosts prohibidos sale de vercel.json (los hosts de
// producción que la propia app declara) y se prueba uno a uno.
//
// Vive en Node y no inline en el YAML para poder probarlo:
// `scripts/__tests__/e2e-preflight.test.mjs` cubre la tabla de decisión.
// ════════════════════════════════════════════════════════════════════════════

import { appendFileSync } from 'node:fs'

import { motivoSinSecretos } from './rls-preflight.mjs'

/**
 * Las CINCO obligatorias. Sus NOMBRES no son secretos.
 *
 * Sin cualquiera de ellas, siete de los nueve specs (auth, acceso no
 * autorizado, rol restringido, agua ×2, condominios, contabilidad, fiscal) se
 * auto-skipearían por su gating de e2e/fixtures/env.ts — y eso es el "verde
 * sin ejecutar" que este preflight existe para eliminar.
 */
export const VARIABLES_OBLIGATORIAS = [
  'E2E_BASE_URL',
  'E2E_LOGIN_EMAIL',
  'E2E_LOGIN_PASSWORD',
  'E2E_RESTRICTED_EMAIL',
  'E2E_RESTRICTED_PASSWORD',
]

/**
 * Las DOS condicionales, con su razón estructural — no son "opcionales porque
 * nadie las puso":
 *
 *   · E2E_INVITE_TOKEN: un token de invitación es FRESCO y de un solo uso; el
 *     spec lo consume al aceptarla. No puede vivir como secreto estático del
 *     repo — estaría vencido en la segunda corrida. Correrlo exige generarlo
 *     justo antes (seed / edge invite-user).
 *   · E2E_FISCAL_SANDBOX_READY: declara que el despliegue de pruebas tiene PAC
 *     sandbox y configuración fiscal cargada. Depende de credenciales de un
 *     tercero, no de este repo.
 *
 * La contrapartida de admitirlas ausentes NO es silencio: si están ausentes,
 * scripts/e2e-verificar.mjs exige que su spec haya quedado como "omitido
 * declarado" y lo dice en el resumen; si están PRESENTES y su spec no corrió,
 * el job falla.
 */
export const VARIABLES_CONDICIONALES = ['E2E_INVITE_TOKEN', 'E2E_FISCAL_SANDBOX_READY']

/**
 * Hosts de PRODUCCIÓN: la suite jamás corre contra ellos. La lista replica los
 * hosts que vercel.json declara como producción; un guard estático de las
 * pruebas de contrato exige que las dos listas no diverjan.
 */
export const HOSTS_PRODUCCION = [
  'administratodo.app',
  'www.administratodo.app',
  'administratodo.com',
  'www.administratodo.com',
  'prestadoradeserviciosbasicos.com',
  'www.prestadoradeserviciosbasicos.com',
  'control-consumo-agua.vercel.app',
  'control-consumo-agua-prestadora-de-servicios-projects.vercel.app',
  'control-consumo-agua-git-main-prestadora-de-servicios-projects.vercel.app',
]

/**
 * Valida que E2E_BASE_URL sea un destino de PRUEBAS aceptable.
 *
 * @returns {{ ok: boolean, motivo?: string }}
 */
export function validarBaseUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { ok: false, motivo: `E2E_BASE_URL no es una URL válida: "${url}".` }
  }

  const host = u.hostname.toLowerCase()
  const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'

  if (HOSTS_PRODUCCION.includes(host)) {
    return {
      ok: false,
      motivo:
        `E2E_BASE_URL apunta a PRODUCCIÓN (${host}). La suite escribe datos ` +
        '(lecturas, facturas, pagos, invitaciones): tiene que apuntar a un ' +
        'despliegue estable de pruebas conectado al Supabase sandbox, nunca a producción.',
    }
  }

  // El dominio raíz de producción también cubre subdominios que no declaramos
  // (p. ej. app.administratodo.com el día que exista).
  const raicesProhibidas = ['administratodo.app', 'administratodo.com', 'prestadoradeserviciosbasicos.com']
  if (raicesProhibidas.some((r) => host === r || host.endsWith(`.${r}`))) {
    return {
      ok: false,
      motivo: `E2E_BASE_URL apunta a un subdominio de producción (${host}). Mismo veto que el dominio raíz.`,
    }
  }

  if (u.protocol !== 'https:' && !esLocal) {
    return {
      ok: false,
      motivo:
        `E2E_BASE_URL usa ${u.protocol}// hacia un host remoto (${host}). ` +
        'Las credenciales de prueba viajarían en claro: sólo https, salvo localhost.',
    }
  }

  return { ok: true }
}

/** Cómo desbloquear un PR que no puede recibir secretos. Sin esto, "rojo" es un callejón. */
const COMO_DESBLOQUEAR = [
  'Cómo desbloquear este PR (en este orden):',
  '1. Reproducí el cambio en una rama INTERNA del repositorio (`git checkout -b … && git cherry-pick …`',
  '   o `gh pr checkout` y push a una rama del propio repo). Ahí los Actions secrets sí llegan.',
  '2. Comprobá que el job `E2E (caminos de dinero/auth)` pasa en verde sobre ESE commit,',
  '   con pruebas ejecutadas > 0 (lo exige scripts/e2e-verificar.mjs).',
  '3. Fusioná esa rama interna. El PR original se puede cerrar como duplicado.',
  '',
  'Lo que NO cuenta como verificación: fusionar y esperar al push a `main`. Para cuando',
  'ese job falle, el cambio ya está en main — eso es detección, no prevención.',
]

/**
 * Decide el desenlace. Pura: no toca el entorno ni el disco.
 *
 * @returns {{ decision: 'run'|'bloqueado'|'fail', faltan: string[],
 *             motivo: object|null, mensaje: string }}
 */
export function decidirPreflight(env = {}) {
  const faltan = VARIABLES_OBLIGATORIAS.filter((v) => !env[v])

  if (faltan.length > 0) {
    const motivo = motivoSinSecretos({
      esFork: env.ES_FORK,
      actor: env.GITHUB_ACTOR,
      evento: env.GITHUB_EVENT_NAME,
    })

    if (motivo) {
      return {
        decision: 'bloqueado',
        faltan,
        motivo,
        mensaje:
          `Suite E2E NO ejecutada (${motivo.titulo}). ${motivo.detalle} ` +
          'El check queda en rojo a propósito: un verde aquí autorizaría a fusionar ' +
          'un cambio cuyos caminos de dinero/auth nadie verificó.',
      }
    }

    return {
      decision: 'fail',
      faltan,
      motivo: null,
      mensaje:
        `Faltan ${faltan.length} de ${VARIABLES_OBLIGATORIAS.length} variables E2E obligatorias (${faltan.join(' ')}). ` +
        'El job falla en vez de quedar verde: un verde sin ejecutar se contabiliza ' +
        'como cobertura que no existe. Configuralas en Settings → Secrets and ' +
        'variables → Actions, apuntando al despliegue ESTABLE de pruebas ' +
        '(conectado al Supabase sandbox), nunca a producción. Ver e2e/README.md.',
    }
  }

  const destino = validarBaseUrl(env.E2E_BASE_URL)
  if (!destino.ok) {
    return {
      decision: 'fail',
      faltan,
      motivo: null,
      mensaje:
        `Destino E2E RECHAZADO: ${destino.motivo} ` +
        'No se instaló nada ni se abrió ningún navegador.',
    }
  }

  const condicionalesAusentes = VARIABLES_CONDICIONALES.filter((v) => !env[v])
  return {
    decision: 'run',
    faltan,
    motivo: null,
    mensaje:
      'Preflight E2E en verde: cinco obligatorias presentes y destino de pruebas validado. ' +
      (condicionalesAusentes.length > 0
        ? `Condicionales ausentes (${condicionalesAusentes.join(' ')}): sus specs quedarán ` +
          'como omitidos DECLARADOS y el verificador los contabiliza.'
        : 'Las dos condicionales también están: la suite completa es exigible.'),
  }
}

function resumen(titulo, cuerpo) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${titulo}\n\n${cuerpo}\n`)
}

export function main(env = process.env) {
  const r = decidirPreflight(env)

  if (r.decision === 'run') {
    console.log(`✅ ${r.mensaje}`)
    return 0
  }

  if (r.decision === 'bloqueado') {
    console.error(`::error title=E2E bloqueado (${r.motivo.titulo})::${r.mensaje}`)
    resumen(`🚫 E2E bloqueado — ${r.motivo.titulo}`, `${r.mensaje}\n\n${COMO_DESBLOQUEAR.join('\n')}`)
    return 1
  }

  console.error(`::error title=E2E sin configurar o destino inválido::${r.mensaje}`)
  resumen('❌ E2E no ejecutado', r.mensaje)
  return 1
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}

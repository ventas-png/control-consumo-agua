// ════════════════════════════════════════════════════════════════════════════
// El aviso de cookies, resuelto ANTES de que se abra el navegador.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA (run 32884549901). CookieConsent se monta global en
// main.tsx y, mientras nadie decida, pinta un <div role="dialog"
// aria-label="Aviso de cookies"> fijo abajo. Playwright resolvía el botón
// «💾 Guardar Lectura» —visible, habilitado, estable— y luego se pasaba los
// 60 s del timeout reintentando el clic:
//
//     <div class="cookie-card">…</div> from <div role="dialog" …> subtree
//     intercepts pointer events
//
// Dos de los tres fallos de esa corrida eran ESTO, no la lógica de negocio: el
// aviso tapaba el botón de guardar en agua-lectura-cobro y en
// agua-lectura-validaciones. El diagnóstico costaba caro porque el error habla
// de un clic que no llega, no de un banner.
//
// POR QUÉ EN EL storageState Y NO CON UN CLIC EN CADA SPEC. Un
// `page.getByRole('button', {name:'Solo esenciales'}).click()` al principio de
// cada prueba sería otra cosa que puede fallar, que hay que recordar poner, y
// que además MIDE el banner en vez de la funcionalidad bajo prueba. Sembrar la
// decisión en localStorage —lo mismo que hace saveConsent()— deja la app en el
// estado normal de un usuario que ya respondió, que es el estado en el que
// queremos probar los caminos de dinero.
//
// SE ELIGE «SOLO ESENCIALES», no «aceptar todas»: analytics:false mantiene
// PostHog opted-out, así que la suite no ensucia la analítica con sesiones de
// robot. Es también la elección honesta para una cuenta de juguete.
//
// El banner sigue cubierto por sus propias pruebas unitarias; lo que aquí se
// evita es que TODOS los E2E dependan de esquivarlo.

/** Misma clave que src/lib/cookieConsent.ts (STORAGE_KEY). Si allá cambia, el
 *  banner reaparece y los clics vuelven a chocar: por eso lo verifica
 *  scripts/__tests__/e2e-consentimiento.test.mjs contra el módulo real. */
export const CLAVE_CONSENTIMIENTO = 'at-cookie-consent-v1'

/** Lo que readConsent() necesita para dar `decided: true`. Sin analítica. */
export const VALOR_CONSENTIMIENTO = JSON.stringify({ analytics: false, functional: false, v: 1 })

/** Forma del storageState de Playwright, en lo que nos toca. */
export interface EstadoDeAlmacenamiento {
  cookies?: unknown[]
  origins?: { origin: string; localStorage: { name: string; value: string }[] }[]
}

/**
 * Devuelve el estado con el consentimiento sembrado para el origen de
 * `baseURL`. NO muta el estado recibido.
 *
 * Sin baseURL utilizable lo devuelve tal cual: en local contra un dev server
 * sin URL el banner se puede cerrar a mano, y fallar aquí dejaría al proyecto
 * chromium sin storageState.
 */
export function conConsentimientoSembrado(
  estado: EstadoDeAlmacenamiento,
  baseURL: string,
): EstadoDeAlmacenamiento {
  let origen: string
  try {
    origen = new URL(baseURL).origin
  } catch {
    return estado
  }

  const entrada = { name: CLAVE_CONSENTIMIENTO, value: VALOR_CONSENTIMIENTO }
  const origins = (estado.origins ?? []).map((o) => ({ ...o, localStorage: [...o.localStorage] }))
  const existente = origins.find((o) => o.origin === origen)

  if (!existente) {
    origins.push({ origin: origen, localStorage: [entrada] })
    return { ...estado, origins }
  }

  // Respetar lo que ya hubiera en ese origen; sólo sustituir NUESTRA clave.
  const i = existente.localStorage.findIndex((e) => e.name === CLAVE_CONSENTIMIENTO)
  if (i === -1) existente.localStorage.push(entrada)
  else existente.localStorage[i] = entrada
  return { ...estado, origins }
}

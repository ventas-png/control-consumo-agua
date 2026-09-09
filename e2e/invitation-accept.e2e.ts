import { test, expect, type APIRequestContext } from '@playwright/test'

import {
  crearInvitacion,
  eliminarInvitacion,
  eliminarUsuario,
  idDeUsuarioPorCorreo,
  iniciarSesionApi,
  type InvitacionCreada,
} from './fixtures/api'
import { hasBaseUrl, hasLoginCreds, hasSupabaseApi, reasons } from './fixtures/env'

// CAMINO DE AUTH #2 — Alta por invitación: /aceptar-invitacion?token=…
//
// ESTA PRUEBA YA NO SE OMITE. Antes consumía E2E_INVITE_TOKEN, un secreto
// estático con un token de UN SOLO USO dentro: servía para una corrida y a la
// siguiente estaba gastado, así que en la práctica el spec vivía omitido y la
// única alta por invitación del producto no se probaba nunca. Ahora la prueba
// FABRICA su propia invitación llamando a `invite-user` con el JWT del
// administrador —el mismo camino que la pantalla de usuarios— en cada intento y
// en cada retry, con un correo único. Un token de un solo uso deja de ser un
// problema cuando cada intento trae el suyo.
//
// EL TOKEN NUNCA SE IMPRIME. No aparece en el título de la prueba, ni en las
// aserciones, ni en los mensajes de error: su único destino es la URL que
// visita el navegador.
test.describe('AUTH · aceptar invitación', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)
  test.skip(!hasSupabaseApi, reasons.supabaseApi)

  // Estado del intento en curso, para que la limpieza corra aunque el cuerpo de
  // la prueba se caiga —o expire— a mitad. Se reinicia en cada intento porque
  // beforeEach/afterEach vuelven a correr en cada retry.
  let invitacion: InvitacionCreada | null = null
  let jwtAdmin = ''

  test.beforeEach(async ({ request }) => {
    invitacion = null
    jwtAdmin = await iniciarSesionApi(request)
    invitacion = await crearInvitacion(request, jwtAdmin)
  })

  // LA LIMPIEZA CORRE PASE LO QUE PASE. Sin ella cada corrida dejaría un
  // usuario y una invitación en el tenant compartido, y en dos semanas el
  // sandbox sería un cementerio de cuentas «QA Invitado E2E». Va en afterEach y
  // no en un `finally` del cuerpo porque afterEach también corre cuando la
  // prueba expira por timeout, que es justo cuando más falta hace.
  test.afterEach(async ({ request }) => {
    if (!invitacion) return
    const pendiente = invitacion
    invitacion = null
    await limpiar(request, jwtAdmin, pendiente)
  })

  test('activa la cuenta y entra autenticado', async ({ page }) => {
    const inv = invitacion
    expect(inv, 'la invitación se crea en beforeEach').not.toBeNull()

    await page.goto(`/aceptar-invitacion?token=${encodeURIComponent(inv!.token)}`)

    // Fase preview: el formulario aparece cuando el token es válido. Si el token
    // fuera inválido o estuviera expirado saldría un error y el campo no
    // existiría — fallo claro, no un skip.
    const password = page.getByPlaceholder(/Mínimo 8 caracteres/i)
    await expect(password).toBeVisible({ timeout: 20_000 })

    await page.getByPlaceholder('Ana García').fill('QA Invitado E2E')
    await password.fill('E2e-Passw0rd!')
    await page.getByPlaceholder('Repite la contraseña').fill('E2e-Passw0rd!')

    // SE ESPERA LA RESPUESTA REAL, no sólo que la pantalla cambie. El alta la
    // hace el Edge `accept-invitation`: crea el auth user, el app_users y el rol
    // RBAC. Que el formulario desaparezca es consecuencia; el 2xx es la prueba.
    const [respuesta] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/functions/v1/accept-invitation') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /aceptar invitación/i }).click(),
    ])
    expect(respuesta.status(), 'accept-invitation debe aceptar el alta').toBeLessThan(300)

    // Y el desenlace visible: la app auto-loguea y entra al shell, así que el
    // formulario de invitación ya no está.
    await expect(password).toBeHidden({ timeout: 20_000 })
  })
})

/**
 * Borra el usuario creado y la fila de la invitación. Sin service_role: el
 * borrado del usuario va por el Edge `delete-user` (exige admin/owner y que el
 * objetivo sea de la misma company) y el de la invitación por la policy
 * `user_invitations_delete`.
 *
 * No lanza nunca: un fallo de limpieza no debe convertir una prueba verde en
 * roja ni tapar el fallo real de una roja. Deja aviso en la consola del job, y
 * ahí el correo sí se nombra —lo generamos nosotros, es de un TLD inválido y es
 * lo único que permite encontrar el resto a mano.
 */
async function limpiar(
  request: APIRequestContext,
  jwt: string,
  inv: InvitacionCreada,
): Promise<void> {
  try {
    const userId = await idDeUsuarioPorCorreo(request, jwt, inv.email)
    if (userId && !(await eliminarUsuario(request, jwt, userId))) {
      console.warn(`[e2e] no se pudo borrar el usuario invitado ${inv.email}`)
    }
    if (!(await eliminarInvitacion(request, jwt, inv.id))) {
      console.warn(`[e2e] no se pudo borrar la invitación de ${inv.email}`)
    }
  } catch (err) {
    console.warn(`[e2e] limpieza de la invitación ${inv.email} incompleta: ${(err as Error).message}`)
  }
}

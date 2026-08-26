import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { crearCuotaPendiente } from './fixtures/sembrar'
import { exists, gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #2 (condominios) — emitir CUOTA → registrar PAGO.
//
// CADA PRUEBA CREA LA CUOTA QUE VA A CONSUMIR. Emitir y pagar son operaciones
// destructivas: gastan el dato que necesitaban. Antes las cuotas venían de una
// siembra manual por SQL, así que la suite pasaba UNA vez y la corrida
// siguiente se omitía con «sin cuotas pendientes» — un skip inesperado, o sea
// rojo, sin que nada estuviera roto. Dar de alta la cuota por la misma UI que
// después se ejercita deja la suite cerrada sobre sí misma, y de paso prueba
// el alta, que no se ejercitaba en ningún otro sitio.
//
// LOS BOTONES SE DIRECCIONAN POR SU `title`. La barra de herramientas tiene un
// «Emitir período» (acción MASIVA con diálogo de confirmación) que aparece
// SIEMPRE, aunque la tabla no tenga ni una fila; el localizador por nombre de
// rol agarraba ése. La prueba pasaba sin haber emitido nada — verde falso
// (run 32778903667: la cuota E2E-PENDIENTE quedó en 'pendiente', emitida_at
// nulo). Los titles identifican la acción POR FILA.
//
// Y la aserción es el CONTEO de botones de fila, no «aparece el texto
// Emitida»: ese texto puede estar ya en la página (otra fila, un filtro) y
// volvería a pasar sin hacer nada. Que el botón desaparezca prueba la
// transición.
test.describe('CONDOMINIOS · cuota: emitir → pagar', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('emite una cuota pendiente', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/condominios/cuotas')

    const nueva = page.getByRole('button', { name: /Nueva cuota/i })
    if (!(await exists(nueva))) {
      test.skip(true, 'este rol no puede crear cuotas: no hay «+ Nueva cuota»')
    }
    await crearCuotaPendiente(page)

    const emitibles = page.locator('button[title^="Emitir cuota"]')
    const antes = await emitibles.count()
    await emitibles.first().click()
    await expect(emitibles).toHaveCount(antes - 1, { timeout: 20_000 })
  })

  test('registra el pago de una cuota', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/condominios/cuotas')

    const nueva = page.getByRole('button', { name: /Nueva cuota/i })
    if (!(await exists(nueva))) {
      test.skip(true, 'este rol no puede crear cuotas: no hay «+ Nueva cuota»')
    }

    // Pagar exige una cuota EMITIDA, y el alta las crea pendientes: hay que
    // recorrer el camino entero. Emitir aquí no es duplicar la prueba de
    // arriba — es fabricar la precondición sin depender de ella ni del orden
    // en que Playwright decida correr los archivos.
    await crearCuotaPendiente(page)
    const emitibles = page.locator('button[title^="Emitir cuota"]')
    const cobrables = page.locator('button[title="Registrar pago de la cuota"]')
    const cobrablesAntes = await cobrables.count()
    await emitibles.first().click()
    await expect(cobrables).toHaveCount(cobrablesAntes + 1, { timeout: 20_000 })

    const antes = await cobrables.count()
    await cobrables.first().click()

    // Modal de pago: fecha (hoy por defecto) + método (efectivo por defecto).
    // Sólo confirmamos; los defaults bastan para el happy-path.
    await page.getByRole('button', { name: /Confirmar pago/i }).click()
    await expect(cobrables).toHaveCount(antes - 1, { timeout: 20_000 })
  })
})

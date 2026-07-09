import { test, expect, type Page } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasPortalCreds, PORTAL, reasons } from './fixtures/env'
import { exists } from './fixtures/ui'

// CAMINO DE DINERO (portal del cliente final) — un usuario rol CLIENTE entra a
// su portal, ve sus cargos pendientes y abre el checkout de pago en línea.
// Derivado de src/components/portal/CustomerPortal.tsx (+ CustomerPaymentsTab
// y StripeCheckoutModal):
//   - El cliente inicia sesión con el MISMO modal del landing (email/password);
//     App.tsx enruta role === 'cliente' directo al portal, sin shell admin.
//   - Con agua + condominios activos aparece DualServicePortal con un switch
//     "💧 Agua" / "🏢 Condominios"; el tab "Mis Pagos" vive en el portal de agua.
//   - "Mis Pagos" lista los registros no pagados; el botón "Pagar Stripe" sólo
//     existe si la empresa tiene el pago en línea activo (fetchPortalPaymentConfig).
// Requiere E2E_PORTAL_EMAIL / E2E_PORTAL_PASSWORD (usuario rol cliente sembrado,
// idealmente con un cargo pendiente y Stripe activo). NUNCA se completa un pago:
// el modal se verifica (monto + botón "Ir a Stripe") y se cierra con Cancelar.

// Navega login → (switch Agua si es cliente dual) → tab "Mis Pagos".
// Skipea en runtime si el cliente no tiene servicios o no tiene portal de agua.
async function abrirTabPagos(page: Page): Promise<void> {
  await login(page, PORTAL.email, PORTAL.password)

  const tabPagos = page.getByRole('button', { name: /Mis Pagos/i }).first()
  const switchAgua = page.getByRole('button', { name: /Agua$/ }).first()
  const sinServicios = page.getByText(/Sin servicios asociados/i).first()

  // El portal carga lazy tras el login: esperar el primer marcador que aparezca
  // (tab de pagos, switch dual o pantalla de cliente sin servicios).
  await tabPagos
    .or(switchAgua)
    .or(sinServicios)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {})

  if (await exists(sinServicios)) {
    test.skip(true, 'cliente sin servicios sembrados (sin contadores ni unidades activas)')
  }

  // Cliente dual (agua + condominios): cambiar al servicio Agua, que es el
  // portal con el tab "Mis Pagos" (CustomerPortal).
  if (!(await exists(tabPagos)) && (await exists(switchAgua))) {
    await switchAgua.click()
    await tabPagos.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
  }
  if (!(await exists(tabPagos))) {
    test.skip(true, 'portal sin tab "Mis Pagos" — ¿cliente sólo de condominios?')
  }

  await tabPagos.click()
  // CustomerPaymentsTab muestra "Cargando..." mientras baja la config de pagos.
  await page.getByText(/^Cargando\.\.\.$/).first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
}

test.describe('PORTAL · cliente final: cargos pendientes → checkout (sin pagar)', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasPortalCreds, reasons.portal)

  test('el cliente entra a su portal y ve el estado de sus pagos', async ({ page }) => {
    await abrirTabPagos(page)

    // Dos estados válidos sin depender del seed exacto: el resumen de cargos
    // pendientes ("Total por Pagar") o la pantalla al día ("¡Sin cargos pendientes!").
    const resumen = page.getByText(/Total por Pagar/i).first()
    const alDia = page.getByText(/Sin cargos pendientes/i).first()
    await expect(resumen.or(alDia).first()).toBeVisible({ timeout: 20_000 })
  })

  test('abre el modal de checkout Stripe de un cargo pendiente y NO paga', async ({ page }) => {
    await abrirTabPagos(page)

    const pagarStripe = page.getByRole('button', { name: /Pagar Stripe/i }).first()
    // Los registros del portal cargan en paralelo a la config de pagos: la lista
    // puede mostrar "¡Sin cargos pendientes!" un instante antes de que bajen los
    // cargos reales. Dar margen al botón antes de decidir el skip.
    const pagarVisible = await pagarStripe
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (!pagarVisible) {
      const sinCargos = await exists(page.getByText(/Sin cargos pendientes/i))
      test.skip(
        true,
        sinCargos
          ? 'sin cargos pendientes sembrados para el cliente'
          : 'pago en línea (Stripe) no configurado/activo para la empresa',
      )
    }
    await pagarStripe.click()

    // StripeCheckoutModal: título, montos del cargo y botón de pagar.
    const titulo = page.getByRole('heading', { name: /Pagar con Stripe/i })
    await expect(titulo).toBeVisible()
    await expect(page.getByText(/Total Cargo/i).first()).toBeVisible()
    await expect(page.getByText(/Saldo Pendiente/i).first()).toBeVisible()
    // El input de monto viene pre-sugerido con el saldo (placeholder "123.45"):
    // verifica que el modal calculó un monto real para el cargo.
    await expect(page.getByPlaceholder(/^\d+\.\d{2}$/)).toBeVisible()
    const pagar = page.getByRole('button', { name: /Ir a Stripe/i })
    await expect(pagar).toBeVisible()
    await expect(pagar).toBeEnabled()

    // NUNCA completar el pago: cerrar el modal sin disparar el checkout.
    await page.getByRole('button', { name: /^Cancelar$/ }).click()
    await expect(titulo).toBeHidden()
  })
})

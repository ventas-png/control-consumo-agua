import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { exists, gotoSection } from './fixtures/ui'

// CAMINO DE DINERO SaaS (plataforma → empresa) — el tenant amplía/cambia su plan.
// Dos superficies, derivadas del código de la app:
//   1. /empresa → AmpliarPlanModal (src/components/empresa/AmpliarPlanModal.tsx):
//      ampliación self-service de límites; muestra el cobro mensual actual, la
//      proyección y las tarifas por recurso. El CTA visible ("Ampliar plan" en
//      PlanUsageCard) sólo existe cuando el tenant está AL LÍMITE, así que el
//      test abre el modal con el mismo flag de sessionStorage que usa
//      promptUpgrade (src/components/shared/promptUpgrade.ts) y que
//      EmpresaProyectosSection consume al montar.
//   2. /perfil → Card "Mi plan" → "Cambiar plan" → plan picker con precios →
//      "Mensual" dispara el edge `create-checkout-session` (Stripe Checkout,
//      plat:P36d — mismo camino que UpgradeCTA/TrialExpirationBanner).
// NUNCA se completa un pago real: si Stripe responde con URL sólo se verifica
// la redirección; si el preview no tiene secrets, el edge responde 503
// "Stripe no configurado" y eso también prueba el camino (éxito).

// Flag que EmpresaProyectosSection lee al montar para abrir el modal de
// ampliación (OPEN_AMPLIAR_FLAG en src/components/shared/promptUpgrade.ts).
const OPEN_AMPLIAR_FLAG = 'at:open-ampliar-on-mount'

test.describe('BILLING SaaS · plan de la empresa: ampliar → checkout', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('muestra el modal "Ampliar plan" con las tarifas del plan', async ({ page }) => {
    await login(page)

    // Mecanismo propio de la app (promptUpgrade) para abrir el modal al montar
    // la sección Empresa — el CTA sólo es visible cuando el plan está al límite.
    await page.evaluate((flag) => sessionStorage.setItem(flag, '1'), OPEN_AMPLIAR_FLAG)
    await gotoSection(page, '/empresa')

    const denied = page.getByText(/Acceso Denegado/i).first()
    const modal = page.getByRole('dialog', { name: /Ampliar plan/i })
    const outcome = await Promise.race([
      modal.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'modal' as const).catch(() => 'timeout' as const),
      denied.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'denied' as const).catch(() => 'timeout' as const),
    ])
    if (outcome === 'denied') test.skip(true, 'rol sin acceso a /empresa — usar company_owner en E2E_LOGIN_*')
    if (outcome !== 'modal') test.skip(true, 'el modal de ampliación no abrió — ¿usuario sin empresa (company_id)?')

    // Límites actuales del plan cargados (inputs sembrados con los valores vigentes).
    await modal.getByText(/Cargando límites/i).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
    await expect(modal.getByLabel('Proyectos')).toBeVisible()
    await expect(modal.getByLabel('Unidades')).toBeVisible()

    // Precios del plan: cobro mensual actual + tarifas por recurso (fetchPlanPricing).
    const pricing = modal.getByText(/Cobro mensual actual/i)
    const pricingVisible = await pricing
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (!pricingVisible) test.skip(true, 'sin pricing sembrado para el plan — fetchPlanPricing no devolvió tarifas')
    await expect(modal.getByText(/Tarifas:/i)).toBeVisible()
    await expect(modal.getByText(/\$\d[\d,]*\.\d{2}/).first()).toBeVisible()

    // La acción de dinero existe pero NO se dispara (mutaría los límites del
    // tenant sembrado). Cerramos con Cancelar y verificamos que el modal se va.
    await expect(modal.getByRole('button', { name: /Ampliar límites/i })).toBeVisible()
    await modal.getByRole('button', { name: /^Cancelar$/ }).click()
    await expect(modal).toBeHidden()
  })

  test('dispara el checkout de cambio de plan: redirige a Stripe o responde 503 sin secrets', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/perfil')

    // Anclaje propio de la app: id que PerfilSection usa para el auto-scroll a
    // la card "Mi plan" (no es un data-testid; es parte del flow de conversión).
    const billing = page.locator('#billing-section')
    const cardVisible = await billing
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    if (!cardVisible) test.skip(true, 'card "Mi plan" no disponible — ¿usuario sin empresa (company_id)?')

    await billing.getByText(/^Cargando…$/).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
    if (await exists(billing.getByText(/Sin suscripción activa/i))) {
      test.skip(true, 'sin suscripción sembrada para la empresa')
    }

    const cambiar = billing.getByRole('button', { name: /Cambiar plan/i })
    if (!(await exists(cambiar))) {
      test.skip(true, 'rol sin permiso de billing (se requiere owner/admin) — botón "Cambiar plan" ausente')
    }
    await cambiar.click()

    // Plan picker: cada plan lista su precio "$xx.xx/mes" (y opcional "/año").
    const precio = billing.getByText(/\$\d[\d,]*\.\d{2}\/mes/).first()
    const pickerVisible = await precio
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (!pickerVisible) test.skip(true, 'sin catálogo de planes sembrado — el plan picker quedó vacío')

    const mensual = billing.getByRole('button', { name: /^Mensual$/ }).first()
    if (!(await exists(mensual))) {
      test.skip(true, 'todos los planes son el actual — no hay plan destino para el checkout')
    }

    // Disparar el checkout y observar la respuesta del edge create-checkout-session.
    const respPromise = page.waitForResponse(
      (r) => r.url().includes('create-checkout-session') && r.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await mensual.click()
    const resp = await respPromise

    if (resp.status() === 503) {
      // Preview sin secrets de Stripe: el edge responde el mensaje de negocio
      // y la UI lo muestra como feedback de error. Éxito del camino igualmente.
      await expect(page.getByText(/Stripe no configurado/i).first()).toBeVisible({ timeout: 15_000 })
    } else {
      expect(
        resp.status(),
        'create-checkout-session debe responder 200 (URL de Stripe) o 503 (Stripe no configurado)',
      ).toBe(200)
      // La app redirige a Stripe Checkout. Verificamos SÓLO la redirección:
      // NUNCA se completa un pago real (no se toca la página de Stripe).
      await page.waitForURL(/stripe\.com/, { timeout: 30_000 })
      expect(page.url()).toContain('stripe.com')
    }
  })
})

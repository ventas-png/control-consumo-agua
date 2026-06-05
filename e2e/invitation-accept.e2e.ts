import { test, expect } from '@playwright/test'
import { hasBaseUrl, hasInviteToken, INVITE_TOKEN, reasons } from './fixtures/env'

// CAMINO DE AUTH #2 — Alta por invitación: /aceptar-invitacion?token=…
// Consume un token EFÍMERO (one-shot): el seed del preview debe generar uno
// fresco por corrida (insert en user_invitations / edge invite-user).
test.describe('AUTH · aceptar invitación', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasInviteToken, reasons.invite)

  test('activa la cuenta y entra autenticado', async ({ page }) => {
    await page.goto(`/aceptar-invitacion?token=${encodeURIComponent(INVITE_TOKEN)}`)

    // Fase preview: el form aparece cuando el token es válido. Si sale un error
    // (token inválido/expirado), el botón de aceptar no existirá → fallo claro.
    const password = page.getByPlaceholder(/Mínimo 8 caracteres/i)
    await expect(password).toBeVisible({ timeout: 20_000 })

    await page.getByPlaceholder('Ana García').fill('QA Invitado E2E')
    await password.fill('E2e-Passw0rd!')
    await page.getByPlaceholder('Repite la contraseña').fill('E2e-Passw0rd!')
    await page.getByRole('button', { name: /aceptar invitación/i }).click()

    // Tras aceptar, la app auto-loguea y entra al shell: el form de invitación
    // (campo de contraseña) ya no debe estar.
    await expect(password).toBeHidden({ timeout: 20_000 })
  })
})

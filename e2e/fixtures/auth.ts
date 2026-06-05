import { expect, type Page } from '@playwright/test'
import { LOGIN } from './env'

// La app no tiene ruta /login: el formulario vive en un modal del landing (Nav).
// Este helper es tolerante al trigger: si el campo de email no está visible,
// intenta abrir el modal con el botón "Iniciar sesión" del nav.
//
// Sin data-testid en el código (confirmado), se usan selectores semánticos:
//   - email:    placeholder "nombre@empresa.com"
//   - password: placeholder "••••••••"
//   - submit:   botón con texto /iniciar sesión/i
export async function openLoginModal(page: Page): Promise<void> {
  await page.goto('/')
  const email = page.getByPlaceholder('nombre@empresa.com')
  if (!(await email.isVisible().catch(() => false))) {
    // Abrir el modal de login desde el nav.
    await page
      .getByRole('button', { name: /iniciar sesión/i })
      .first()
      .click()
  }
  await expect(email).toBeVisible()
}

export async function login(
  page: Page,
  email: string = LOGIN.email,
  password: string = LOGIN.password,
): Promise<void> {
  await openLoginModal(page)
  await page.getByPlaceholder('nombre@empresa.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: /iniciar sesión/i }).click()

  // Éxito = el formulario de login desaparece y entra el shell autenticado.
  // (El destino exacto depende del rol: admin-dashboard / superadmin / cobros…),
  // así que sólo afirmamos que el campo de credenciales ya no está.
  await expect(page.getByPlaceholder('nombre@empresa.com')).toBeHidden({
    timeout: 20_000,
  })
}

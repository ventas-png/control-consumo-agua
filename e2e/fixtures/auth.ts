import { expect, type Page } from '@playwright/test'
import { LOGIN } from './env'

// La app no tiene ruta /login: el formulario vive en un modal del landing (Nav).
// Este helper es tolerante al trigger: si el campo de email no está visible,
// intenta abrir el modal con el botón "Iniciar sesión" del nav.
//
// Sin data-testid en el código (confirmado), se usan selectores semánticos:
//   - email:    placeholder "nombre@empresa.com"
//   - password: placeholder "••••••••"
//   - submit:   botón /iniciar sesión/i DENTRO del diálogo
//
// EL SUBMIT SE ACOTA AL DIÁLOGO A PROPÓSITO. Con el modal abierto hay DOS
// botones "Iniciar sesión" en la página — el del nav, que lo abre, y el submit
// del formulario— y un clic sin acotar aborta por strict mode. Fue el fallo de
// la primera corrida real de la suite (run 32752735170: 13 pruebas caídas en
// este mismo punto). El modal es role="dialog" (Nav.tsx), así que getByRole
// lo delimita sin depender del texto del título ni del idioma activo.
const dialogoDeLogin = (page: Page) => page.getByRole('dialog')

/** El submit del formulario, acotado al diálogo. Único punto de entrada: los
 *  specs que envían el formulario a mano lo usan también, para que el acotado
 *  no pueda perderse en una copia suelta. */
export function botonEnviarLogin(page: Page) {
  return dialogoDeLogin(page).getByRole('button', { name: /iniciar sesión/i })
}

/** Lo que la app muestra cuando el login no prospera (Nav.tsx: .login-error con
 *  role="alert"). Sirve para convertir un timeout ciego en un motivo legible. */
async function motivoDeFalloVisible(page: Page): Promise<string> {
  const alerta = dialogoDeLogin(page).locator('[role="alert"], .login-error').first()
  const texto = await alerta.textContent({ timeout: 2_000 }).catch(() => null)
  return (texto ?? '').replace(/\s+/g, ' ').trim()
}

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
  await botonEnviarLogin(page).click()

  // Éxito = el formulario de login desaparece y entra el shell autenticado.
  // (El destino exacto depende del rol: admin-dashboard / superadmin / cobros…),
  // así que sólo afirmamos que el campo de credenciales ya no está.
  //
  // El timeout pelado decía sólo "el campo sigue visible", que es el síntoma y
  // no la causa: hubo que adivinar entre credenciales inválidas, el Supabase
  // equivocado o un usuario sin sembrar. Si la app dejó un mensaje en el modal,
  // viaja en el error; si no dejó ninguno, eso también se dice, porque distingue
  // "el backend rechazó" de "el submit no llegó a ninguna parte".
  try {
    await expect(page.getByPlaceholder('nombre@empresa.com')).toBeHidden({
      timeout: 20_000,
    })
  } catch (e) {
    const motivo = await motivoDeFalloVisible(page)
    // `new Error(msg, { cause })` pide lib ES2022; el tsconfig de e2e apunta más
    // abajo, así que la causa se engancha a mano y no se pierde el stack real.
    throw Object.assign(
      new Error(
        'El login no completó: el formulario sigue visible 20 s después del submit. ' +
        (motivo
          ? `La app mostró: "${motivo}". Revisá que E2E_LOGIN_EMAIL/PASSWORD (o ` +
            'E2E_RESTRICTED_*) correspondan a un usuario del Supabase al que apunta ' +
            'el despliegue de pruebas.'
          : 'La app NO mostró ningún mensaje de error: el submit no llegó a producir ' +
            'respuesta (¿VITE_SUPABASE_URL/ANON_KEY del Preview mal configuradas, o la ' +
            'petición bloqueada?).'),
      ),
      { cause: e },
    )
  }
}

import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { chooseFirstRealOption, exists, gotoSection } from './fixtures/ui'

// EDGE CASES DE DINERO (P2 #8) — validaciones del flujo lectura → cobro que
// protegen la integridad del dinero: la app debe RECHAZAR datos que generarían
// cobros corruptos. Complementa agua-lectura-cobro.e2e.ts (happy path).
//
// Los mensajes asertados son los de handleGuardar en LecturasSection
// (src/components/lecturas/LecturasSection.tsx): si la validación cambia de
// texto, ajustar aquí.
//
// Mismo gating que el resto: sin base URL o credenciales → skip (CI verde);
// pasos que dependen de datos sembrados se skipean en runtime.

test.describe('AGUA · validaciones de lectura (edge cases de dinero)', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('guardar sin seleccionar unidad es rechazado', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/lecturas')

    const guardar = page.getByRole('button', { name: /Guardar Lectura/i })
    if (!(await exists(guardar))) test.skip(true, 'UI de lecturas no disponible para este rol')

    await guardar.click()
    await expect(page.getByText(/Seleccione una unidad primero/i).first()).toBeVisible()
  })

  test('lectura menor a la anterior (consumo negativo) es rechazada', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/lecturas')

    const unidad = page.getByLabel(/Seleccionar Unidad/i)
    if (!(await exists(unidad))) test.skip(true, 'UI de lecturas no disponible para este rol')
    const u = await chooseFirstRealOption(unidad)
    test.skip(u === null, 'sin unidades sembradas')

    const contador = page.getByLabel(/Seleccionar Contador/i)
    const c = await chooseFirstRealOption(contador)
    test.skip(c === null, 'la unidad no tiene contador sembrado')

    // Un valor negativo garantiza consumo < 0 sea cual sea la lectura anterior
    // sembrada. La app debe rechazarlo SIN crear el registro.
    await page.getByPlaceholder('Ingrese lectura del medidor').fill('-5')
    await page.getByRole('button', { name: /Guardar Lectura/i }).click()

    await expect(
      page.getByText(/Consumo Negativo|mayor o igual a la anterior/i).first()
    ).toBeVisible()
    // El formulario sigue en pantalla (no se limpió como tras un guardado exitoso).
    await expect(page.getByPlaceholder('Ingrese lectura del medidor')).toHaveValue('-5')
  })
})

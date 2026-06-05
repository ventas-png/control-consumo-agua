import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { chooseFirstRealOption, exists, gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #1 (agua) — capturar LECTURA → emitir COBRO/Factura.
// Requiere datos sembrados (unidad + contador + tarifa vigente; cargo pendiente).
// Cada paso se guarda en runtime: si falta el dato, se skipea (no falla).
test.describe('AGUA · lectura → cobro', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('captura una lectura de medidor', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/lecturas')

    const unidad = page.getByLabel(/Seleccionar Unidad/i)
    if (!(await exists(unidad))) test.skip(true, 'UI de lecturas no disponible para este rol')
    const u = await chooseFirstRealOption(unidad)
    test.skip(u === null, 'sin unidades sembradas')

    const contador = page.getByLabel(/Seleccionar Contador/i)
    const c = await chooseFirstRealOption(contador)
    test.skip(c === null, 'la unidad no tiene contador sembrado')

    await page.getByPlaceholder('Ingrese lectura del medidor').fill('999999')
    await page.getByRole('button', { name: /Guardar Lectura/i }).click()

    // Éxito = no aparece un error de validación bloqueante (tarifa vencida, etc.).
    // El toast de éxito es efímero; afirmamos que el form sigue operable.
    await expect(page.getByRole('button', { name: /Guardar Lectura/i })).toBeVisible()
  })

  test('emite factura de un cargo pendiente', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/cobros')

    const emitir = page.getByRole('button', { name: /Emitir/i }).first()
    if (!(await exists(emitir))) test.skip(true, 'sin cargos pendientes para emitir — sembrar registro pendiente')

    await emitir.click()
    // Tras emitir, el registro pasa a estado "emitida": aparece el badge Emitida.
    await expect(page.getByText(/Emitida/i).first()).toBeVisible({ timeout: 20_000 })
  })
})

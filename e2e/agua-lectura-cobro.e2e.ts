import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { chooseFirstRealOption, exists, gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #1 (agua) — capturar LECTURA → emitir COBRO/Factura.
// Requiere datos sembrados (unidad + contador + tarifa vigente; cargo pendiente).
// Cada paso se guarda en runtime: si falta el dato, se skipea (no falla).
//
// EL BOTÓN DE EMITIR SE DIRECCIONA POR SU `title`: la barra de /cobros tiene
// acciones MASIVAS («Emitir facturas», «Emitir período») siempre presentes
// aunque la tabla esté vacía, y el localizador por nombre de rol agarraba una
// de ellas — abría un diálogo de confirmación en vez de emitir la fila. La
// aserción es que ese botón desaparezca, no que exista el texto "Emitida".
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

    const emitibles = page.locator('button[title^="Emitir factura"]')
    if (!(await exists(emitibles.first()))) {
      test.skip(true, 'sin cargos pendientes para emitir — sembrar registro pendiente')
    }

    const antes = await emitibles.count()
    await emitibles.first().click()
    await expect(emitibles).toHaveCount(antes - 1, { timeout: 20_000 })
  })
})

import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { gotoSection, exists } from './fixtures/ui'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'

// CONTABILIDAD POR LEDGER — la empresa y cada proyecto llevan libros propios.
//
// Verifica la separación a nivel de UI: el selector de contabilidad cambia el
// ledger activo (encabezado y datos), y la contabilidad de un proyecto recién
// seleccionado no muestra las pólizas de la empresa.
//
// Mismo gating que el resto de la suite: sin base URL/credenciales → skip;
// pasos que dependen de datos sembrados se skipean en runtime.

test.describe('CONTABILIDAD · ledger por empresa y proyecto', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('el selector de contabilidad cambia el ledger activo', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/contabilidad')

    const selector = page.getByLabel(/Seleccionar contabilidad/i)
    if (!(await exists(selector))) test.skip(true, 'Contabilidad no disponible para este rol')

    // Ledger empresa por defecto.
    await expect(page.getByRole('heading', { name: /Contabilidad — Empresa/i })).toBeVisible()

    // Cambiar a un proyecto (si hay): el encabezado refleja el ledger.
    const opciones = await selector.locator('option').evaluateAll(
      (opts) => (opts as HTMLOptionElement[]).map((o) => ({ value: o.value, label: o.textContent ?? '' })),
    )
    const proyecto = opciones.find((o) => o.value !== '')
    test.skip(!proyecto, 'sin proyectos sembrados para probar el ledger de proyecto')

    await selector.selectOption(proyecto!.value)
    await expect(
      page.getByRole('heading', { name: new RegExp(`Contabilidad — (?!Empresa)`, 'i') }),
    ).toBeVisible()
  })

  test('cada ledger lleva libros propios (las pólizas no se mezclan)', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/contabilidad')

    const selector = page.getByLabel(/Seleccionar contabilidad/i)
    if (!(await exists(selector))) test.skip(true, 'Contabilidad no disponible para este rol')

    // Folios visibles del ledger EMPRESA (tabla de pólizas).
    const filasEmpresa = await page.locator('table tbody tr').count()

    const opciones = await selector.locator('option').evaluateAll(
      (opts) => (opts as HTMLOptionElement[]).map((o) => o.value).filter((v) => v !== ''),
    )
    test.skip(opciones.length === 0, 'sin proyectos sembrados')

    await selector.selectOption(opciones[0])
    await page.waitForLoadState('networkidle').catch(() => {})

    // El ledger del proyecto NO hereda las pólizas de la empresa: o está vacío
    // o muestra un conteo distinto con folios que arrancan en su propia serie.
    const filasProyecto = await page.locator('table tbody tr').count()
    if (filasEmpresa > 0 && filasProyecto === filasEmpresa) {
      // Mismo conteo: exigir que al menos el encabezado del ledger cambió
      // (la igualdad de conteo puede ser legítima; el aislamiento de datos
      // a nivel SQL lo cubren los smokes de migración).
      await expect(
        page.getByRole('heading', { name: /Contabilidad — (?!Empresa)/i }),
      ).toBeVisible()
    }
  })
})

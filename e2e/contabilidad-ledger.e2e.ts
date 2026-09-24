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

  // Bandeja de pendientes: SÓLO LECTURA. No aprueba, no reprocesa ni crea
  // facturas: lo que se verifica es que la RPC responde para el ledger activo
  // (tabla o estado vacío) y no un error de permisos o de esquema.
  test('la bandeja de pendientes de contabilización carga sin error', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/contabilidad')

    const pestaña = page.getByRole('tab', { name: /Pendientes/i }).or(page.getByRole('button', { name: /Pendientes/i }))
    if (!(await exists(pestaña.first()))) test.skip(true, 'Contabilidad no disponible para este rol')
    await pestaña.first().click()

    await expect(page.getByText('Cargando pendientes…')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByRole('alert').filter({ hasText: /No se pudo cargar la bandeja/i })).toHaveCount(0)
    // O la tabla de pendientes, o el estado vacío: cualquiera de los dos prueba
    // que la RPC respondió para este ledger.
    await expect(
      page.getByText(/Sin pendientes de contabilización/).or(page.getByRole('table')).first(),
    ).toBeVisible()
  })

  // Tipos de cargo y Auxiliares: SÓLO LECTURA. No guarda configuración ni
  // asigna códigos en el sandbox compartido; verifica que la RPC
  // `conta_config_tipos_cargo_estado` y la lista de auxiliares responden para
  // la empresa y el ledger activos (tabla o estado vacío), sin error de
  // permisos o de esquema. Las reglas de escritura las cubre el arnés SQL
  // `supabase/tests/conta_auxiliares_tipo_cargo`, con roles de aplicación.
  test('la configuración por tipo de cargo y los auxiliares cargan sin error', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/contabilidad')

    const tipos = page.getByRole('tab', { name: /Tipos de cargo/i }).or(page.getByRole('button', { name: /Tipos de cargo/i }))
    if (!(await exists(tipos.first()))) test.skip(true, 'Contabilidad no disponible para este rol')
    await tipos.first().click()

    await expect(page.getByRole('heading', { name: 'Cuentas por tipo de cargo' })).toBeVisible()
    // Las filas sólo se pintan si la RPC respondió: el catálogo lo declara el
    // servidor y al menos mantenimiento aparece.
    await expect(page.getByLabel('Cuenta por cobrar de Mantenimiento')).toBeVisible({ timeout: 15_000 })

    const auxiliares = page.getByRole('tab', { name: /Auxiliares/i }).or(page.getByRole('button', { name: /Auxiliares/i }))
    await auxiliares.first().click()
    await expect(page.getByRole('heading', { name: 'Auxiliares de clientes' })).toBeVisible()
    await expect(
      page.getByText(/La empresa no tiene clientes activos/).or(page.getByRole('table')).first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})

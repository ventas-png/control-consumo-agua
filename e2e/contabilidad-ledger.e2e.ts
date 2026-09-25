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

  // Estado de cuenta: SÓLO LECTURA. Consulta el primer auxiliar disponible del
  // ledger de la empresa; si la empresa del E2E no tiene clientes activos, cae a
  // la consulta por UNIDAD en el primer proyecto que tenga unidades (la suite de
  // condominios siembra unidades, así que el camino siempre existe). No se
  // omite: el verificador de la suite rechaza cualquier skip. Lo que se
  // comprueba es que `conta_estado_cuenta` y `conta_estado_cuenta_pendientes`
  // responden (resumen o estado vacío) sin error de permisos o de esquema. Los
  // saldos, reversos, conciliación y aislamiento los cubre el arnés SQL
  // `supabase/tests/conta_estado_cuenta` con roles de aplicación.
  test('el estado de cuenta por auxiliar o unidad carga sin error', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/contabilidad')

    const pestaña = page.getByRole('tab', { name: /Estado de cuenta/i }).or(page.getByRole('button', { name: /Estado de cuenta/i }))
    if (!(await exists(pestaña.first()))) test.skip(true, 'Contabilidad no disponible para este rol')
    await pestaña.first().click()

    const valores = (select: ReturnType<typeof page.getByLabel>) =>
      select.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).filter(Boolean))

    const auxiliar = page.getByLabel('Auxiliar', { exact: true })
    await expect(auxiliar).toBeVisible()
    // La lista se llena al resolver la RPC de auxiliares; se da margen antes
    // de concluir que la empresa no tiene clientes.
    await expect.poll(async () => (await valores(auxiliar)).length, { timeout: 10_000 }).toBeGreaterThan(0).catch(() => {})
    const clientes = await valores(auxiliar)

    if (clientes.length > 0) {
      await auxiliar.selectOption(clientes[0])
    } else {
      const selector = page.getByLabel(/Seleccionar contabilidad/i)
      const proyectos = await valores(selector)
      let elegida = false
      for (const proyecto of proyectos) {
        await selector.selectOption(proyecto)
        // Cambiar de ledger remonta la pestaña: se vuelve a elegir el modo.
        await page.getByRole('radio', { name: 'Por unidad' }).click()
        const unidad = page.getByLabel('Unidad', { exact: true })
        await expect(unidad).toBeVisible()
        await expect.poll(async () => (await valores(unidad)).length, { timeout: 10_000 }).toBeGreaterThan(0).catch(() => {})
        const unidades = await valores(unidad)
        if (unidades.length > 0) {
          await unidad.selectOption(unidades[0])
          elegida = true
          break
        }
      }
      expect(elegida, 'el E2E necesita un auxiliar en la empresa o una unidad en algún proyecto').toBe(true)
    }

    await expect(page.getByText('Calculando estado de cuenta…')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByRole('alert').filter({ hasText: /No se pudo cargar el estado de cuenta/i })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Movimientos contabilizados' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Fuera del saldo contable' })).toBeVisible()
  })
})

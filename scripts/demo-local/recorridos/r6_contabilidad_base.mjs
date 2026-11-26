// Recorrido 6 · Las pantallas de base de Contabilidad, para el manual: catálogo, configuración, pólizas (y una
// póliza manual), pendientes, solicitudes de ajuste, balanza, estados financieros y presupuesto.
// Se corre DESPUÉS de r5_contabilidad.mjs (usa las pólizas que ese recorrido deja). Capturas: fotos/b*.png.
import { abrir, ir, foto, paso, pasos } from './app.mjs'

const SOLO = process.env.SOLO?.split(',') ?? null
const toca = (k) => !SOLO || SOLO.includes(k)
const { nav, page, errores } = await abrir('admin')
const pestana = async (nombre) => { await page.getByRole('tab', { name: new RegExp(nombre) }).click(); await page.waitForTimeout(1500) }
const modal = () => page.getByRole('dialog').last()
const tramo = async (nombre, fn) => {
  if (!toca(nombre)) return
  try { await fn() } catch (e) {
    paso(false, `${nombre} · se detuvo: ${String(e).split('\n').slice(0, 4).join(' ')}`)
    await foto(page, `b99-error-${nombre}`, { fullPage: true }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
  }
}

try {
  await ir(page, '/contabilidad')
  await page.getByLabel('Seleccionar contabilidad').selectOption({ label: '📍 Condominio Demo' })
  await page.waitForTimeout(1500)
  // El panel de puesta en marcha ocupa media pantalla: una captura con él abierto y luego se pliega.
  await foto(page, 'b01-puesta-en-marcha')
  const ocultar = page.getByRole('button', { name: 'Ocultar pasos' })
  if (await ocultar.isVisible().catch(() => false)) await ocultar.click()

  await tramo('catalogo', async () => {
    await pestana('Catálogo de cuentas')
    await page.getByText('Banco Industrial — operativa').first().waitFor({ timeout: 15000 })
    paso(true, 'Catálogo de cuentas del proyecto')
    await foto(page, 'b10-catalogo')
  })

  await tramo('configuracion', async () => {
    await pestana('Configuración')
    await page.getByText(/Resultados acumulados/).first().waitFor({ timeout: 15000 })
    paso(true, 'Configuración: cuentas especiales')
    await foto(page, 'b20-configuracion-especiales')
    await foto(page, 'b21-configuracion-completa', { fullPage: true })
  })

  await tramo('tiposcargo', async () => {
    await pestana('Tipos de cargo')
    await page.getByText(/Mantenimiento/).first().waitFor({ timeout: 15000 })
    paso(true, 'Tipos de cargo: tres configurados y el resto pendiente')
    await foto(page, 'b25-tipos-de-cargo')
  })

  await tramo('polizas', async () => {
    await pestana('Pólizas')
    await page.getByText(/Cuota mantenimiento/).first().waitFor({ timeout: 15000 })
    await foto(page, 'b30-polizas')
    await page.getByRole('button', { name: '+ Nueva póliza' }).click()
    await modal().getByPlaceholder('Descripción de la operación').fill('Honorarios del contador externo — noviembre')
    const filas = modal().locator('tbody tr')
    await filas.nth(0).locator('select').first().selectOption({ label: '5101 — Costos y gastos operativos' })
    await filas.nth(0).locator('input').first().fill('Honorarios')
    await filas.nth(0).locator('input[type="number"]').first().fill('1500')
    await filas.nth(1).locator('select').first().selectOption({ label: '1102 — Banco Industrial — operativa' })
    await filas.nth(1).locator('input').first().fill('Transferencia')
    await filas.nth(1).locator('select').nth(1).selectOption('haber')
    await filas.nth(1).locator('input[type="number"]').first().fill('1500')
    await foto(page, 'b31-nueva-poliza')
    await modal().getByRole('button', { name: 'Guardar y publicar' }).click()
    await page.getByText(/Honorarios del contador externo/).first().waitFor({ timeout: 15000 })
    paso(true, 'Póliza manual guardada y publicada en un solo paso')
    await page.getByText(/Honorarios del contador externo/).first().click()
    await modal().getByText('Transferencia').waitFor({ timeout: 10000 })
    await foto(page, 'b32-detalle-poliza')
    await page.keyboard.press('Escape')
  })

  await tramo('pendientes', async () => {
    await pestana('Pendientes')
    await page.waitForTimeout(1500)
    await foto(page, 'b40-pendientes')
    const cargo = page.getByText(/Reparación de portón dañado/).first()
    if (!await cargo.isVisible().catch(() => false)) {
      // El cargo sin configurar vive en una de las vistas de Pendientes: se busca.
      for (const v of ['Cargos', 'Cuotas y cargos', 'Otros']) {
        const chip = page.getByText(new RegExp(`^${v}`)).first()
        if (await chip.isVisible().catch(() => false)) { await chip.click(); await page.waitForTimeout(1200); if (await cargo.isVisible().catch(() => false)) break }
      }
    }
    paso(await cargo.isVisible().catch(() => false), 'Pendientes muestra el cargo de reparación sin configuración contable, con su motivo')
    await page.getByRole('heading', { name: 'Cargos a unidades' }).scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 260)
    await foto(page, 'b41-pendientes-cargo')
  })

  await tramo('ajustes', async () => {
    await pestana('Solicitudes de ajuste')
    await page.waitForTimeout(1500)
    paso(true, 'Bandeja de solicitudes de ajuste')
    await foto(page, 'b50-solicitudes-ajuste')
  })

  await tramo('balanza', async () => {
    await pestana('Balanza')
    await page.getByText(/Clientes y otras cuentas por cobrar/).first().waitFor({ timeout: 15000 })
    paso(true, 'Balanza de comprobación del mes')
    await foto(page, 'b60-balanza')
  })

  await tramo('eeff', async () => {
    await pestana('Estados financieros')
    await page.waitForTimeout(2500)
    paso(true, 'Estado de resultados')
    await foto(page, 'b70-estado-resultados')
    await page.getByText('Balance general', { exact: true }).click()
    await page.waitForTimeout(2500)
    await foto(page, 'b71-balance-general')
  })

  await tramo('presupuesto', async () => {
    await pestana('Presupuesto')
    const anio = String(new Date().getFullYear())
    const filaAnio = page.getByRole('row').filter({ hasText: `Presupuesto ${anio}` })
    if (await filaAnio.count() === 0) {
      await page.getByRole('button', { name: '+ Nuevo presupuesto' }).click()
      // El formulario propone el año siguiente; para comparar contra lo real se presupuesta el año en curso.
      await modal().locator('input[type="number"]').first().fill(anio)
      await modal().getByRole('button', { name: 'Crear' }).click()
      await filaAnio.waitFor({ timeout: 15000 })
    }
    await filaAnio.getByRole('button', { name: 'Partidas' }).click()
    await page.getByLabel('Agregar cuenta').waitFor({ timeout: 10000 })
    for (const [cod, mensual] of [['4101', '4800'], ['5102', '400'], ['5104', '700']]) {
      const sel = page.getByLabel('Agregar cuenta')
      const opcion = sel.locator('option').filter({ hasText: new RegExp(`^${cod} `) })
      if (await opcion.count() > 0) {   // si la cuenta ya está en la rejilla, no se ofrece otra vez
        await sel.selectOption(await opcion.first().getAttribute('value'))
        await page.getByRole('button', { name: 'Agregar', exact: true }).click()
      }
      await page.getByLabel(`${cod} Ene`).waitFor({ timeout: 10000 })
      for (const mes of ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']) {
        await page.getByLabel(`${cod} ${mes}`).fill(mensual)
      }
    }
    await foto(page, 'b80-presupuesto-partidas')
    await page.getByRole('button', { name: 'Guardar partidas' }).click()
    await page.getByLabel('Agregar cuenta').waitFor({ state: 'hidden', timeout: 15000 })
    await page.waitForTimeout(1500)
    // El comparativo es del presupuesto APROBADO: se propone y se aprueba.
    await filaAnio.getByRole('button', { name: 'Proponer' }).click()
    await filaAnio.getByRole('button', { name: 'Aprobar' }).click()
    await page.getByRole('button', { name: 'Aprobar', exact: true }).last().click()
    await filaAnio.getByRole('button', { name: 'Comparativo' }).waitFor({ timeout: 15000 })
    await foto(page, 'b82-presupuesto-aprobado')
    await filaAnio.getByRole('button', { name: 'Comparativo' }).click()
    await page.waitForTimeout(2500)
    paso(true, 'Presupuesto creado con tres partidas; comparativo contra lo real')
    await foto(page, 'b81-presupuesto-comparativo')
    await page.getByText('% ejecución').first().scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 300)
    await foto(page, 'b83-presupuesto-comparativo-tabla')
  })
} finally {
  console.log('\nErrores de red/página:\n' + ([...new Set(errores)].join('\n') || 'ninguno'))
  console.log(`\n${pasos.filter(p => p.ok).length}/${pasos.length} pasos bien`)
  await nav.close()
}

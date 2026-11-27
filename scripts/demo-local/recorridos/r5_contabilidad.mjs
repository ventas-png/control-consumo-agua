// Recorrido 5 · Contabilidad del residencial: saldos por residente, estado de cuenta y antigüedad, bancos
// (saldo inicial, depósito contra varios cobros, ajuste), fondo de reserva, caja chica y depreciación.
// Cada paso hace el clic real, comprueba el resultado y deja la captura que usa el manual (fotos/c*.png).
import { abrir, ir, foto, paso, pasos } from './app.mjs'

const hoy = new Date()
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mesAtras = (n) => { const d = new Date(hoy.getFullYear(), hoy.getMonth() - n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const finDeMes = (n) => { const d = new Date(hoy.getFullYear(), hoy.getMonth() - n + 1, 0); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` }
const HOY = iso(hoy)
const SOLO = process.env.SOLO?.split(',') ?? null
const toca = (k) => !SOLO || SOLO.includes(k)

const { nav, page, errores } = await abrir('admin')
const pestana = async (nombre) => { await page.getByRole('tab', { name: new RegExp(nombre) }).click(); await page.waitForTimeout(1200) }
const modal = () => page.getByRole('dialog').last()

try {
  await ir(page, '/contabilidad')
  await page.getByLabel('Seleccionar contabilidad').selectOption({ label: '📍 Condominio Demo' })
  await page.waitForTimeout(1500)
  paso(await page.getByRole('heading', { name: 'Contabilidad — Condominio Demo' }).isVisible(), 'Contabilidad del proyecto «Condominio Demo»')
  paso(await page.locator('section[aria-label="Puesta en marcha de esta contabilidad"]').count() === 1,
    'Al cambiar de contabilidad queda UN panel de puesta en marcha (no el de la anterior)')
  await foto(page, 'c01-contabilidad-proyecto')

  // ── A · Saldos iniciales por residente ──────────────────────────────────────────────────────
  if (toca('saldos')) {
    await pestana('Pólizas')
    await page.getByRole('button', { name: 'Saldos por residente' }).click()
    const pegado = [
      ['Unidad', 'Periodo', 'Monto', 'Vencimiento', 'Mora', 'Tipo'],
      ['Casa 4', mesAtras(3), '600.00', finDeMes(3), '25.00', ''],
      ['Casa 4', mesAtras(2), '600.00', finDeMes(2), '', ''],
      ['Casa 6', mesAtras(2), '1,500.00', finDeMes(2), '', 'extraordinaria'],
      ['Casa 7', mesAtras(1), '600.00', '', '', ''],
      ['Casa 99', mesAtras(1), '600.00', '', '', ''],
    ].map((r) => r.join('\t')).join('\n')
    await modal().getByLabel('Cuotas pendientes').fill(pegado)
    await foto(page, 'c10-saldos-residente-pegado')
    await modal().getByRole('button', { name: /Previsualizar/ }).click()
    await modal().getByText('Lista para cargar').first().waitFor({ timeout: 15000 })
    const listas = await modal().getByText('Lista para cargar').count()
    paso(listas === 4 && await modal().getByText('No se envió').count() === 1, `Vista previa: ${listas} cuotas listas y 1 renglón que no se envió (Casa 99 no existe)`)
    await foto(page, 'c11-saldos-residente-vista-previa')
    await modal().getByRole('button', { name: /Cargar 4 cuota/ }).click()
    await modal().getByText('Cargada').first().waitFor({ timeout: 15000 })
    paso(await modal().getByText('Cargada', { exact: true }).count() === 4, 'Cargadas las 4 cuotas históricas')
    await foto(page, 'c12-saldos-residente-cargado')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1500)
    const fila = page.getByText(/Saldo inicial — cuota/).first()
    paso(await fila.isVisible(), 'Las pólizas «Saldo inicial — cuota …» aparecen en el libro diario')
    await fila.click()
    await modal().getByText(/Resultados acumulados/).first().waitFor({ timeout: 10000 })
    paso(await modal().getByText(/Ingresos operativos/).count() === 0, 'La póliza va contra Resultados acumulados, no contra ingreso')
    await foto(page, 'c13-saldos-residente-poliza')
    await page.keyboard.press('Escape')
  }

  // ── B · Antigüedad de saldos y estado de cuenta ─────────────────────────────────────────────
  if (toca('antiguedad')) {
    await pestana('Estado de cuenta')
    await page.getByText('Antigüedad de saldos', { exact: true }).click()
    await page.getByText('Pedro Ramírez').first().waitFor({ timeout: 15000 })
    const pie = await page.getByText(/Por cobrar/).first().innerText()
    paso(/vencido/.test(pie), `Antigüedad de saldos: ${pie.replace(/\s+/g, ' ')}`)
    await foto(page, 'c20-antiguedad-saldos')
    await page.getByRole('button', { name: 'Ver estado' }).first().click()
    await page.getByRole('button', { name: /Descargar PDF/ }).waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    paso(true, '«Ver estado» abre el estado de cuenta del residente, con «Descargar PDF»')
    await foto(page, 'c21-estado-cuenta-residente')
  }

  // ── C · Bancos: saldo inicial, depósito contra varios cobros y comisión ─────────────────────
  if (toca('bancos')) {
    await pestana('Bancos')
    await page.getByText('DEPOSITO EN AGENCIA').first().waitFor({ timeout: 15000 })
    await foto(page, 'c30-bancos-pendientes')
    await page.getByRole('button', { name: 'Editar cuenta' }).click()
    await modal().getByLabel('Saldo inicial según el banco').fill('12,500.00')
    const d = new Date(hoy); d.setDate(d.getDate() - 10)
    await modal().getByLabel('Fecha del saldo inicial').fill(iso(d))
    await foto(page, 'c31-bancos-saldo-inicial')
    await modal().getByRole('button', { name: 'Guardar' }).click()
    await page.waitForTimeout(2000)
    paso(await page.getByText(/14,865\.00|14,900\.00/).first().isVisible().catch(() => false), 'El saldo según banco parte del saldo inicial (12,500.00 + movimientos)')
    // el depósito de 1,800 junta tres cobros de 600
    const filaDep = page.getByRole('row').filter({ hasText: 'DEP-88213' })
    await filaDep.getByRole('button', { name: 'Elegir documentos' }).click()
    await modal().getByText(/BOL-1001/).waitFor({ timeout: 15000 })
    for (const b of ['BOL-1001', 'BOL-1002']) await modal().getByRole('row').filter({ hasText: b }).getByRole('checkbox').check()
    paso(/faltan/.test(await modal().getByRole('status').innerText()), 'Con dos cobros marcados dice cuánto falta y no deja conciliar')
    await foto(page, 'c32-bancos-elegir-falta')
    await modal().getByRole('row').filter({ hasText: 'BOL-1003' }).getByRole('checkbox').check()
    paso(/cuadra/.test(await modal().getByRole('status').innerText()), 'Con los tres cobros la suma cuadra con el depósito')
    await foto(page, 'c33-bancos-elegir-cuadra')
    await modal().getByRole('button', { name: 'Conciliar', exact: true }).click()
    await page.waitForTimeout(2500)
    // la comisión se registra como ajuste
    await page.getByRole('row').filter({ hasText: 'COM-1126' }).getByRole('button', { name: 'Ajuste' }).click()
    await foto(page, 'c34-bancos-ajuste-comision')
    await page.getByRole('button', { name: 'Registrar ajuste' }).click()
    await page.waitForTimeout(2500)
    paso(await page.getByRole('row').filter({ hasText: 'DEP-88213' }).count() === 0, 'El depósito conciliado ya no está entre los pendientes')
    await foto(page, 'c35-bancos-despues')
  }

  // ── D · Fondo de reserva ────────────────────────────────────────────────────────────────────
  if (toca('fondo')) {
    await pestana('Bancos')
    await page.getByRole('button', { name: 'Fondo de reserva' }).click()
    await modal().getByLabel('Monto').fill('2000')
    await modal().getByLabel('Concepto').fill('Traslado mensual al fondo de reserva')
    await modal().getByLabel('Referencia').fill('TRF-5521')
    await modal().getByLabel('Cuenta del fondo de reserva').selectOption({ label: '1103 · Banco — fondo de reserva' })
    await modal().getByLabel('Contrapartida').selectOption({ label: '1102 · Banco Industrial — operativa' })
    await foto(page, 'c40-fondo-reserva-aportacion')
    await modal().getByRole('button', { name: /Registrar aportación/ }).click()
    await modal().getByText(/Saldo en libros/).waitFor({ timeout: 15000 })
    await page.waitForTimeout(2500)
    const res = (await modal().getByText(/Saldo en libros/).innerText()).replace(/\s+/g, ' ')
    paso(/2,000\.00/.test(res), `Fondo de reserva tras la aportación: ${res}`)
    await foto(page, 'c41-fondo-reserva-saldo')
    await page.keyboard.press('Escape')
  }

  // ── E · Caja chica: constituir el fondo y reponer ───────────────────────────────────────────
  if (toca('caja')) {
    await pestana('Bancos')
    await page.getByRole('button', { name: 'Caja chica' }).click()
    await modal().getByLabel('Banco').selectOption({ label: '1102 · Banco Industrial — operativa' })
    await modal().getByLabel('Cuenta de caja chica').selectOption({ label: '1104 · Caja chica' })
    await foto(page, 'c50-caja-chica-constituir')
    await modal().getByRole('button', { name: 'Constituir fondo' }).click()
    await modal().getByRole('button', { name: /Ver vales pendientes/ }).waitFor({ timeout: 15000 })
    paso(true, 'Fondo fijo constituido: la caja pasa a «reponer»')
    await modal().getByLabel('Banco').selectOption({ label: '1102 · Banco Industrial — operativa' })
    await modal().getByRole('button', { name: /Ver vales pendientes/ }).click()
    await modal().getByText('Bombillas para pasillos').waitFor({ timeout: 15000 })
    await modal().getByLabel('Cuenta de gasto de Bombillas para pasillos').selectOption({ label: '5102 · Mantenimiento menor' })
    await modal().getByLabel('Cuenta de gasto de Mensajería a la municipalidad').selectOption({ label: '5103 · Transporte y mensajería' })
    await foto(page, 'c51-caja-chica-vales')
    await modal().getByRole('button', { name: /Reponer/ }).click()
    await modal().getByText(/✓ 5102/).waitFor({ timeout: 15000 })
    paso(await modal().getByText(/✓ 51/).count() === 2, 'Repuestos dos vales; el que no tiene cuenta queda pendiente')
    await foto(page, 'c52-caja-chica-repuesta')
    await page.keyboard.press('Escape')
  }

  // ── F · Depreciación mensual ────────────────────────────────────────────────────────────────
  if (toca('depreciacion')) {
    await pestana('Compras')
    await page.getByText(/^Activos fijos/).first().click()
    await page.getByText('Bomba sumergible 5 HP').waitFor({ timeout: 15000 })
    await foto(page, 'c60-activos-fijos')
    await page.getByRole('button', { name: /Depreciar el mes/ }).click()
    await modal().getByRole('button', { name: /Previsualizar/ }).click()
    await modal().getByText('Por depreciar').first().waitFor({ timeout: 15000 })
    await foto(page, 'c61-depreciacion-vista-previa')
    await modal().getByRole('button', { name: /Aplicar depreciación/ }).click()
    await modal().getByText('Depreciado', { exact: true }).first().waitFor({ timeout: 15000 })
    paso(true, `Depreciación aplicada: ${(await modal().getByText(/Total depreciado/).locator('..').innerText()).replace(/\s+/g, ' ')}`)
    await foto(page, 'c62-depreciacion-aplicada')
    await page.keyboard.press('Escape')
  }

  // ── G · Cómo quedó en libros ────────────────────────────────────────────────────────────────
  if (toca('libros')) {
    await pestana('Pólizas')
    await page.waitForTimeout(1500)
    await foto(page, 'c70-polizas-del-mes', { fullPage: true })
    await pestana('Balanza')
    await page.waitForTimeout(2000)
    await foto(page, 'c71-balanza', { fullPage: true })
  }
} catch (e) {
  paso(false, `Contabilidad · se detuvo: ${String(e).split('\n')[0]}`)
  await foto(page, 'c99-error', { fullPage: true }).catch(() => {})
} finally {
  console.log('\nErrores de red/página:\n' + ([...new Set(errores)].join('\n') || 'ninguno'))
  console.log(`\n${pasos.filter(p => p.ok).length}/${pasos.length} pasos bien`)
  await nav.close()
}

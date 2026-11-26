// Recorrido 2 · Ana Pérez (rol «Personal de limpieza»: sólo ver/editar Limpieza) ejecuta las rutas del día:
// la suya y la de Luis (la Ruta del día muestra a todos; se filtra por empleado).
import { join } from 'node:path'
import { abrir, ir, foto, confirmar, paso, pasos } from './app.mjs'

const { nav, page, errores } = await abrir('ana')

async function recorrer(empleado, pre) {
  // El encabezado de la tarjeta del empleado: el contenedor más cercano a su nombre que tiene botones.
  const cab = page.getByText(`${empleado} — `).first().locator('xpath=ancestor::div[.//button][1]')
  await cab.waitFor({ timeout: 10000 })
  const iniciar = cab.getByRole('button', { name: '▶ Iniciar' })
  if (await iniciar.count()) {
    await iniciar.click()
    const prep = page.getByRole('region', { name: 'Antes de iniciar el turno' })
    await prep.waitFor({ timeout: 10000 })
    await prep.getByText('Obligatoria').first().waitFor({ timeout: 10000 })
    await page.waitForTimeout(800)
    // Nombre y etiqueta «Obligatoria» van en el mismo elemento: «HerramientaObligatoria» = sin nombre.
    const sinNombre = await prep.getByText(/^Herramienta\s*(Obligatoria)?\s*$/).count()
    paso(sinNombre === 0, `${empleado} · herramientas con nombre en «Antes de iniciar»: ${sinNombre === 0 ? 'sí' : `${sinNombre} aparecen sólo como «Herramienta»`}`)
    await foto(page, `${pre}02-preparacion`, { fullPage: true })
    const casillas = prep.getByRole('checkbox')
    const n = await casillas.count()
    for (let i = 0; i < n; i++) { await casillas.nth(i).check(); await page.waitForTimeout(150) }
    await prep.getByRole('button', { name: /Tengo todo/ }).click()
    paso(true, `${empleado} · ${n} cosas confirmadas e inicio del turno`)
  } else {
    const guiado = () => page.getByRole('button', { name: /^Empezar en|Listo · Siguiente/ }).or(page.getByText('¡Recorrido terminado!'))
    if (!(await guiado().first().isVisible().catch(() => false))) await cab.getByText('▾').click()
    paso(true, `${empleado} · turno ya en curso: se retoma el paso a paso`)
  }

  const listo = () => page.getByRole('button', { name: /Listo · Siguiente/ })
  const hechas = []
  const vistas = new Map()
  let novedad = false, omitida = false
  for (let vuelta = 0; vuelta < 40; vuelta++) {
    await page.waitForTimeout(700)
    if (await page.getByText('¡Recorrido terminado!').isVisible().catch(() => false)) break
    const empezar = page.getByRole('button', { name: /^Empezar en/ })
    if (await empezar.isVisible().catch(() => false)) {
      if (!hechas.length) await foto(page, `${pre}03-parada`)
      await empezar.click(); continue
    }
    const tarjeta = page.getByRole('region', { name: /^Tarea \d+ de \d+:/ })
    await tarjeta.waitFor({ timeout: 10000 })
    const nombre = (await tarjeta.getAttribute('aria-label')) ?? ''
    const titulo = nombre.replace(/^Tarea \d+ de \d+:\s*/, '')
    vistas.set(nombre, (vistas.get(nombre) ?? 0) + 1)
    if (vistas.get(nombre) > 2) { paso(false, `${empleado} · «${titulo}» no avanza después de dos intentos`); await foto(page, `${pre}98-atascada`); break }
    const sigueIgual = async () => ((await page.getByRole('region', { name: /^Tarea \d+ de \d+:/ }).getAttribute('aria-label')) ?? '') === nombre

    if (titulo.startsWith('Limpieza de vidrios')) {
      const marcadas = await tarjeta.getByRole('checkbox').evaluateAll(cs => cs.filter(c => c.checked).length)
      if (marcadas === 0) {
        await listo().click(); await page.waitForTimeout(900)
        paso(await sigueIgual(), `${empleado} · «${titulo}» sin checklist: ${(await sigueIgual()) ? 'no avanza (bien)' : 'avanzó (mal)'}`)
      }
      // A ritmo humano: un toque cada 0,8 s.
      const cs = tarjeta.getByRole('checkbox')
      for (let i = 0; i < await cs.count(); i++) if (!(await cs.nth(i).isChecked())) { await cs.nth(i).check(); await page.waitForTimeout(800) }
      await listo().click(); hechas.push(`${titulo}: checklist completo`)
    } else if (titulo.startsWith('Trapeado de piso')) {
      if (!hechas.some(h => h.startsWith('Trapeado'))) {
        await listo().click(); await page.waitForTimeout(900)
        paso(await sigueIgual(), `${empleado} · «${titulo}» sin foto: ${(await sigueIgual()) ? 'no avanza (bien)' : 'avanzó (mal)'}`)
      }
      await tarjeta.locator('input[type="file"]').first().setInputFiles(join(import.meta.dirname, '..', 'evidencia-demo.jpg'))
      await page.waitForTimeout(2500)
      if (!hechas.some(h => h.startsWith('Trapeado'))) await foto(page, `${pre}04-tarea-con-foto`)
      await listo().click(); hechas.push(`${titulo}: con foto`)
    } else if (titulo.startsWith('Barrido de piso') && !novedad) {
      novedad = true
      await page.getByRole('button', { name: /Encontré algo/ }).click()
      await page.getByLabel('Observación o hallazgo').fill('Luminaria fundida en el pasillo; queda oscuro en la noche.')
      await page.getByLabel('Prioridad').selectOption('alta')
      await page.getByLabel('Requiere mantenimiento').check()
      await foto(page, `${pre}05-encontre-algo`)
      await confirmar(page, 'Registrar'); hechas.push(`${titulo}: novedad alta + mantenimiento`)
    } else if (titulo.startsWith('Vaciar basureros') && !omitida && hechas.length > 3) {
      omitida = true
      await page.getByRole('button', { name: /Omitir/ }).click()
      await confirmar(page, 'Omitir'); hechas.push(`${titulo}: omitida`)
    } else {
      await listo().click(); hechas.push(`${titulo}: hecha`)
    }
  }
  hechas.forEach(h => console.log('       · ' + h))
  await page.getByText('¡Recorrido terminado!').waitFor({ timeout: 10000 })
  await foto(page, `${pre}06-fin`)
  const resumen = await page.getByText(/hechas ·/).first().innerText().catch(() => '')
  paso(true, `${empleado} · fin del recorrido: «${resumen.trim()}»`)
  // Se cierra desde el resumen final: el «✓ Cerrar turno» del encabezado cierra sin preguntar (hallazgo 3).
  const fin = page.locator('div').filter({ hasText: '¡Recorrido terminado!' }).filter({ has: page.getByRole('button', { name: /Cerrar turno/ }) }).last()
  await fin.getByRole('button', { name: /Cerrar turno/ }).click()
  await page.waitForTimeout(2500)
  await foto(page, `${pre}07-cerrado`)
}

try {
  await ir(page, '/condominios/prog_limpieza')
  const pestañas = await page.getByRole('tablist').first().innerText().catch(() => '')
  paso(!/Asignación turnos/.test(pestañas), `Ana sólo ve la pestaña: ${pestañas.replace(/\s+/g, ' ').trim().slice(0, 60)}`)
  await page.getByRole('tab', { name: /Ruta del día/ }).click()
  await page.getByText('Ana Pérez — Conserje').first().waitFor({ timeout: 15000 })
  await foto(page, 'b01-ruta-dia')
  await recorrer('Ana Pérez', 'b')
  await recorrer('Luis Gómez', 'c')
} catch (e) {
  paso(false, `Se detuvo: ${String(e).split('\n')[0]}`)
  await foto(page, 'b99-error', { fullPage: true }).catch(() => {})
} finally {
  console.log('\nErrores de red/página:\n' + ([...new Set(errores)].join('\n') || 'ninguno'))
  console.log(`\n${pasos.filter(p => p.ok).length}/${pasos.length} pasos bien`)
  await nav.close()
}

// Recorrido 1 · Administración: generar turnos, armar una rutina nueva y asignar en el calendario.
import { abrir, ir, foto, confirmar, paso, pasos, HOY, MES, etiqueta, habilSiguiente } from './app.mjs'

const HOYL = etiqueta(HOY), SIGL = etiqueta(habilSiguiente())

const { nav, page, errores } = await abrir('admin')
const t = (s) => page.getByText(s, { exact: false })
try {
  // ── Asignación turnos → ⚡ Generar ─────────────────────────────────────────
  await ir(page, '/condominios/turnos')
  await foto(page, 'a01-turnos-antes')
  await page.getByRole('button', { name: new RegExp(`Generar ${MES}`) }).click()
  await confirmar(page, 'Generar')
  const aviso = page.getByText(/turnos generados/).first()
  await aviso.waitFor({ timeout: 15000 })
  paso(true, `Asignación turnos → Generar ${MES}: «${(await aviso.innerText()).trim()}»`)
  await page.waitForTimeout(1500)
  await foto(page, 'a02-turnos-generados')

  // ── Limpieza → Rutinas → + Nueva rutina ────────────────────────────────────
  await ir(page, '/condominios/prog_limpieza')
  await page.getByRole('tab', { name: /Rutinas/ }).click()
  await page.getByRole('button', { name: '+ Nueva rutina' }).click()
  await page.locator('#rutina-nombre').fill('Trapeado de Pasillos y Gradas')
  await page.locator('#rutina-horario').selectOption({ label: 'Tarde (14:00–22:00)' })
  await page.locator('#rutina-desc').fill('Después del barrido')
  await page.getByRole('button', { name: '＋ Agregar áreas' }).click()
  for (const a of ['Pasillo nivel 1', 'Pasillo nivel 2', 'Pasillo nivel 3', 'Gradas']) {
    await page.getByRole('dialog').last().getByText(a, { exact: true }).click()
  }
  await page.getByRole('button', { name: 'Agregar 4 áreas' }).click()
  for (const a of ['Pasillo nivel 1', 'Pasillo nivel 2', 'Pasillo nivel 3', 'Gradas']) {
    await page.getByRole('button', { name: `Agregar actividades a ${a}` }).click()
    await page.getByRole('dialog').last().getByText('Trapeado de piso', { exact: true }).click()
    await page.getByRole('button', { name: 'Agregar 1 actividad' }).click()
  }
  await page.waitForTimeout(500)
  await foto(page, 'a03-rutina-editor')
  const resumen = await page.getByLabel('Resumen del recorrido').innerText()
  paso(/4\s*áreas/.test(resumen) && /4\s*actividades/.test(resumen) && /40 min/.test(resumen), `Editor: resumen «${resumen.replace(/\s+/g, ' ').trim()}»`)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await t('Trapeado de Pasillos y Gradas').first().waitFor()
  await page.waitForTimeout(1200)
  paso(await page.getByRole('button', { name: 'Editar el recorrido de Trapeado de Pasillos y Gradas' }).isVisible(), 'Rutina nueva guardada y listada')
  await foto(page, 'a04-rutinas-lista')

  // ── Calendario: ＋ varias, arrastrar, quitar ─────────────────────────────────
  await page.getByRole('tab', { name: /Calendario/ }).click()
  await page.getByRole('region', { name: 'Calendario de Ana Pérez' }).waitFor()
  await page.getByRole('button', { name: `Agregar rutinas a Ana Pérez el ${HOYL}` }).click()
  await page.getByRole('dialog').last().getByText('Limpieza de Lobby', { exact: true }).click()
  await page.getByRole('dialog').last().getByText('Barrido de Pasillos y Gradas', { exact: true }).click()
  await foto(page, 'a05-calendario-mas')
  await page.getByRole('button', { name: 'Asignar 2 rutinas' }).click()
  const avisoAsig = page.getByText(/tareas asignadas a Ana Pérez/)
  await avisoAsig.waitFor({ timeout: 10000 })
  paso(true, `＋ en Ana ${HOYL}: «${(await avisoAsig.innerText()).trim()}»`)

  await page.getByRole('button', { name: `Agregar rutinas a Luis Gómez el ${HOYL}` }).click()
  await page.getByRole('dialog').last().getByText('Trapeado de Pasillos y Gradas', { exact: true }).click()
  await page.getByRole('button', { name: 'Asignar 1 rutina' }).click()
  await page.getByText(/tareas asignadas a Luis Gómez/).waitFor({ timeout: 10000 })
  paso(true, `＋ en Luis ${HOYL}: Trapeado asignado`)

  // Arrastrar de la barra al viernes de Ana
  const chipBarra = page.getByRole('list', { name: 'Rutinas para asignar' }).getByText(/Limpieza de Lobby/)
  const viernes = page.getByRole('group', { name: new RegExp(`Turno de Ana Pérez el ${SIGL}`) })
  await chipBarra.dragTo(viernes)
  await page.getByText(new RegExp(`tareas asignadas a Ana Pérez el ${SIGL}`)).waitFor({ timeout: 10000 }).then(
    () => paso(true, `Arrastrar «Limpieza de Lobby» al ${SIGL} de Ana: asignada`),
    () => paso(false, `Arrastrar «Limpieza de Lobby» al ${SIGL} de Ana: no se asignó`),
  )
  // Quitar del día lo que se acaba de arrastrar
  const chipVie = page.getByRole('button', { name: new RegExp(`^Limpieza de Lobby, Ana Pérez el ${SIGL}`) })
  if (await chipVie.isVisible().catch(() => false)) {
    await chipVie.click()
    await page.getByRole('button', { name: 'Quitar del día' }).click()
    await page.getByText(new RegExp(`quitada de Ana Pérez el ${SIGL}`)).waitFor({ timeout: 10000 }).then(
      () => paso(true, `Detalle → Quitar del día (${SIGL}): quitada`),
      () => paso(false, `Detalle → Quitar del día (${SIGL}): no se quitó`),
    )
  }
  // Re-asigna el viernes con ＋ para dejar la semana armada
  await page.getByRole('button', { name: `Agregar rutinas a Ana Pérez el ${SIGL}` }).click()
  await page.getByRole('dialog').last().getByText('Limpieza de Lobby', { exact: true }).click()
  await page.getByRole('dialog').last().getByText('Barrido de Pasillos y Gradas', { exact: true }).click()
  await page.getByRole('button', { name: 'Asignar 2 rutinas' }).click()
  await page.getByText(new RegExp(`tareas asignadas a Ana Pérez el ${SIGL}`)).waitFor({ timeout: 10000 })
  await page.waitForTimeout(1200)
  await foto(page, 'a06-calendario-asignado', { fullPage: true })
  const contador = await page.getByRole('region', { name: 'Calendario de Ana Pérez' }).getByText(/turnos con rutina/).innerText()
  paso(true, `Contador de Ana: «${contador.trim()}»`)
} catch (e) {
  paso(false, `Se detuvo: ${String(e).split('\n')[0]}`)
  await foto(page, 'a99-error').catch(() => {})
} finally {
  console.log('\nErrores de red/página:\n' + ([...new Set(errores)].join('\n') || 'ninguno'))
  console.log(`\n${pasos.filter(p => p.ok).length}/${pasos.length} pasos bien`)
  await nav.close()
}

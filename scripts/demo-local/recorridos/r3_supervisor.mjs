// Recorrido 3 · La supervisora revisa indicadores y novedades, y que lo cerrado o pasado ya no se toque.
import { abrir, ir, foto, paso, pasos, HOY, etiqueta, habilAnterior } from './app.mjs'

const HOYL = etiqueta(HOY), AYERL = etiqueta(habilAnterior())

const { nav, page, errores } = await abrir('supervisor')
try {
  await ir(page, '/condominios/prog_limpieza')
  const indicadores = (await page.getByLabel('Indicadores de limpieza').innerText()).replace(/\s+/g, ' ')
  paso(true, `Indicadores para la supervisora: ${indicadores}`)
  await foto(page, 'd02-indicadores-calendario')
  await page.getByRole('tab', { name: /Novedades/ }).click()
  await page.getByText(/Luminaria fundida/).first().waitFor({ timeout: 10000 })
  await foto(page, 'd03-novedades')
  await page.getByRole('button', { name: /Marcar atendida/ }).first().click()
  await page.waitForTimeout(2000)
  const despues = (await page.getByLabel('Indicadores de limpieza').innerText()).replace(/\s+/g, ' ')
  paso(/0 Requieren manto/.test(despues), `Tras «Marcar atendida»: ${despues.match(/(\d+) Requieren manto/)?.[0] ?? despues}`)
  await foto(page, 'd04-novedad-atendida')
  // Lo de ayer no se toca: el calendario no ofrece ＋ en días pasados ni en turnos cerrados.
  await page.getByRole('tab', { name: /Calendario/ }).click()
  await page.getByRole('region', { name: 'Calendario de Ana Pérez' }).waitFor()
  const masHoyAna = await page.getByRole('button', { name: `Agregar rutinas a Ana Pérez el ${HOYL}` }).count()
  const masAyer = await page.getByRole('button', { name: `Agregar rutinas a Ana Pérez el ${AYERL}` }).count()
  paso(masHoyAna === 0 && masAyer === 0, `Turno cerrado de hoy y día pasado sin ＋: ${masHoyAna === 0 && masAyer === 0 ? 'sí' : 'no'}`)
  await page.getByRole('button', { name: new RegExp(`^Limpieza de Lobby, Ana Pérez el ${HOYL}`) }).click()
  const quitar = await page.getByRole('button', { name: 'Quitar del día' }).count()
  const motivo = await page.getByText(/ya está cerrado|tareas trabajadas/).first().innerText().catch(() => '')
  paso(quitar === 0, `Rutina trabajada: sin «Quitar del día» (${motivo.trim()})`)
  await foto(page, 'd05-detalle-trabajada')
} catch (e) {
  paso(false, `Supervisora · se detuvo: ${String(e).split('\n')[0]}`)
  await foto(page, 'd99-error', { fullPage: true }).catch(() => {})
} finally {
  console.log('\nErrores de red/página:\n' + ([...new Set(errores)].join('\n') || 'ninguno'))
  console.log(`\n${pasos.filter(p => p.ok).length}/${pasos.length} pasos bien`)
  await nav.close()
}

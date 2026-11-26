// Recorrido 4 · Las correcciones de las fallas encontradas en Limpieza, con clics reales:
//   2 · quien sólo CREA rutinas arma y guarda una completa (#1176)
//   1 · un paso «Opcional» crea su tarea opcional y no cuenta como pendiente (#1177)
//   3 · cerrar con pendientes pide confirmar (#1174) y la tarjeta dice «Incompleto», no «Completado»
// Corre después de r1_admin.mjs (turnos generados). Usa a Marta para no tocar las rutas de Ana y Luis.
import { execFileSync } from 'node:child_process'
import { abrir, ir, foto, confirmar, paso, pasos, HOY, etiqueta } from './app.mjs'

const HOYL = etiqueta(HOY)
const sql = (q) => execFileSync('psql', ['-X', '-At', '-c', q], {
  env: { ...process.env, PGHOST: '/tmp/demosock', PGPORT: '55700', PGUSER: 'postgres', PGDATABASE: 'demo' },
}).toString().trim()

// ── 2 · Crear sin editar ─────────────────────────────────────────────────────
{
  const { nav, page } = await abrir('creador')
  try {
    await ir(page, '/condominios/prog_limpieza')
    await page.getByRole('tab', { name: /Rutinas/ }).click()
    await page.getByRole('button', { name: /el recorrido de/ }).first().waitFor({ timeout: 10000 })
    const ver = await page.getByRole('button', { name: /^Ver el recorrido de/ }).count()
    paso(ver > 0, `Creador: las rutinas existentes se abren sólo para ver (${ver} con «Ver recorrido»)`)
    await page.getByRole('button', { name: '+ Nueva rutina' }).click()
    const editable = await page.locator('#rutina-nombre').isVisible()
    paso(editable, `Creador: «+ Nueva rutina» abre el editor ${editable ? 'para armar' : 'en solo lectura (falla)'}`)
    await page.locator('#rutina-nombre').fill('Repaso de Lobby')
    await page.getByRole('button', { name: '＋ Agregar áreas' }).click()
    await page.getByRole('dialog').last().getByText('Lobby', { exact: true }).click()
    await page.getByRole('button', { name: 'Agregar 1 área' }).click()
    await page.getByRole('button', { name: 'Agregar actividades a Lobby' }).click()
    await page.getByRole('dialog').last().getByText('Barrido de piso', { exact: true }).click()
    await page.getByRole('button', { name: 'Agregar 1 actividad' }).click()
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await page.getByText('Repaso de Lobby').first().waitFor({ timeout: 10000 })
    await page.waitForTimeout(1500)
    const pasosGuardados = sql("select count(*) from rutina_actividades ra join rutinas_limpieza r on r.id = ra.rutina_id where r.nombre = 'Repaso de Lobby'")
    paso(pasosGuardados === '1', `Creador: la rutina nueva se guardó con su recorrido (${pasosGuardados} paso en la base)`)
    await foto(page, 'f01-creador-rutina-guardada')
  } catch (e) { paso(false, `Creador · se detuvo: ${String(e).split('\n')[0]}`) } finally { await nav.close() }
}

// ── 1 y 3 · Paso opcional y cierre con pendientes ────────────────────────────
const { nav, page, errores } = await abrir('supervisor')
try {
  await ir(page, '/condominios/prog_limpieza')
  await page.getByRole('tab', { name: /Rutinas/ }).click()
  await page.getByRole('button', { name: 'Editar el recorrido de Barrido de Pasillos y Gradas' }).click()
  await page.getByRole('button', { name: 'Volver opcional Limpieza de pasamanos' }).click()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.waitForTimeout(1500)
  paso(sql("select ra.obligatoria from rutina_actividades ra join plantillas_tarea_cargo p on p.id = ra.plantilla_tarea_id where p.titulo = 'Limpieza de pasamanos'") === 'f',
    'Supervisora: «Limpieza de pasamanos» quedó como paso Opcional en el recorrido')

  await page.getByRole('tab', { name: /Calendario/ }).click()
  await page.getByRole('region', { name: 'Calendario de Marta Ruiz' }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: `Agregar rutinas a Marta Ruiz el ${HOYL}` }).click()
  await page.getByRole('dialog').last().getByText('Barrido de Pasillos y Gradas', { exact: true }).click()
  await page.getByRole('button', { name: 'Asignar 1 rutina' }).click()
  await page.getByText(/tareas asignadas a Marta Ruiz/).waitFor({ timeout: 10000 })
  const tareas = sql("select string_agg(t.titulo || ':' || t.obligatoria, ', ' order by t.orden) from tareas_bloque t join bloques_turno b on b.id = t.bloque_id join personal_condominio p on p.id = b.personal_id where p.nombre = 'Marta Ruiz' and b.fecha = (now() at time zone 'America/Guatemala')::date")
  paso(/Limpieza de pasamanos:false/.test(tareas) && (tareas.match(/:true/g) ?? []).length === 7,
    `Asignar crea la tarea opcional: ${(tareas.match(/:true/g) ?? []).length} obligatorias y «Limpieza de pasamanos» opcional`)
  const pend = sql("select (rutinas -> 0 ->> 'pendientes') || '/' || (rutinas -> 0 ->> 'tareas') from limpieza_calendario('d1000000-0000-4000-8000-0000000000c1', (now() at time zone 'America/Guatemala')::date, (now() at time zone 'America/Guatemala')::date) where personal_nombre = 'Marta Ruiz'")
  paso(pend === '7/8', `El calendario cuenta como pendientes sólo las obligatorias: ${pend}`)

  // Ruta del día: iniciar el turno de Marta y cerrarlo desde el encabezado con todo pendiente.
  await page.getByRole('tab', { name: /Ruta del día/ }).click()
  const cab = page.getByText('Marta Ruiz — ').first().locator('xpath=ancestor::div[.//button][1]')
  await cab.waitFor({ timeout: 10000 })
  await cab.getByRole('button', { name: '▶ Iniciar' }).click()
  const prep = page.getByRole('region', { name: 'Antes de iniciar el turno' })
  await prep.waitFor({ timeout: 10000 })
  const casillas = prep.getByRole('checkbox')
  for (let i = 0; i < await casillas.count(); i++) await casillas.nth(i).check()
  await prep.getByRole('button', { name: /Tengo todo/ }).click()
  await page.waitForTimeout(1500)
  await cab.getByRole('button', { name: /Cerrar turno/ }).click()
  const aviso = page.getByText(/Quedan \d+ tareas pendientes/)
  const pregunta = await aviso.waitFor({ timeout: 8000 }).then(() => aviso.innerText(), () => '')
  paso(/Quedan 7 tareas pendientes/.test(pregunta), `«✓ Cerrar turno» con pendientes pregunta antes: «${pregunta.split('.')[0]}»`)
  await foto(page, 'f02-confirmar-cierre')
  await confirmar(page, 'Cerrar igual')
  await page.waitForTimeout(2000)
  const insignia = await cab.innerText()
  paso(/Incompleto/.test(insignia) && !/Completado/.test(insignia), `Tras cerrar con 7 pendientes la tarjeta dice: ${/Incompleto/.test(insignia) ? '«Incompleto»' : '«Completado» (falla)'}`)
  await foto(page, 'f03-turno-incompleto')
} catch (e) {
  paso(false, `Supervisora · se detuvo: ${String(e).split('\n')[0]}`)
  await foto(page, 'f99-error', { fullPage: true }).catch(() => {})
} finally {
  console.log('\nErrores de red/página:\n' + ([...new Set(errores)].join('\n') || 'ninguno'))
  console.log(`\n${pasos.filter(p => p.ok).length}/${pasos.length} pasos bien`)
  await nav.close()
}

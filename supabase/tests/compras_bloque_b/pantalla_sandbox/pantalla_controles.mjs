// Prueba de pantalla contra el SANDBOX (jwpmivhvlstslncrtokb): Operaciones › Órdenes compra. NUNCA producción.
// Padrón 5b5b2000… (padron_ui_controles.sql.tpl; uno ya sembrado se pone al día con padron_ui_controles_actualizacion.sql.tpl).
// Ver README.md. Uso (desde la raíz del repo):
//   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npx vite --port 5199 --host 127.0.0.1   (otra terminal)
//   ZZ_UI_PW=… node supabase/tests/compras_bloque_b/pantalla_sandbox/pantalla_controles.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5199'
const PW = process.env.ZZ_UI_PW
if (!PW) throw new Error('Falta ZZ_UI_PW (la contraseña de prueba del padrón 5b5b2000; no está en el repositorio).')
const OUT = (process.env.ZZ_UI_SALIDA || '/tmp/pantalla-controles') + '/'
fs.mkdirSync(OUT, { recursive: true })

const PERFILES = {
  admin: { email: 'zz-ui-admin@example.com', nombre: 'Administrador' },
  autoriza: { email: 'zz-ui-autoriza@example.com', nombre: 'Autorizar + Editar (sin Cambiar estado)' },
  estado: { email: 'zz-ui-estado@example.com', nombre: 'Cambiar estado + Editar (sin Autorizar, sin Eliminar)' },
  sinEditar: { email: 'zz-ui-sineditar@example.com', nombre: 'Autorizar SIN Editar' },
  // «Autorizar» genérico de Contabilidad + Editar, SIN la llave de la orden de compra (D1): el servidor ya no deja aprobar ni devolver
  soloGenerico: { email: 'zz-ui-sologenerico@example.com', nombre: 'Solo «Autorizar» genérico + Editar (SIN la llave de la orden de compra)' },
}

const ORDENES = {
  nuevo: 'ZZ UI borrador nuevo',
  devuelto: 'ZZ UI borrador devuelto',
  aprobada: 'ZZ UI orden aprobada',
}

// Botones de paso que se esperan, por perfil y por orden (lo que el servidor va a aceptar). Aprobar una orden y devolver una
// aprobada exigen la llave de la pestaña (`condominios.tab.ordenes_compra.approve`) y «Editar» de Contabilidad; el «Autorizar /
// Denegar» genérico de Contabilidad ya no basta (D1). Emitir y cancelar siguen con «Cambiar estado» + «Editar».
// La prueba de vitest `padronSandbox.test.tsx` contrasta este objeto con las filas del padrón y con la pantalla real.
const ESPERADO = {
  admin: {
    nuevo: ['Aprobar', 'Cancelar OC', 'Eliminar', 'Editar'],
    devuelto: ['Aprobar', 'Cancelar OC', 'Editar'],            // sin Eliminar: ya se numeró y se devolvió
    aprobada: ['Devolver a borrador', 'Emitir OC', 'Cancelar OC'],
  },
  autoriza: {
    nuevo: ['Aprobar', 'Eliminar', 'Editar'],                   // sin Cancelar: eso es «Cambiar estado»
    devuelto: ['Aprobar', 'Editar'],
    aprobada: ['Devolver a borrador'],                          // sin Emitir ni Cancelar
  },
  estado: {
    nuevo: ['Cancelar OC', 'Eliminar', 'Editar'],               // sin Aprobar: eso es «Autorizar»
    devuelto: ['Cancelar OC', 'Editar'],
    aprobada: ['Emitir OC', 'Cancelar OC'],                     // sin Devolver
  },
  sinEditar: {
    // «Autorizar» sin «Editar»: el servidor no cambiaría ninguna fila → no se ofrece ningún paso
    nuevo: ['Editar', 'Eliminar'],          // Editar/Eliminar dependen del permiso de la PESTAÑA (el servidor los rechaza: ver el aviso)
    devuelto: ['Editar'],
    aprobada: [],
  },
  soloGenerico: {
    // «Autorizar» genérico + «Editar» pero SIN la llave de la orden: no se ofrece Aprobar ni Devolver (el servidor lo rechazaría).
    // Editar/Eliminar dependen del permiso de la PESTAÑA, que este perfil sí tiene.
    nuevo: ['Editar', 'Eliminar'],
    devuelto: ['Editar'],
    aprobada: [],
  },
}
const INTERES = [/Aprobar/, /Cancelar OC/, /Eliminar/, /Editar/, /Devolver a borrador/, /Emitir OC/]
const ETIQUETA = (t) => INTERES.map((r) => (t.match(r) ? t.match(r)[0] : null)).find(Boolean)

const resultados = []
const ok = (cond, texto, extra = '') => {
  resultados.push({ ok: !!cond, texto, extra })
  console.log(`${cond ? '  ✓' : '  ❌'} ${texto}${extra ? ' · ' + extra : ''}`)
}

const hosts = new Map()
const bloqueadas = []
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
})

async function abrir(perfil) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
  const page = await ctx.newPage()
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    hosts.set(u.host, (hosts.get(u.host) || 0) + 1)
    if (u.host.includes('nnsqmeigtgewatameexo')) { bloqueadas.push(u.host); return route.abort() } // producción: jamás
    return route.continue()
  })
  await page.goto(BASE + '/')
  await page.getByRole('button', { name: /iniciar sesión/i }).first().click().catch(() => {})
  await page.getByPlaceholder('nombre@empresa.com').fill(PERFILES[perfil].email)
  await page.getByPlaceholder('••••••••').fill(PW)
  await page.getByRole('dialog').getByRole('button', { name: /iniciar sesión/i }).click()
  await page.getByPlaceholder('nombre@empresa.com').waitFor({ state: 'hidden', timeout: 30000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByRole('button', { name: 'Solo esenciales' }).click({ timeout: 3000 }).catch(() => {})
  await page.goto(BASE + '/condominios/ordenes_compra')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByText('Órdenes', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2000)
  return { ctx, page }
}

async function botonesDe(page, concepto) {
  const titulo = page.getByText(concepto, { exact: true }).first()
  if ((await titulo.count()) === 0) return null
  await titulo.click()
  await page.waitForTimeout(600)
  // la tarjeta = el ancestro más cercano que contiene su botón «Seguimiento» (los botones de acción viven ahí)
  const tarjeta = titulo.locator('xpath=ancestor::div[.//button[contains(normalize-space(.), "Seguimiento")]][1]')
  const textos = (await tarjeta.locator('button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  await titulo.click().catch(() => {})
  await page.waitForTimeout(300)
  return [...new Set(textos.map(ETIQUETA).filter(Boolean))].sort()
}

// ── 1 · Matriz de botones por perfil ─────────────────────────────────────────
for (const perfil of Object.keys(PERFILES)) {
  console.log(`\n▶ Perfil «${PERFILES[perfil].nombre}» (${PERFILES[perfil].email})`)
  const { ctx, page } = await abrir(perfil)
  for (const [clave, concepto] of Object.entries(ORDENES)) {
    const vistos = await botonesDe(page, concepto)
    if (vistos === null) { ok(false, `${perfil} · «${concepto}» no aparece en la lista`); continue }
    const esperados = [...ESPERADO[perfil][clave]].sort()
    ok(JSON.stringify(vistos) === JSON.stringify(esperados),
      `${perfil} · «${concepto}» ofrece exactamente [${esperados.join(', ')}]`, `vistos [${vistos.join(', ')}]`)
  }
  await page.screenshot({ path: `${OUT}matriz-${perfil}.png`, fullPage: true })
  await ctx.close()
}

// ── 2 · «Cero filas» ya no es éxito: Eliminar sin permiso de borrado ─────────
console.log('\n▶ Eliminar SIN permiso de borrado (servidor: 0 filas) debe AVISAR, no callar')
{
  const { ctx, page } = await abrir('estado')
  const concepto = 'ZZ UI borrador para borrar (sin permiso)'
  await page.getByText(concepto, { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Eliminar/ }).first().click()
  await page.getByRole('button', { name: 'Eliminar', exact: true }).last().click()
  await page.waitForTimeout(3000)
  const cuerpo = await page.locator('body').innerText()
  ok(/no aplicó el cambio/i.test(cuerpo), 'estado · el servidor no borró nada y la pantalla lo AVISA («no aplicó el cambio»)')
  ok(await page.getByText(concepto, { exact: true }).count() > 0, 'estado · la orden sigue en la lista (no se simula el borrado)')
  await page.screenshot({ path: `${OUT}eliminar-sin-permiso-aviso.png`, fullPage: true })
  await ctx.close()
}

// ── 3 · Con permiso de borrado el borrador sí se borra ──────────────────────
console.log('\n▶ Eliminar CON permiso (administrador): el borrador desaparece')
{
  const { ctx, page } = await abrir('admin')
  const concepto = 'ZZ UI borrador para borrar (admin)'
  if ((await page.getByText(concepto, { exact: true }).count()) === 0) {
    ok(true, 'admin · el borrador «para borrar (admin)» ya se había borrado en una corrida anterior')
  } else {
    await page.getByText(concepto, { exact: true }).first().click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Eliminar/ }).first().click()
    await page.getByRole('button', { name: 'Eliminar', exact: true }).last().click()
    await page.waitForTimeout(3500)
    ok(await page.getByText(concepto, { exact: true }).count() === 0, 'admin · el borrador se borró y salió de la lista')
    await page.screenshot({ path: `${OUT}eliminar-con-permiso.png`, fullPage: true })
  }
  await ctx.close()
}

console.log('\nDestino de red:', JSON.stringify([...hosts.entries()]))
console.log('Peticiones a producción bloqueadas:', bloqueadas.length)
await browser.close()
const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones de pantalla en verde`)
fs.writeFileSync(`${OUT}resultado.json`, JSON.stringify({ resultados, hosts: [...hosts.entries()], bloqueadas }, null, 1))
process.exit(fallos.length ? 1 : 0)

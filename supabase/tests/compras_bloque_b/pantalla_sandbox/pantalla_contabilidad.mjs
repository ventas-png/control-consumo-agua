// Prueba de pantalla contra el SANDBOX (jwpmivhvlstslncrtokb): Contabilidad › Compras y Contabilidad › Cuentas por pagar.
// NUNCA producción. Padrón 5b5b3000… (padron_ui_contabilidad.sql.tpl; se retira con retiro_padron_ui_contabilidad.sql).
// Ver README.md. Uso (desde la raíz del repo):
//   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npx vite --port 5198 --host 127.0.0.1      (otra terminal)
//   ZZ_UI_PW=… node supabase/tests/compras_bloque_b/pantalla_sandbox/pantalla_contabilidad.mjs
//   Por fases (el estado pasa de una a otra por ZZ_UI_SALIDA/estado.json):  FASE=1,2,3 …  (por omisión: todas, en orden)
//
// QUÉ HACE: recorre el circuito completo POR LAS PANTALLAS, cada paso con la persona que tiene SOLO esa llave, y tras cada paso
// lee el saldo de la factura y los asientos contables (con la sesión del administrador, solo para VERIFICAR; el administrador
// nunca ejecuta un paso del circuito):
//   1 creación de la orden (solicitante)            2 aprobación (aprobador) y emisión (quien cambia estado)
//   3 recepción: la crea y registra el receptor     4 factura contra la orden (solicitante) y su aprobación (aprobador)
//   5 pagos: parcial y resto, con REINTENTO tras un corte de red (se aborta la respuesta real, el servidor sí la procesó)
//   6 anulación del pago + quien no tiene la llave (botón y API directa)
//   7 doble clic en «Crear orden» y en «Marcar pagada», y «cero filas» por permiso revocado en caliente
//   8 números de factura «1-23» y «12-3» (se aceptan), «123», «FAC001» (se rechazan)
//   9 contrastes: llave sin asignación al proyecto A; permisos genéricos sin llave por acción
//  10 conciliación final: saldos, asientos (uno por pago, reverso del anulado, sin huérfanos)
// Lo que la pantalla no ofrece NO se simula en silencio: se hace por la API con la sesión de la persona y se rotula «vía API».
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const BASE = process.env.UI_BASE || 'http://127.0.0.1:5198'
const PW = process.env.ZZ_UI_PW
if (!PW) throw new Error('Falta ZZ_UI_PW (la contraseña de prueba del padrón 5b5b3000; no está en el repositorio).')
const OUT = (process.env.ZZ_UI_SALIDA || '/tmp/pantalla-contabilidad') + '/'
fs.mkdirSync(OUT, { recursive: true })
const PROD = 'nnsqmeigtgewatameexo'
const FASES_TODAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
const FASES = (process.env.FASE && process.env.FASE !== 'todas' ? process.env.FASE.split(',').map((s) => s.trim()) : FASES_TODAS)
const ESTADO_PATH = OUT + 'estado.json'
const E = fs.existsSync(ESTADO_PATH) && FASES[0] !== '1' ? JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8')) : {}
const guardarEstado = () => fs.writeFileSync(ESTADO_PATH, JSON.stringify(E, null, 1))

// ── Ids del padrón (los fija padron_ui_contabilidad.sql.tpl) ────────────────────────────────────────────────────────────────
const EMPRESA = '5b5b3000-0000-0000-0000-00000000000c'
const PROY_A = '5b5b3000-0000-0000-0000-0000000000a1'
const PERSONAS = {
  admin: { id: '5b5b3000-0000-0000-0000-0000000000f1', nombre: 'Administrador (solo prepara y verifica)' },
  solicitante: { id: '5b5b3000-0000-0000-0000-0000000000f2', nombre: 'Solicitante: crear + editar' },
  apruebaoc: { id: '5b5b3000-0000-0000-0000-0000000000f3', nombre: 'Aprueba la orden de compra: SOLO su llave' },
  emisor: { id: '5b5b3000-0000-0000-0000-0000000000f4', nombre: 'Emite / cancela la orden: cambiar estado' },
  receptor: { id: '5b5b3000-0000-0000-0000-0000000000f5', nombre: 'Registra la recepción: SOLO su llave' },
  apruebafac: { id: '5b5b3000-0000-0000-0000-0000000000f6', nombre: 'Aprueba la factura: SOLO su llave' },
  apruebaop: { id: '5b5b3000-0000-0000-0000-0000000000f7', nombre: 'Aprueba la orden de pago: SOLO su llave' },
  pagador: { id: '5b5b3000-0000-0000-0000-0000000000f8', nombre: 'Ejecuta el pago: SOLO su llave' },
  anulador: { id: '5b5b3000-0000-0000-0000-0000000000f9', nombre: 'Anula el pago: SOLO su llave' },
  sinasig: { id: '5b5b3000-0000-0000-0000-0000000000fa', nombre: 'Con las seis llaves pero SIN asignación al proyecto A' },
  genericos: { id: '5b5b3000-0000-0000-0000-0000000000fb', nombre: 'Solo approve y change_status genéricos, sin llave por acción' },
  revoca: { id: '5b5b3000-0000-0000-0000-0000000000fc', nombre: 'Anula el pago; se le revoca el permiso con la sesión abierta' },
}
const ROL_REVOCA = '5b5b3000-0000-0000-0000-0000000000d3'
const correo = (tag) => `zz-uc-${tag}@example.com`

// Textos de los documentos (únicos de esta prueba: todo empieza por «ZZ UC»)
const PROVEEDOR = 'ZZ UC Proveedor'
const CONCEPTO_OC = 'ZZ UC orden de compra principal'
const CONCEPTO_OC2 = 'ZZ UC orden de contraste'
const REMISION = 'ZZ UC REM-001'
const NUM_FACTURA_OC = 'ZZ-UC-OC-1001'
const TOTAL_OC = 1000          // 2 × 500, sin IVA
const PROYECTO_A = 'ZZ UC Proyecto A'

// ── Resultado ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const resultados = []
const hallazgos = []
const ok = (cond, texto, extra = '') => {
  resultados.push({ ok: !!cond, texto, extra })
  console.log(`${cond ? '  ✓' : '  ❌'} ${texto}${extra ? ' · ' + extra : ''}`)
  return !!cond
}
const hallazgo = (texto) => { hallazgos.push(texto); console.log(`  ⚠ HALLAZGO · ${texto}`) }
const paso = (t) => console.log(`\n▶ ${t}`)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Red: toda petición pasa por la guarda; a producción, JAMÁS ───────────────────────────────────────────────────────────────
const hosts = new Map()
const bloqueadas = []
let APIKEY = null            // la llave PÚBLICA (anon) se toma de las peticiones de la propia app; no se guarda en ningún archivo
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
})

// Avisos de la pantalla (los «toast» de `notify`): se registran TODOS dentro de la página, con su texto, para poder afirmar
// que una acción rechazada NUNCA mostró un aviso de éxito (✅) aunque el aviso dure 3,5 s.
const OBSERVADOR_AVISOS = () => {
  window.__avisos = []
  const vistos = new WeakSet()
  const escanear = () => {
    for (const li of document.querySelectorAll('li[data-swipe-direction]')) {
      if (vistos.has(li)) continue
      const t = (li.innerText || '').replace(/\s+/g, ' ').trim()
      if (!t) continue
      vistos.add(li)
      window.__avisos.push({ texto: t, exito: t.includes('✅'), t: Date.now() })
    }
  }
  new MutationObserver(escanear).observe(document, { childList: true, subtree: true, characterData: true })
}

async function guarda(route) {
  const req = route.request()
  const u = new URL(req.url())
  hosts.set(u.host, (hosts.get(u.host) || 0) + 1)
  if (u.host.includes(PROD) || req.url().includes(PROD)) { bloqueadas.push(u.host); return route.abort() }   // producción: jamás
  if (!APIKEY && u.host.endsWith('.supabase.co')) APIKEY = req.headers()['apikey'] || null
  return route.continue()
}

const sesiones = new Map()   // perfil → sessionStorage de su sesión (solo en memoria; evita reiniciar sesión en cada paso)
const consolaErrores = new Map()

async function abrir(perfil, { ledger = PROYECTO_A, tab = 'compras', vista = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
  await ctx.addInitScript(OBSERVADOR_AVISOS)
  const cache = sesiones.get(perfil)
  if (cache) {
    await ctx.addInitScript((datos) => { try { for (const [k, v] of Object.entries(datos)) sessionStorage.setItem(k, v) } catch { /* sin sesión previa */ } }, cache)
  }
  const page = await ctx.newPage()
  page.setDefaultTimeout(25000)
  await page.route('**/*', guarda)
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text().slice(0, 140)
    consolaErrores.set(t, (consolaErrores.get(t) || 0) + 1)
  })
  await page.goto(BASE + '/')
  const necesitaLogin = await page.getByRole('button', { name: /iniciar sesión/i }).first().isVisible().catch(() => false)
  if (necesitaLogin || !cache) {
    for (let intento = 1; intento <= 3; intento++) {
      await page.getByRole('button', { name: /iniciar sesión/i }).first().click().catch(() => {})
      await page.getByPlaceholder('nombre@empresa.com').fill(correo(perfil))
      await page.getByPlaceholder('••••••••').fill(PW)
      await page.getByRole('dialog').getByRole('button', { name: /iniciar sesión/i }).click()
      try {
        await page.getByPlaceholder('nombre@empresa.com').waitFor({ state: 'hidden', timeout: 30000 })
        break
      } catch (e) {
        if (intento === 3) throw new Error(`No se pudo iniciar sesión como ${perfil}: ${e.message}`)
        console.log(`  (inicio de sesión de ${perfil} sin respuesta; reintento ${intento + 1} en 20 s)`)
        await esperar(20000)
      }
    }
    await page.waitForLoadState('networkidle').catch(() => {})
    const ss = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage))).catch(() => null)
    if (ss) sesiones.set(perfil, ss)
  }
  await page.getByRole('button', { name: 'Solo esenciales' }).click({ timeout: 3000 }).catch(() => {})
  await page.goto(BASE + '/contabilidad')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByRole('tablist', { name: 'Secciones de contabilidad' }).waitFor({ timeout: 30000 })
  if (ledger) {
    const selector = page.getByLabel('Seleccionar contabilidad')
    const opciones = await selector.locator('option').allInnerTexts()
    const quiere = opciones.find((o) => o.includes(ledger))
    if (quiere) await selector.selectOption({ label: quiere })
    await page.waitForLoadState('networkidle').catch(() => {})
    await esperar(800)
  }
  const p = { ctx, page, perfil }
  if (tab) await irA(page, tab, vista)
  return p
}

async function irA(page, tab, vista = null) {
  await page.getByRole('tab', { name: tab === 'compras' ? /Compras/ : /Cuentas por pagar/ }).click()
  if (vista) await page.getByRole('radio', { name: vista }).click()
  await page.waitForLoadState('networkidle').catch(() => {})
  await esperar(1200)
}

// ── Avisos (toasts) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const nAvisos = (page) => page.evaluate(() => window.__avisos.length)
const avisosDesde = async (page, n0) => (await page.evaluate(() => window.__avisos)).slice(n0)
async function esperarAviso(page, n0, rx, ms = 20000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    const a = (await avisosDesde(page, n0)).find((x) => rx.test(x.texto))
    if (a) return a
    await esperar(200)
  }
  return null
}
const textoAvisos = (as) => as.map((a) => a.texto).join(' | ')

// ── API (para VERIFICAR y para los pasos que la pantalla no ofrece), siempre con la sesión de una persona ───────────────────────
let API = null
async function sesionDe(page) {
  const r = await page.evaluate(() => {
    for (const s of [sessionStorage, localStorage]) for (const k of Object.keys(s)) {
      const m = /^sb-(.+)-auth-token$/.exec(k)
      if (m) { try { return { ref: m[1], token: JSON.parse(s.getItem(k)).access_token } } catch { /* siguiente */ } }
    }
    return null
  })
  if (!r) throw new Error('No hay sesión de Supabase en la página.')
  if (r.ref.includes(PROD)) throw new Error('ABORTA: la sesión apunta a producción.')
  API = `https://${r.ref}.supabase.co`
  return r.token
}
async function api(page, { metodo = 'GET', ruta, cuerpo, cabeceras = {} }) {
  const token = await sesionDe(page)
  const url = `${API}/rest/v1/${ruta}`
  if (url.includes(PROD)) throw new Error('ABORTA: la petición apunta a producción.')
  return page.evaluate(async ({ url, metodo, cuerpo, cabeceras, token, apikey }) => {
    const r = await fetch(url, {
      method: metodo,
      headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...cabeceras },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    const texto = await r.text()
    let json = null
    try { json = JSON.parse(texto) } catch { /* no es JSON */ }
    return { status: r.status, json, texto }
  }, { url, metodo, cuerpo, cabeceras, token, apikey: APIKEY })
}
const mensajeApi = (r) => (r.json && (r.json.message || r.json.error)) || r.texto

let ADMIN = null    // sesión del administrador: SOLO lee para verificar (y revoca/restituye permisos en la prueba de «cero filas»)
async function admin() {
  if (!ADMIN) ADMIN = await abrir('admin', { ledger: null, tab: null })
  return ADMIN.page
}
async function leer(ruta) {
  const r = await api(await admin(), { ruta })
  if (r.status >= 300) throw new Error(`Lectura ${ruta} → ${r.status} ${r.texto.slice(0, 200)}`)
  return r.json
}
const uno = async (ruta) => (await leer(ruta))[0] ?? null
const dinero = (n) => Math.round(Number(n) * 100) / 100

async function asientosDe(tabla, id) {
  return leer(`conta_asientos?origen_tabla=eq.${tabla}&origen_id=eq.${id}&select=id,numero,origen_evento,estado,anulado_por_id,reversa_de_id,total_debe,total_haber,project_id,conta_asiento_lineas(debe,haber)&order=numero`)
}
const sumaLineas = (a, campo) => dinero((a.conta_asiento_lineas || []).reduce((s, l) => s + Number(l[campo]), 0))
const cuadra = (a) => dinero(a.total_debe) === dinero(a.total_haber) && sumaLineas(a, 'debe') === dinero(a.total_debe) && sumaLineas(a, 'haber') === dinero(a.total_haber)

// ── Pantalla: filas y botones ───────────────────────────────────────────────────────────────────────────────────────────────────
const fila = (page, texto) => page.locator('tbody tr', { hasText: texto }).first()
async function botones(row) {
  return (await row.getByRole('button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
}
const CTRL = ['Aprobar', 'Revisar y aprobar', 'Emitir', 'Cancelar', 'Devolver a borrador', 'Registrar', 'Anular', 'Marcar pagada', 'Pagar', 'Recibir']
const controles = (bs) => bs.filter((b) => CTRL.includes(b)).sort()
async function esperarFila(page, texto, ms = 20000) {
  const f = fila(page, texto)
  try { await f.waitFor({ timeout: ms }) } catch { return null }
  return f
}
async function opcionQueContiene(select, texto) {
  const opts = await select.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent || '' })))
  return opts.find((o) => o.t.includes(texto))?.v ?? null
}
async function esperarTexto(locator, rx, ms = 15000) {
  const fin = Date.now() + ms
  let t = ''
  while (Date.now() < fin) {
    t = (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    if (rx.test(t)) return t
    await esperar(250)
  }
  return null
}
const foto = (page, nombre) => page.screenshot({ path: `${OUT}${nombre}.png`, fullPage: true }).catch(() => {})
const celda = async (row, i) => (await row.locator('td').nth(i).innerText()).replace(/\s+/g, ' ').trim()

// ── Contadores de apoyo ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function facturaDe(id) { return uno(`facturas_proveedor?id=eq.${id}&select=*`) }
async function ordenesPagoDe(facturaId) { return leer(`ordenes_pago?factura_id=eq.${facturaId}&select=*&order=created_at`) }

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 1 · CREACIÓN de la orden de compra por el solicitante
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function fase1() {
  paso('FASE 1 · CREACIÓN: el solicitante crea la orden de compra en Contabilidad › Compras')
  const prov = await uno(`proveedores?nombre=eq.${encodeURIComponent(PROVEEDOR)}&select=id,estado`)
  ok(prov && prov.estado === 'autorizado', 'padrón · el proveedor «ZZ UC Proveedor» existe y está AUTORIZADO')
  E.proveedor = prov?.id

  const { ctx, page } = await abrir('solicitante', { vista: /^Órdenes de compra/ })
  const nuevo = page.getByRole('button', { name: '+ Nueva orden' })
  ok(await nuevo.count() === 1, 'solicitante · ve «+ Nueva orden» (tiene «Crear»)')
  const n0 = await nAvisos(page)
  await nuevo.click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel(/Proveedor autorizado/).selectOption({ label: PROVEEDOR })
  await dlg.getByLabel(/^Concepto/).fill(CONCEPTO_OC)
  await dlg.getByLabel('Descripción del renglón 1').fill('ZZ UC renglón de prueba')
  await dlg.getByLabel('Cantidad del renglón 1').fill('2')
  await dlg.getByLabel('Precio del renglón 1').fill('500')
  await foto(page, '1-nueva-orden-llena')
  await dlg.getByRole('button', { name: 'Crear borrador' }).click()
  const av = await esperarAviso(page, n0, /Orden creada en borrador/)
  ok(av && av.exito, 'solicitante · la pantalla avisa «Orden creada en borrador» (aviso de éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
  await esperar(1500)

  const row = await esperarFila(page, CONCEPTO_OC)
  ok(!!row, 'solicitante · la orden aparece en la lista de órdenes de compra')
  if (row) {
    const estado = await celda(row, 4)
    ok(/Borrador/i.test(estado), 'solicitante · la orden aparece como «Borrador»', estado)
    ok(/1,?000\.00/.test(await celda(row, 3)), 'solicitante · el total de la lista es 1,000.00 (2 × 500)', await celda(row, 3))
    const bs = controles(await botones(row))
    ok(!bs.includes('Aprobar') && !bs.includes('Emitir') && !bs.includes('Cancelar') && !bs.includes('Devolver a borrador'),
      'solicitante · la orden en borrador NO ofrece Aprobar / Emitir / Cancelar / Devolver (no tiene esas llaves)', `botones [${bs.join(', ')}]`)
  }
  await foto(page, '1-orden-borrador-solicitante')

  const oc = await uno(`ordenes_compra?concepto=eq.${encodeURIComponent(CONCEPTO_OC)}&select=*`)
  ok(oc && oc.estado === 'borrador', 'servidor · la orden quedó en estado «borrador»', oc?.estado)
  ok(oc && dinero(oc.total) === TOTAL_OC, 'servidor · total de la orden = 1000.00', String(oc?.total))
  ok(oc && oc.project_id === PROY_A, 'servidor · la orden es del proyecto A')
  ok(oc && oc.created_by === PERSONAS.solicitante.id, 'servidor · «created_by» es el solicitante (lo sella el servidor)', String(oc?.created_by))
  ok(oc && oc.aprobada_por === null && oc.aprobada_at === null, 'servidor · todavía sin aprobador ni fecha de aprobación')
  E.oc = oc?.id
  const ocs = await leer(`ordenes_compra?concepto=eq.${encodeURIComponent(CONCEPTO_OC)}&select=id`)
  ok(ocs.length === 1, 'servidor · exactamente UNA orden con ese concepto', String(ocs.length))
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 2 · APROBACIÓN de la orden (aprobador) y EMISIÓN (quien cambia estado)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function fase2() {
  paso('FASE 2 · APROBACIÓN (llave de la orden) y EMISIÓN (cambiar estado) de la orden de compra')
  {
    const { ctx, page } = await abrir('apruebaoc', { vista: /^Órdenes de compra/ })
    const row = await esperarFila(page, CONCEPTO_OC)
    ok(!!row, 'apruebaoc · ve la orden en borrador')
    if (!row) { await ctx.close(); return }
    const bs = controles(await botones(row))
    ok(bs.includes('Aprobar'), 'apruebaoc · SÍ ve «Aprobar» (tiene la llave de la orden + Editar)', `botones [${bs.join(', ')}]`)
    ok(!bs.includes('Emitir') && !bs.includes('Cancelar'), 'apruebaoc · NO ve Emitir ni Cancelar (no tiene «Cambiar estado»)')
    const n0 = await nAvisos(page)
    await row.getByRole('button', { name: 'Aprobar', exact: true }).click()
    const av = await esperarAviso(page, n0, /Orden aprobada/)
    ok(av && av.exito, 'apruebaoc · la pantalla avisa «Orden aprobada.» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
    await esperar(1500)
    const row2 = await esperarFila(page, CONCEPTO_OC)
    ok(row2 && /Aprobada/i.test(await celda(row2, 4)), 'apruebaoc · la lista pasa a «Aprobada»', row2 ? await celda(row2, 4) : '')
    const oc = await uno(`ordenes_compra?id=eq.${E.oc}&select=*`)
    ok(oc.estado === 'aprobada', 'servidor · estado «aprobada»', oc.estado)
    ok(oc.aprobada_por === PERSONAS.apruebaoc.id, 'servidor · «aprobada_por» es quien aprobó (lo sella el servidor)', String(oc.aprobada_por))
    ok(!!oc.aprobada_at && !!oc.numero, 'servidor · queda con fecha de aprobación y número', `${oc.numero}`)
    E.oc_numero = oc.numero
    const asientos = await asientosDe('ordenes_compra', E.oc)
    ok(asientos.length === 0, 'servidor · aprobar la orden NO genera asiento (es un compromiso, no un gasto)', String(asientos.length))
    await foto(page, '2-orden-aprobada')
    await ctx.close()
  }
  {
    const { ctx, page } = await abrir('emisor', { vista: /^Órdenes de compra/ })
    const row = await esperarFila(page, CONCEPTO_OC)
    const bs = row ? controles(await botones(row)) : []
    ok(bs.includes('Emitir') && bs.includes('Cancelar'), 'emisor · ve «Emitir» y «Cancelar» (cambiar estado + editar)', `botones [${bs.join(', ')}]`)
    ok(!bs.includes('Aprobar') && !bs.includes('Devolver a borrador'), 'emisor · NO ve Aprobar ni Devolver a borrador (no tiene la llave de la orden)')
    const n0 = await nAvisos(page)
    await row.getByRole('button', { name: 'Emitir', exact: true }).click()
    const av = await esperarAviso(page, n0, /Orden emitida al proveedor/)
    ok(av && av.exito, 'emisor · la pantalla avisa «Orden emitida al proveedor.» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
    await esperar(1500)
    const oc = await uno(`ordenes_compra?id=eq.${E.oc}&select=*`)
    ok(oc.estado === 'emitida', 'servidor · estado «emitida»', oc.estado)
    ok(oc.aprobada_por === PERSONAS.apruebaoc.id, 'servidor · la emisión no cambió al aprobador')
    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 3 · RECEPCIÓN: la crea y registra el receptor; el solicitante no la puede registrar
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function fase3() {
  paso('FASE 3 · RECEPCIÓN: la crea y la registra el receptor (llave «Registrar una recepción»)')
  {
    const { ctx, page } = await abrir('receptor', { vista: /^Órdenes de compra/ })
    const row = await esperarFila(page, CONCEPTO_OC)
    const bs = row ? controles(await botones(row)) : []
    ok(bs.includes('Recibir'), 'receptor · la orden emitida ofrece «Recibir»', `botones [${bs.join(', ')}]`)
    ok(!bs.includes('Aprobar') && !bs.includes('Emitir') && !bs.includes('Cancelar'), 'receptor · NO ve Aprobar / Emitir / Cancelar la orden')
    await row.getByRole('button', { name: 'Recibir', exact: true }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Envío / remisión del proveedor').fill(REMISION)
    const n0 = await nAvisos(page)
    await foto(page, '3-recibir-modal')
    await dlg.getByRole('button', { name: 'Crear recepción' }).click()
    const av = await esperarAviso(page, n0, /Recepción creada en borrador/)
    ok(av && av.exito, 'receptor · la pantalla avisa «Recepción creada en borrador» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
    await esperar(1000)
    const rec = await uno(`recepciones?documento_referencia=eq.${encodeURIComponent(REMISION)}&select=*`)
    ok(rec && rec.estado === 'borrador', 'servidor · la recepción nace en «borrador»', rec?.estado)
    E.recepcion = rec?.id
    const antes = await asientosDe('recepciones', E.recepcion)
    ok(antes.length === 0, 'servidor · un borrador de recepción no genera asiento', String(antes.length))
    await ctx.close()
  }
  {
    const { ctx, page } = await abrir('solicitante', { vista: /^Recepciones/ })
    const row = await esperarFila(page, REMISION)
    ok(!!row, 'solicitante · ve la recepción en borrador')
    const bs = row ? controles(await botones(row)) : []
    ok(!bs.includes('Registrar') && !bs.includes('Anular'), 'solicitante · NO ve «Registrar» ni «Anular» la recepción (no tiene la llave)', `botones [${bs.join(', ')}]`)
    const r = await api(page, { metodo: 'PATCH', ruta: `recepciones?id=eq.${E.recepcion}`, cuerpo: { estado: 'registrada' }, cabeceras: { Prefer: 'return=representation' } })
    ok(r.status >= 400 && /COMPRAS_PERMISO_ACCION/.test(mensajeApi(r)), 'solicitante · vía API (PATCH a recepciones) recibe COMPRAS_PERMISO_ACCION', `${r.status} ${String(mensajeApi(r)).slice(0, 170)}`)
    const rec = await uno(`recepciones?id=eq.${E.recepcion}&select=estado`)
    ok(rec.estado === 'borrador', 'servidor · la recepción sigue en «borrador» tras el intento del solicitante', rec.estado)
    await ctx.close()
  }
  {
    const { ctx, page } = await abrir('receptor', { vista: /^Recepciones/ })
    const row = await esperarFila(page, REMISION)
    const bs = row ? controles(await botones(row)) : []
    ok(bs.includes('Registrar'), 'receptor · SÍ ve «Registrar» la recepción', `botones [${bs.join(', ')}]`)
    ok(!bs.includes('Anular'), 'receptor · NO ve «Anular» (anular una recepción es «Cambiar estado»)')
    const n0 = await nAvisos(page)
    await row.getByRole('button', { name: 'Registrar', exact: true }).click()
    const conf = page.getByRole('alertdialog')
    await conf.getByRole('button', { name: 'Registrar', exact: true }).click()
    const av = await esperarAviso(page, n0, /Recepción registrada y contabilizada/)
    ok(av && av.exito, 'receptor · la pantalla avisa «Recepción registrada y contabilizada.» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
    await esperar(1500)
    const row2 = await esperarFila(page, REMISION)
    ok(row2 && /Registrada/i.test(await celda(row2, 4)), 'receptor · la lista pasa a «Registrada»', row2 ? await celda(row2, 4) : '')
    const rec = await uno(`recepciones?id=eq.${E.recepcion}&select=*`)
    ok(rec.estado === 'registrada' && !!rec.registrada_at, 'servidor · recepción «registrada» con fecha de registro', rec.estado)
    const oc = await uno(`ordenes_compra?id=eq.${E.oc}&select=estado`)
    ok(oc.estado === 'recibida', 'servidor · la orden pasó a «recibida» (se recibió todo)', oc.estado)
    const as = await asientosDe('recepciones', E.recepcion)
    ok(as.length === 1 && as[0].estado === 'publicado' && as[0].origen_evento === 'recepcion_registrada' && cuadra(as[0]) && dinero(as[0].total_debe) === TOTAL_OC,
      'servidor · UN asiento publicado «recepcion_registrada» por 1000.00, debe = haber', as.map((a) => `${a.origen_evento}/${a.estado}/${a.total_debe}/${a.total_haber}`).join(';'))
    await foto(page, '3-recepcion-registrada')
    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 4 · FACTURA contra la orden (solicitante) y APROBACIÓN (aprobador de facturas)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function fase4() {
  paso('FASE 4 · FACTURA contra la orden y su aprobación (Cuentas por pagar)')
  {
    const { ctx, page } = await abrir('solicitante', { tab: 'cxp', vista: /^Facturas/ })
    const n0 = await nAvisos(page)
    await page.getByRole('button', { name: '+ Registrar factura' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel(/^Proveedor/).selectOption({ label: PROVEEDOR })
    const sel = dlg.getByLabel('Orden de compra a facturar')
    await sel.waitFor()
    const v = await opcionQueContiene(sel, CONCEPTO_OC)
    ok(!!v, 'solicitante · la orden recibida aparece para facturar en el selector «Orden de compra a facturar»')
    await sel.selectOption(v)
    await dlg.getByLabel('No. de factura').fill(NUM_FACTURA_OC)
    await dlg.getByText('Total de la factura:').waitFor()
    const totalForm = await esperarTexto(dlg.getByText('Total de la factura:'), /1,?000\.00/)
    ok(!!totalForm, 'solicitante · el formulario calcula el total de la factura por renglón (una vez cargados los renglones): 1,000.00', totalForm || '')
    await foto(page, '4-factura-contra-orden')
    await dlg.getByRole('button', { name: 'Registrar', exact: true }).click()
    const av = await esperarAviso(page, n0, /Registrada/)
    ok(av && av.exito && /contra la orden/.test(av.texto), 'solicitante · la pantalla avisa «Factura registrada contra la orden» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
    await esperar(1500)
    const row = await esperarFila(page, NUM_FACTURA_OC)
    ok(!!row, 'solicitante · la factura aparece en la lista')
    if (row) {
      ok(/Registrada/i.test(await celda(row, 6)), 'solicitante · estado «Registrada»', await celda(row, 6))
      const bs = controles(await botones(row))
      ok(!bs.includes('Revisar y aprobar') && !bs.includes('Aprobar'), 'solicitante · NO ve «Revisar y aprobar» (no tiene la llave de la factura)', `botones [${bs.join(', ')}]`)
    }
    const f = await uno(`facturas_proveedor?numero_factura=eq.${NUM_FACTURA_OC}&select=*`)
    E.factura = f?.id
    ok(f && f.estado === 'registrada' && dinero(f.monto_total) === TOTAL_OC && f.orden_compra_id === E.oc && f.project_id === PROY_A,
      'servidor · factura «registrada» por 1000.00, ligada a la orden y al proyecto A', f ? `${f.estado} ${f.monto_total}` : '')
    const as = await asientosDe('facturas_proveedor', E.factura)
    ok(as.length === 0, 'servidor · una factura registrada todavía no genera asiento', String(as.length))
    // vía API: el solicitante no puede aprobarla aunque lo intente
    const r = await api(page, { metodo: 'PATCH', ruta: `facturas_proveedor?id=eq.${E.factura}`, cuerpo: { estado: 'aprobada' }, cabeceras: { Prefer: 'return=representation' } })
    ok(r.status >= 400 && /COMPRAS_PERMISO_ACCION/.test(mensajeApi(r)), 'solicitante · vía API (PATCH a facturas_proveedor) recibe COMPRAS_PERMISO_ACCION', `${r.status} ${String(mensajeApi(r)).slice(0, 170)}`)
    ok((await facturaDe(E.factura)).estado === 'registrada', 'servidor · la factura sigue «registrada» tras el intento del solicitante')
    await ctx.close()
  }
  {
    const { ctx, page } = await abrir('apruebafac', { tab: 'cxp', vista: /^Facturas/ })
    const row = await esperarFila(page, NUM_FACTURA_OC)
    const bs = row ? controles(await botones(row)) : []
    ok(bs.includes('Revisar y aprobar'), 'apruebafac · SÍ ve «Revisar y aprobar» (tiene su llave + Editar)', `botones [${bs.join(', ')}]`)
    ok(!bs.includes('Pagar'), 'apruebafac · NO ve «Pagar» en una factura registrada (solo se paga lo aprobado)')
    await row.getByRole('button', { name: 'Revisar y aprobar', exact: true }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByText('Cuadra', { exact: true }).first().waitFor({ timeout: 25000 })
    ok(await dlg.getByText('Cuadra', { exact: true }).count() >= 1, 'apruebafac · el cuadre de 3 vías muestra «Cuadra» (pedido = recibido = facturado)')
    await foto(page, '4-cuadre')
    const n0 = await nAvisos(page)
    await dlg.getByRole('button', { name: 'Aprobar', exact: true }).click()
    const av = await esperarAviso(page, n0, /Factura aprobada y devengada/)
    ok(av && av.exito, 'apruebafac · la pantalla avisa «Factura aprobada y devengada…» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
    await esperar(1500)
    const row2 = await esperarFila(page, NUM_FACTURA_OC)
    ok(row2 && /Aprobada/i.test(await celda(row2, 6)), 'apruebafac · la lista pasa a «Aprobada»', row2 ? await celda(row2, 6) : '')
    ok(row2 && /1,?000\.00/.test(await celda(row2, 5)), 'apruebafac · el saldo de la lista es 1,000.00 (= total)', row2 ? await celda(row2, 5) : '')
    const f = await facturaDe(E.factura)
    ok(f.estado === 'aprobada' && dinero(f.monto_pagado) === 0 && dinero(f.monto_total) === TOTAL_OC, 'servidor · factura «aprobada», monto_pagado 0, saldo pendiente = total (1000.00)', `${f.estado} pagado=${f.monto_pagado}`)
    ok(f.aprobada_por === PERSONAS.apruebafac.id && !!f.aprobada_at, 'servidor · «aprobada_por» es quien aprobó (lo sella el servidor)', String(f.aprobada_por))
    const as = await asientosDe('facturas_proveedor', E.factura)
    ok(as.length === 1 && as[0].estado === 'publicado' && as[0].origen_evento === 'factura_prov_aprobada' && cuadra(as[0]) && dinero(as[0].total_debe) === TOTAL_OC,
      'servidor · UN asiento publicado «factura_prov_aprobada» (devengo) por 1000.00, debe = haber', as.map((a) => `${a.origen_evento}/${a.estado}/${a.total_debe}/${a.total_haber}`).join(';'))
    await foto(page, '4-factura-aprobada')
    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Ayudas de las órdenes de pago
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Abre «Pagar» en la factura y deja el formulario lleno. */
async function abrirPagar(page, { monto, referencia }) {
  const row = await esperarFila(page, NUM_FACTURA_OC)
  if (!row) throw new Error('No aparece la factura de la orden en Cuentas por pagar.')
  await row.getByRole('button', { name: 'Pagar', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByText('Nueva orden de pago').first().waitFor()
  await dlg.getByLabel(/^Monto/).fill(String(monto))
  await dlg.getByLabel('Referencia').fill(referencia)
  return dlg
}
/** La fila de la orden de pago con esa referencia (se filtra con el buscador, que mira la referencia). */
async function filaOrdenPago(page, referencia) {
  await page.getByPlaceholder('Buscar orden…').fill(referencia)
  await esperar(900)
  return esperarFila(page, 'ZZ UC Proveedor')
}
const ordenPorReferencia = (ref) => uno(`ordenes_pago?referencia=eq.${encodeURIComponent(ref)}&select=*`)
const ordenesPorReferencia = (ref) => leer(`ordenes_pago?referencia=eq.${encodeURIComponent(ref)}&select=*`)

/**
 * Crea una orden de pago por la pantalla con un CORTE DE RED real: la primera petición POST llega al servidor y se procesa, pero su
 * respuesta se aborta (la pantalla ve «Failed to fetch»). Luego se vuelve a pulsar «Crear orden» en el MISMO formulario (misma clave de
 * idempotencia). Lo esperado: el servidor tiene UNA sola orden y la pantalla termina en éxito sin errores confusos.
 */
async function crearOrdenPagoConCorte(page, { monto, referencia, etiqueta }) {
  let interceptadas = 0
  let corte = null
  await page.route(/\/rest\/v1\/ordenes_pago(\?|$)/, async (route) => {
    if (route.request().method() === 'POST' && interceptadas === 0) {
      interceptadas++
      const r = await route.fetch()                         // la petición LLEGA al servidor y se procesa…
      corte = { status: r.status() }
      await route.abort('connectionreset')                   // …pero la pantalla no recibe la respuesta
      return
    }
    return route.fallback()
  })
  const dlg = await abrirPagar(page, { monto, referencia })
  const n0 = await nAvisos(page)
  await dlg.getByRole('button', { name: 'Crear orden' }).click()
  await esperar(4000)
  const tras1 = await avisosDesde(page, n0)
  ok(interceptadas === 1 && corte?.status === 201, `${etiqueta} · red: la petición POST llegó al servidor (201) y su respuesta se abortó`, JSON.stringify(corte))
  ok(!tras1.some((a) => a.exito), `${etiqueta} · pantalla: tras el corte NO muestra aviso de éxito`, textoAvisos(tras1))
  ok(tras1.some((a) => !a.exito && /Error/.test(a.texto)), `${etiqueta} · pantalla: tras el corte muestra un aviso de ERROR (no sabe si se guardó)`, textoAvisos(tras1))
  ok(await page.getByRole('dialog').getByText('Nueva orden de pago').first().isVisible(), `${etiqueta} · pantalla: el formulario sigue abierto para reintentar`)
  const durante = await ordenesPorReferencia(referencia)
  ok(durante.length === 1 && durante[0].estado === 'borrador' && dinero(durante[0].monto) === monto, `${etiqueta} · servidor: la orden SÍ se creó (1 fila, borrador, ${monto}.00) aunque la pantalla vio un error`, `${durante.length} fila(s)`)
  // reintento: se vuelve a pulsar «Crear orden» en el MISMO formulario (misma clave de idempotencia)
  const n1 = await nAvisos(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Crear orden' }).click()
  await esperar(5000)
  const tras2 = await avisosDesde(page, n1)
  const exito = tras2.some((a) => a.exito && /Orden de pago creada en borrador/.test(a.texto))
  const error = tras2.filter((a) => !a.exito)
  ok(exito, `${etiqueta} · pantalla: el REINTENTO termina con aviso de éxito (la orden ya existía: se devuelve la misma)`, textoAvisos(tras2))
  ok(error.length === 0, `${etiqueta} · pantalla: el reintento NO muestra ningún error confuso`, textoAvisos(error))
  if (!exito && error.some((a) => /COMPRAS_PAGO_EXCEDE_SALDO/.test(a.texto))) {
    hallazgo(`${etiqueta}: el REINTENTO de la creación tras perder la respuesta muestra «COMPRAS_PAGO_EXCEDE_SALDO… ya hay ${monto}.00 reservado en otras órdenes» aunque esa «otra orden» es LA MISMA que se acaba de crear (misma clave de idempotencia). La pantalla solo recupera la orden previa cuando el servidor contesta con el choque del índice único (uq_ordenes_pago_clave); con el saldo TOTAL el control de saldo del trigger se dispara antes y la pantalla no busca la orden por su clave. El formulario se queda con un error que no se puede resolver reintentando. No hay doble pago: el servidor no crea una segunda orden. Ver src/domain/cxp/mutations.ts (useCrearOrdenPagoMutation) y VER-09c, que prevé justo esa recuperación «por su clave».`)
  }
  const despues = await ordenesPorReferencia(referencia)
  ok(despues.length === 1 && despues[0].id === durante[0]?.id, `${etiqueta} · servidor: sigue habiendo UNA sola orden de pago (la misma id) tras el reintento`, `${despues.length} fila(s)`)
  ok(!!despues[0]?.clave_idempotencia, `${etiqueta} · servidor: la orden guarda su clave de idempotencia`)
  await foto(page, `5-reintento-creacion-${referencia}`)
  if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click().catch(() => {})
  return despues[0] ?? null
}

async function aprobarOrdenPago(referencia) {
  const { ctx, page } = await abrir('apruebaop', { tab: 'cxp', vista: /^Órdenes de pago/ })
  const row = await filaOrdenPago(page, referencia)
  const bs = row ? controles(await botones(row)) : []
  ok(bs.includes('Aprobar') && !bs.includes('Marcar pagada') && !bs.includes('Anular'), `apruebaop · [${referencia}] ve «Aprobar» y NO «Marcar pagada» ni «Anular»`, `botones [${bs.join(', ')}]`)
  const n0 = await nAvisos(page)
  await row.getByRole('button', { name: 'Aprobar', exact: true }).click()
  const av = await esperarAviso(page, n0, /Orden aprobada/)
  ok(av && av.exito, `apruebaop · [${referencia}] la pantalla avisa «Orden aprobada.» (éxito)`, av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
  await esperar(1500)
  const op = await ordenPorReferencia(referencia)
  ok(op.estado === 'aprobada' && op.aprobada_por === PERSONAS.apruebaop.id && !!op.aprobada_at, `servidor · [${referencia}] orden «aprobada» por quien la aprobó (sellado por el servidor)`, `${op.estado} ${op.aprobada_por}`)
  ok(dinero((await facturaDe(E.factura)).monto_pagado) === E.pagado, `servidor · [${referencia}] aprobar la orden NO mueve el saldo de la factura`, `pagado=${(await facturaDe(E.factura)).monto_pagado}`)
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 5 · PAGOS: parcial (400) y resto (600), este con REINTENTO tras un corte de red
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const REF1 = 'ZZ-UC-PAGO-1'
const REF2 = 'ZZ-UC-PAGO-2'
async function fase5() {
  paso('FASE 5 · ÓRDENES DE PAGO: pago parcial (400) y resto (600) con reintento tras un corte de red')
  E.pagado = 0
  // ── 5a · pago parcial de 400 (CABE en el saldo de 1000): el solicitante lo crea con un corte de red y reintenta ──
  {
    const { ctx, page } = await abrir('solicitante', { tab: 'cxp', vista: /^Facturas/ })
    paso('FASE 5a · REINTENTO con pago PARCIAL (400 de 1000): se aborta la RESPUESTA de la creación (el servidor ya la procesó)')
    const op = await crearOrdenPagoConCorte(page, { monto: 400, referencia: REF1, etiqueta: 'pago 1 (parcial, cabe en el saldo)' })
    E.op1 = op?.id
    await irA(page, 'cxp', /^Órdenes de pago/)
    const row = await filaOrdenPago(page, REF1)
    ok(!!row && /Borrador/i.test(await celda(row, 5)), 'solicitante · la orden de pago aparece como «Borrador»', row ? await celda(row, 5) : '')
    const bs = row ? controles(await botones(row)) : []
    ok(!bs.includes('Aprobar') && !bs.includes('Marcar pagada') && !bs.includes('Anular'), 'solicitante · la orden de pago NO ofrece Aprobar / Marcar pagada / Anular', `botones [${bs.join(', ')}]`)
    const o = await ordenPorReferencia(REF1)
    ok(o && o.estado === 'borrador' && dinero(o.monto) === 400 && o.factura_id === E.factura && o.solicitada_por === PERSONAS.solicitante.id,
      'servidor · orden de pago «borrador» por 400.00, de la factura, solicitada por el solicitante', o ? `${o.estado} ${o.monto}` : '')
    ok(dinero((await facturaDe(E.factura)).monto_pagado) === 0, 'servidor · el saldo de la factura sigue intacto (monto_pagado 0)')
    await ctx.close()
  }
  await aprobarOrdenPago(REF1)
  {
    const { ctx, page } = await abrir('pagador', { tab: 'cxp', vista: /^Órdenes de pago/ })
    const row = await filaOrdenPago(page, REF1)
    const bs = row ? controles(await botones(row)) : []
    ok(bs.includes('Marcar pagada') && !bs.includes('Aprobar') && !bs.includes('Anular'), 'pagador · ve «Marcar pagada» y NO «Aprobar» ni «Anular»', `botones [${bs.join(', ')}]`)
    const n0 = await nAvisos(page)
    await row.getByRole('button', { name: 'Marcar pagada', exact: true }).click()
    const av = await esperarAviso(page, n0, /Orden pagada/)
    ok(av && av.exito, 'pagador · la pantalla avisa «Orden pagada: asiento generado y saldo…» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
    await esperar(1500)
    const op = await ordenPorReferencia(REF1)
    ok(op.estado === 'pagada' && !!op.pagada_at, 'servidor · orden de pago 1 «pagada»', op.estado)
    const f = await facturaDe(E.factura)
    ok(f.estado === 'pagada_parcial' && dinero(f.monto_pagado) === 400, 'servidor · la factura pasa a «pagada_parcial» con monto_pagado 400.00 (saldo 600.00)', `${f.estado} pagado=${f.monto_pagado}`)
    E.pagado = 400
    const as = await asientosDe('ordenes_pago', E.op1)
    ok(as.length === 1 && as[0].estado === 'publicado' && as[0].origen_evento === 'orden_pago_pagada' && cuadra(as[0]) && dinero(as[0].total_debe) === 400,
      'servidor · UN asiento publicado «orden_pago_pagada» por 400.00, debe = haber', as.map((a) => `${a.origen_evento}/${a.estado}/${a.total_debe}/${a.total_haber}`).join(';'))
    await irA(page, 'cxp', /^Facturas/)
    const frow = await esperarFila(page, NUM_FACTURA_OC)
    ok(frow && /Pagada parcial|parcial/i.test(await celda(frow, 6)) && /600\.00/.test(await celda(frow, 5)), 'pagador · la lista de facturas muestra «pagada parcial» y saldo 600.00', frow ? `${await celda(frow, 6)} / ${await celda(frow, 5)}` : '')
    await foto(page, '5-pago-parcial')
    await ctx.close()
  }

  // ── 5b · el resto (600 = TODO el saldo, lo que la pantalla propone por omisión) con el mismo corte de red ──
  paso('FASE 5b · REINTENTO con el SALDO TOTAL (600 de 600): se aborta la RESPUESTA de la creación (el servidor ya la procesó)')
  {
    const { ctx, page } = await abrir('solicitante', { tab: 'cxp', vista: /^Facturas/ })
    const op = await crearOrdenPagoConCorte(page, { monto: 600, referencia: REF2, etiqueta: 'pago 2 (resto = saldo total)' })
    E.op2 = op?.id
    const todas = await ordenesPagoDe(E.factura)
    ok(todas.length === 2, 'servidor · la factura tiene exactamente 2 órdenes de pago (la 1 y la 2), ninguna duplicada', String(todas.length))
    ok(dinero((await facturaDe(E.factura)).monto_pagado) === 400, 'servidor · el saldo no cambió con una orden en borrador (monto_pagado 400.00)')
    await ctx.close()
  }
  await aprobarOrdenPago(REF2)
  paso('FASE 5c · REINTENTO: se aborta la RESPUESTA de «Marcar pagada» (el servidor ya pagó)')
  {
    const { ctx, page } = await abrir('pagador', { tab: 'cxp', vista: /^Órdenes de pago/ })
    let interceptadas = 0
    await page.route(/\/rest\/v1\/ordenes_pago(\?|$)/, async (route) => {
      if (route.request().method() === 'PATCH' && interceptadas === 0) {
        interceptadas++
        const r = await route.fetch()
        E.corte_pagar = { status: r.status() }
        await route.abort('connectionreset')
        return
      }
      return route.fallback()
    })
    const row = await filaOrdenPago(page, REF2)
    const n0 = await nAvisos(page)
    await row.getByRole('button', { name: 'Marcar pagada', exact: true }).click()
    await esperar(4000)
    const tras1 = await avisosDesde(page, n0)
    ok(interceptadas === 1 && (E.corte_pagar?.status === 200 || E.corte_pagar?.status === 204), 'red · el PATCH llegó al servidor y su respuesta se abortó', JSON.stringify(E.corte_pagar))
    ok(!tras1.some((a) => a.exito), 'pantalla · tras el corte NO muestra aviso de éxito', textoAvisos(tras1))
    ok(tras1.some((a) => !a.exito && /Error/.test(a.texto)), 'pantalla · tras el corte muestra un aviso de ERROR', textoAvisos(tras1))
    const op = await ordenPorReferencia(REF2)
    ok(op.estado === 'pagada', 'servidor · la orden SÍ quedó «pagada» aunque la pantalla vio un error', op.estado)
    // reintento con la misma pantalla (la lista no se refrescó porque la mutación falló: el botón sigue ahí)
    const row2 = await filaOrdenPago(page, REF2)
    const bsAntes = row2 ? controles(await botones(row2)) : []
    ok(bsAntes.includes('Marcar pagada'), 'pantalla · tras el corte el botón «Marcar pagada» sigue ofrecido (la pantalla no se enteró)', `botones [${bsAntes.join(', ')}]`)
    const n1 = await nAvisos(page)
    if (bsAntes.includes('Marcar pagada')) await row2.getByRole('button', { name: 'Marcar pagada', exact: true }).click()
    await esperar(5000)
    const tras2 = await avisosDesde(page, n1)
    console.log(`    (aviso del reintento de pago: ${textoAvisos(tras2) || 'ninguno'})`)
    const exitoFalso = tras2.some((a) => a.exito)
    const asientos = await asientosDe('ordenes_pago', E.op2)
    const f = await facturaDe(E.factura)
    ok(asientos.length === 1 && asientos[0].estado === 'publicado' && dinero(asientos[0].total_debe) === 600 && cuadra(asientos[0]),
      'servidor · tras el reintento hay UN SOLO asiento «orden_pago_pagada» por 600.00', asientos.map((a) => `${a.origen_evento}/${a.estado}/${a.total_debe}`).join(';'))
    ok(f.estado === 'pagada' && dinero(f.monto_pagado) === 1000, 'servidor · la factura queda «pagada» con monto_pagado 1000.00 (400 + 600, no se contó dos veces)', `${f.estado} pagado=${f.monto_pagado}`)
    E.pagado = 1000
    ok(tras2.length > 0, 'pantalla · el reintento muestra ALGÚN aviso (no se queda callada)', textoAvisos(tras2))
    if (exitoFalso) {
      // Un aviso de éxito en el reintento es VERDADERO si el servidor devolvió la fila (el estado «pagada» ya estaba). Se afirma contra el servidor.
      ok(op.estado === 'pagada' && asientos.length === 1, 'pantalla · el aviso de éxito del reintento no es falso: la orden está pagada y hay un solo asiento', textoAvisos(tras2))
    } else {
      ok(!tras2.some((a) => !a.exito && /COMPRAS_|duplicate|violates/i.test(a.texto)), 'pantalla · el error del reintento no es un código técnico confuso', textoAvisos(tras2))
    }
    await foto(page, '5-reintento-pago')
    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 6 · ANULACIÓN del pago 1 (la hace quien tiene «Anular un pago»)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function fase6() {
  paso('FASE 6 · ANULACIÓN: quien no tiene la llave no ve el botón y la API le dice COMPRAS_PERMISO_ACCION; quien la tiene anula')
  // Quien NO tiene la llave: botón ausente + API directa rechazada
  for (const quien of ['solicitante', 'pagador', 'genericos']) {
    const { ctx, page } = await abrir(quien, { tab: 'cxp', vista: /^Órdenes de pago/ })
    const row = await filaOrdenPago(page, REF1)
    const bs = row ? controles(await botones(row)) : []
    ok(!!row && !bs.includes('Anular'), `${quien} · NO ve el botón «Anular» en la orden de pago pagada`, `botones [${bs.join(', ')}]`)
    const r = await api(page, { metodo: 'PATCH', ruta: `ordenes_pago?id=eq.${E.op1}`, cuerpo: { estado: 'anulada' }, cabeceras: { Prefer: 'return=representation' } })
    ok(r.status >= 400 && /COMPRAS_PERMISO_ACCION/.test(mensajeApi(r)) && /Anular un pago/.test(mensajeApi(r)),
      `${quien} · vía API (PATCH a ordenes_pago → anulada) recibe COMPRAS_PERMISO_ACCION que nombra «Anular un pago»`, `${r.status} ${String(mensajeApi(r)).slice(0, 190)}`)
    await ctx.close()
  }
  const op0 = await ordenPorReferencia(REF1)
  const f0 = await facturaDe(E.factura)
  ok(op0.estado === 'pagada' && dinero(f0.monto_pagado) === 1000 && f0.estado === 'pagada', 'servidor · tras los intentos sin llave NADA cambió: orden 1 «pagada», factura «pagada» con 1000.00', `${op0.estado}/${f0.estado}/${f0.monto_pagado}`)
  const asAntes = await asientosDe('ordenes_pago', E.op1)
  ok(asAntes.length === 1 && asAntes[0].anulado_por_id === null, 'servidor · el asiento del pago 1 sigue sin reverso', String(asAntes.length))

  // Quien SÍ la tiene
  const { ctx, page } = await abrir('anulador', { tab: 'cxp', vista: /^Órdenes de pago/ })
  const row = await filaOrdenPago(page, REF1)
  const bs = row ? controles(await botones(row)) : []
  ok(bs.includes('Anular') && !bs.includes('Aprobar') && !bs.includes('Marcar pagada'), 'anulador · SÍ ve «Anular» y NO ve Aprobar ni Marcar pagada', `botones [${bs.join(', ')}]`)
  const n0 = await nAvisos(page)
  await row.getByRole('button', { name: 'Anular', exact: true }).click()
  const conf = page.getByRole('alertdialog')
  await conf.getByText('Se reversará el asiento y se restará el pago de la factura.').waitFor()
  await foto(page, '6-confirmar-anulacion')
  await conf.getByRole('button', { name: 'Anular', exact: true }).click()
  const av = await esperarAviso(page, n0, /Orden anulada/)
  ok(av && av.exito, 'anulador · la pantalla avisa «Orden anulada.» (éxito)', av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
  await esperar(1800)
  const row2 = await filaOrdenPago(page, REF1)
  ok(row2 && /Anulada/i.test(await celda(row2, 5)), 'anulador · la lista pasa a «Anulada»', row2 ? await celda(row2, 5) : '')
  const op = await ordenPorReferencia(REF1)
  ok(op.estado === 'anulada', 'servidor · orden de pago 1 «anulada»', op.estado)
  const f = await facturaDe(E.factura)
  ok(dinero(f.monto_pagado) === 600 && f.estado === 'pagada_parcial', 'servidor · el saldo de la factura SE RESTITUYE: monto_pagado 600.00, «pagada_parcial» (saldo 400.00)', `${f.estado} pagado=${f.monto_pagado}`)
  E.pagado = 600
  const as = await asientosDe('ordenes_pago', E.op1)
  const original = as.find((a) => a.origen_evento === 'orden_pago_pagada')
  const reverso = as.find((a) => a.origen_evento === 'orden_pago_pagada_revertido')
  ok(as.length === 2 && !!original && !!reverso, 'servidor · el pago 1 tiene exactamente DOS asientos: el original y su reverso', as.map((a) => a.origen_evento).join(','))
  ok(original && reverso && original.anulado_por_id === reverso.id && reverso.reversa_de_id === original.id,
    'servidor · el original queda marcado «anulado_por_id» → el reverso, y el reverso apunta «reversa_de_id» → el original')
  ok(reverso && reverso.estado === 'publicado' && cuadra(reverso) && dinero(reverso.total_debe) === 400, 'servidor · el reverso está PUBLICADO por 400.00 con debe = haber', reverso ? `${reverso.estado}/${reverso.total_debe}/${reverso.total_haber}` : '')
  if (original && reverso) {
    const netoDebe = dinero(sumaLineas(original, 'debe') - sumaLineas(reverso, 'haber'))
    const netoHaber = dinero(sumaLineas(original, 'haber') - sumaLineas(reverso, 'debe'))
    ok(netoDebe === 0 && netoHaber === 0, 'servidor · el efecto neto del original y su reverso es CERO en cada lado', `${netoDebe}/${netoHaber}`)
  }
  const as2 = await asientosDe('ordenes_pago', E.op2)
  ok(as2.length === 1 && as2[0].anulado_por_id === null && as2[0].estado === 'publicado', 'servidor · el asiento del pago 2 NO se tocó (sigue publicado y sin reverso)')
  await foto(page, '6-pago-anulado')
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 7 · DOBLE CLIC y CERO FILAS por permiso revocado en caliente
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const REF3 = 'ZZ-UC-PAGO-3'

/**
 * «genericos» (approve + change_status + crear + editar, asignado a A, SIN llave por acción) frente a la orden de pago 3
 * mientras está en borrador (no la ve aprobable) o aprobada (no la ve pagable ni anulable): botón ausente y API rechazada.
 */
async function contrasteGenericosOrdenPago(estadoActual) {
  const { ctx, page } = await abrir('genericos', { tab: 'cxp', vista: /^Órdenes de pago/ })
  const row = await filaOrdenPago(page, REF3)
  const bs = row ? controles(await botones(row)) : []
  ok(!!row && !bs.includes('Aprobar') && !bs.includes('Marcar pagada') && !bs.includes('Anular'),
    `genericos · la orden de pago 3 (${estadoActual}) NO ofrece Aprobar / Marcar pagada / Anular`, `botones [${bs.join(', ')}]`)
  const destinos = estadoActual === 'borrador' ? ['aprobada', 'anulada'] : ['pagada', 'anulada']
  for (const estado of destinos) {
    const r = await api(page, { metodo: 'PATCH', ruta: `ordenes_pago?id=eq.${E.op3}`, cuerpo: { estado }, cabeceras: { Prefer: 'return=representation' } })
    ok(r.status >= 400 && /COMPRAS_PERMISO_ACCION/.test(mensajeApi(r)), `genericos · vía API (PATCH a ordenes_pago ${estadoActual} → ${estado}) recibe COMPRAS_PERMISO_ACCION`, `${r.status} ${String(mensajeApi(r)).slice(0, 150)}`)
  }
  ok((await ordenPorReferencia(REF3)).estado === estadoActual, `servidor · la orden de pago 3 sigue «${estadoActual}» tras los intentos de «genericos»`)
  await ctx.close()
}
async function fase7() {
  paso('FASE 7 · DOBLE CLIC rápido en «Crear orden» y en «Marcar pagada»; «cero filas» al revocar un permiso con la sesión abierta')
  // 7a · doble clic en «Crear orden» (saldo 400 tras la anulación)
  {
    const { ctx, page } = await abrir('solicitante', { tab: 'cxp', vista: /^Facturas/ })
    const frow = await esperarFila(page, NUM_FACTURA_OC)
    ok(frow && /400\.00/.test(await celda(frow, 5)), 'solicitante · tras la anulación la factura vuelve a mostrar saldo 400.00', frow ? await celda(frow, 5) : '')
    const dlg = await abrirPagar(page, { monto: 400, referencia: REF3 })
    const n0 = await nAvisos(page)
    await dlg.getByRole('button', { name: 'Crear orden' }).dblclick()
    await esperar(5000)
    const as = await avisosDesde(page, n0)
    console.log(`    (avisos tras el doble clic: ${textoAvisos(as)})`)
    const ops = await ordenesPorReferencia(REF3)
    ok(ops.length === 1, 'servidor · el doble clic en «Crear orden» dejó UNA sola orden de pago', `${ops.length} fila(s)`)
    ok(!as.some((a) => !a.exito), 'pantalla · el doble clic no muestra ningún error', textoAvisos(as))
    ok(as.some((a) => a.exito), 'pantalla · el doble clic termina con aviso de éxito', textoAvisos(as))
    E.op3 = ops[0]?.id
    const todas = await ordenesPagoDe(E.factura)
    ok(todas.length === 3, 'servidor · la factura tiene 3 órdenes de pago en total (1 anulada, 1 pagada, 1 nueva)', String(todas.length))
    await ctx.close()
  }
  await contrasteGenericosOrdenPago('borrador')
  await aprobarOrdenPago(REF3)
  await contrasteGenericosOrdenPago('aprobada')
  // 7b · «cero filas»: se le revoca «Editar» a quien anula, con su sesión abierta, y pulsa «Anular»
  paso('FASE 7b · CERO FILAS: a quien tiene el botón «Anular» visible se le revoca «Editar» (y luego su llave) con la sesión abierta')
  {
    const { ctx, page } = await abrir('revoca', { tab: 'cxp', vista: /^Órdenes de pago/ })
    const row = await filaOrdenPago(page, REF3)
    const bs = row ? controles(await botones(row)) : []
    ok(bs.includes('Anular'), 'revoca · antes de la revocación ve «Anular» en la orden de pago 3 (aprobada)', `botones [${bs.join(', ')}]`)
    const adm = await admin()
    const del = await api(adm, { metodo: 'DELETE', ruta: `role_permissions?role_id=eq.${ROL_REVOCA}&permission_key=eq.platform.contabilidad.edit`, cabeceras: { Prefer: 'return=representation' } })
    ok(del.status < 300 && Array.isArray(del.json) && del.json.length === 1, 'admin · (preparación, vía API del editor de roles) quita «Editar» al rol de «revoca»', `${del.status} ${del.json?.length}`)
    const n0 = await nAvisos(page)
    await row.getByRole('button', { name: 'Anular', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Anular', exact: true }).click()
    await esperar(4500)
    const as = await avisosDesde(page, n0)
    ok(!as.some((a) => a.exito), 'pantalla · el servidor NO cambió ninguna fila y la pantalla NO muestra aviso de éxito', textoAvisos(as))
    ok(as.some((a) => !a.exito && /no aplicó el cambio/i.test(a.texto)), 'pantalla · AVISA «El servidor no aplicó el cambio…» (cero filas ≠ éxito)', textoAvisos(as))
    let op = await ordenPorReferencia(REF3)
    ok(op.estado === 'aprobada', 'servidor · la orden de pago 3 sigue «aprobada» (no se anuló)', op.estado)
    await foto(page, '7-cero-filas-sin-editar')
    // se restituye «Editar» y se quita la llave de la acción: ahora el servidor la rechaza con error de permiso
    const ins = await api(adm, { metodo: 'POST', ruta: 'role_permissions', cuerpo: { role_id: ROL_REVOCA, permission_key: 'platform.contabilidad.edit', effect: 'allow' }, cabeceras: { Prefer: 'return=representation' } })
    ok(ins.status < 300, 'admin · (preparación) restituye «Editar»', `${ins.status}`)
    const del2 = await api(adm, { metodo: 'DELETE', ruta: `role_permissions?role_id=eq.${ROL_REVOCA}&permission_key=eq.platform.contabilidad.compras.pago_anular`, cabeceras: { Prefer: 'return=representation' } })
    ok(del2.status < 300 && del2.json?.length === 1, 'admin · (preparación) quita la llave «Anular un pago»', `${del2.status} ${del2.json?.length}`)
    const row2 = await filaOrdenPago(page, REF3)
    const n1 = await nAvisos(page)
    await row2.getByRole('button', { name: 'Anular', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Anular', exact: true }).click()
    await esperar(4500)
    const as2 = await avisosDesde(page, n1)
    ok(!as2.some((a) => a.exito), 'pantalla · rechazada por permiso: NO hay aviso de éxito', textoAvisos(as2))
    ok(as2.some((a) => !a.exito && /Anular un pago/.test(a.texto)), 'pantalla · muestra el rechazo del servidor que nombra el permiso «Anular un pago»', textoAvisos(as2))
    op = await ordenPorReferencia(REF3)
    ok(op.estado === 'aprobada', 'servidor · la orden de pago 3 sigue «aprobada»', op.estado)
    await foto(page, '7-rechazo-sin-llave')
    await ctx.close()
  }
  // 7c · doble clic en «Marcar pagada»
  {
    const { ctx, page } = await abrir('pagador', { tab: 'cxp', vista: /^Órdenes de pago/ })
    const row = await filaOrdenPago(page, REF3)
    const n0 = await nAvisos(page)
    await row.getByRole('button', { name: 'Marcar pagada', exact: true }).dblclick()
    await esperar(5500)
    const as = await avisosDesde(page, n0)
    console.log(`    (avisos tras el doble clic en Marcar pagada: ${textoAvisos(as)})`)
    const op = await ordenPorReferencia(REF3)
    const asientos = await asientosDe('ordenes_pago', E.op3)
    const f = await facturaDe(E.factura)
    ok(op.estado === 'pagada', 'servidor · la orden de pago 3 quedó «pagada»', op.estado)
    ok(asientos.length === 1 && asientos[0].estado === 'publicado' && dinero(asientos[0].total_debe) === 400 && cuadra(asientos[0]),
      'servidor · el doble clic dejó UN SOLO asiento «orden_pago_pagada» por 400.00', asientos.map((a) => `${a.origen_evento}/${a.estado}/${a.total_debe}`).join(';'))
    ok(f.estado === 'pagada' && dinero(f.monto_pagado) === 1000, 'servidor · el doble clic NO contó el pago dos veces: factura «pagada», monto_pagado 1000.00', `${f.estado} pagado=${f.monto_pagado}`)
    E.pagado = 1000
    ok(as.some((a) => a.exito), 'pantalla · aparece el aviso de éxito del pago', textoAvisos(as))
    const errores = as.filter((a) => !a.exito)
    ok(errores.length === 0, 'pantalla · el segundo clic NO deja un error confuso junto al éxito', textoAvisos(errores))
    await foto(page, '7-doble-clic-pagar')
    await ctx.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 8 · NÚMEROS DE FACTURA en pantalla
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function registrarFacturaSimple(page, numero, concepto) {
  await page.getByRole('button', { name: '+ Registrar factura' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel(/^Proveedor/).selectOption({ label: PROVEEDOR })
  await dlg.getByLabel('No. de factura').fill(numero)
  await dlg.getByLabel(/^Concepto/).fill(concepto)
  await dlg.getByLabel(/^Monto total/).fill('100')
  const n0 = await nAvisos(page)
  await dlg.getByRole('button', { name: 'Registrar', exact: true }).click()
  return n0
}
async function fase8() {
  paso('FASE 8 · NÚMEROS DE FACTURA: «1-23» y «12-3» se aceptan; «123» y «FAC001» (con «FAC-001» ya registrada) se rechazan')
  const { ctx, page } = await abrir('solicitante', { tab: 'cxp', vista: /^Facturas/ })
  const casos = [
    { numero: '1-23', acepta: true }, { numero: '12-3', acepta: true }, { numero: '123', acepta: false },
    { numero: 'FAC-001', acepta: true }, { numero: 'FAC001', acepta: false },
  ]
  for (const c of casos) {
    const concepto = `ZZ UC factura número ${c.numero}`
    const n0 = await registrarFacturaSimple(page, c.numero, concepto)
    if (c.acepta) {
      const av = await esperarAviso(page, n0, /Registrada/)
      ok(av && av.exito, `número «${c.numero}» · se ACEPTA: aviso «Registrada» (éxito)`, av ? av.texto : textoAvisos(await avisosDesde(page, n0)))
      await esperar(1200)
      ok(await page.getByRole('dialog').count() === 0, `número «${c.numero}» · el formulario se cierra`)
    } else {
      const av = await esperarAviso(page, n0, /COMPRAS_FACTURA_NUMERO_DUPLICADO|duplicad|equivalente/i)
      ok(av && !av.exito, `número «${c.numero}» · se RECHAZA con el aviso de número duplicado (error, no éxito)`, av ? av.texto.slice(0, 330) : textoAvisos(await avisosDesde(page, n0)))
      ok(av && /separador entre serie y correlativo/.test(av.texto), `número «${c.numero}» · el aviso explica cómo escribir el número (serie y correlativo)`)
      const hubo = (await avisosDesde(page, n0)).some((a) => a.exito)
      ok(!hubo, `número «${c.numero}» · no hay aviso de éxito`)
      ok(await page.getByRole('dialog').count() === 1, `número «${c.numero}» · el formulario sigue abierto para corregir el número`)
      await foto(page, `8-numero-rechazado-${c.numero.replace(/[^A-Za-z0-9]/g, '')}`)
      await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
      await esperar(400)
    }
  }
  await esperar(1200)
  const facs = await leer(`facturas_proveedor?proveedor_id=eq.${E.proveedor}&select=id,numero_factura,estado,monto_total&order=created_at`)
  const nums = facs.map((f) => f.numero_factura)
  for (const n of ['1-23', '12-3', 'FAC-001']) ok(nums.filter((x) => x === n).length === 1, `servidor · existe UNA factura «${n}»`)
  for (const n of ['123', 'FAC001']) ok(!nums.includes(n), `servidor · NO existe ninguna factura «${n}» (se rechazó)`)
  E.facturas_numeros = Object.fromEntries(facs.filter((f) => ['1-23', '12-3', 'FAC-001'].includes(f.numero_factura)).map((f) => [f.numero_factura, f.id]))
  await ctx.close()
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 9 · CONTRASTES: llave sin asignación al proyecto A; permisos genéricos sin llave por acción
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function fase9() {
  paso('FASE 9 · CONTRASTES')
  // Una orden de compra en borrador y una aprobada del proyecto A, para probar botones y API
  {
    const { ctx, page } = await abrir('solicitante', { vista: /^Órdenes de compra/ })
    const n0 = await nAvisos(page)
    await page.getByRole('button', { name: '+ Nueva orden' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel(/Proveedor autorizado/).selectOption({ label: PROVEEDOR })
    await dlg.getByLabel(/^Concepto/).fill(CONCEPTO_OC2)
    await dlg.getByLabel('Descripción del renglón 1').fill('ZZ UC renglón de contraste')
    await dlg.getByLabel('Precio del renglón 1').fill('100')
    await dlg.getByRole('button', { name: 'Crear borrador' }).click()
    const av = await esperarAviso(page, n0, /Orden creada en borrador/)
    ok(av && av.exito, 'solicitante · crea la orden de contraste en borrador (éxito)')
    await esperar(1200)
    E.oc2 = (await uno(`ordenes_compra?concepto=eq.${encodeURIComponent(CONCEPTO_OC2)}&select=id`))?.id
    await ctx.close()
  }

  // 9a · genéricos (approve + change_status + crear + editar, ASIGNADO a A) sin ninguna llave por acción
  paso('FASE 9a · GENÉRICOS: approve y change_status de siempre, sin llave por acción')
  {
    const { ctx, page } = await abrir('genericos', { vista: /^Órdenes de compra/ })
    const row = await esperarFila(page, CONCEPTO_OC2)
    const bs = row ? controles(await botones(row)) : []
    ok(!!row && !bs.includes('Aprobar'), 'genericos · NO ve «Aprobar» la orden de compra en borrador (el approve genérico ya no basta)', `botones [${bs.join(', ')}]`)
    ok(bs.includes('Cancelar'), 'genericos · SÍ ve «Cancelar» (eso sigue siendo «Cambiar estado»)', `botones [${bs.join(', ')}]`)
    const r1 = await api(page, { metodo: 'PATCH', ruta: `ordenes_compra?id=eq.${E.oc2}`, cuerpo: { estado: 'aprobada' }, cabeceras: { Prefer: 'return=representation' } })
    ok(r1.status >= 400 && /COMPRAS_PERMISO_ACCION/.test(mensajeApi(r1)), 'genericos · vía API (PATCH a ordenes_compra → aprobada) recibe COMPRAS_PERMISO_ACCION', `${r1.status} ${String(mensajeApi(r1)).slice(0, 170)}`)
    await irA(page, 'cxp', /^Facturas/)
    const fnum = await esperarFila(page, 'ZZ UC factura número 1-23')
    const fb = fnum ? controles(await botones(fnum)) : []
    ok(!!fnum && !fb.includes('Aprobar') && !fb.includes('Revisar y aprobar'), 'genericos · NO ve «Aprobar» la factura registrada', `botones [${fb.join(', ')}]`)
    const r2 = await api(page, { metodo: 'PATCH', ruta: `facturas_proveedor?id=eq.${E.facturas_numeros['1-23']}`, cuerpo: { estado: 'aprobada' }, cabeceras: { Prefer: 'return=representation' } })
    ok(r2.status >= 400 && /COMPRAS_PERMISO_ACCION/.test(mensajeApi(r2)), 'genericos · vía API (PATCH a facturas_proveedor → aprobada) recibe COMPRAS_PERMISO_ACCION', `${r2.status} ${String(mensajeApi(r2)).slice(0, 170)}`)
    await irA(page, 'cxp', /^Órdenes de pago/)
    const orow = await filaOrdenPago(page, REF3)
    const ob = orow ? controles(await botones(orow)) : []
    ok(!!orow && !ob.includes('Aprobar') && !ob.includes('Marcar pagada') && !ob.includes('Anular'), 'genericos · NO ve Aprobar / Marcar pagada / Anular en la orden de pago', `botones [${ob.join(', ')}]`)
    const r3 = await api(page, { metodo: 'PATCH', ruta: `ordenes_pago?id=eq.${E.op1}`, cuerpo: { estado: 'anulada' }, cabeceras: { Prefer: 'return=representation' } })
    ok(r3.status >= 400, 'genericos · vía API (PATCH a ordenes_pago ya anulada → anulada) tampoco pasa (no hay éxito falso)', `${r3.status} ${String(mensajeApi(r3)).slice(0, 150)}`)
    ok((await ordenPorReferencia(REF3)).estado === 'pagada' && (await uno(`ordenes_compra?id=eq.${E.oc2}&select=estado`)).estado === 'borrador'
      && (await facturaDe(E.facturas_numeros['1-23'])).estado === 'registrada', 'servidor · los intentos de «genericos» no cambiaron nada (orden de pago, orden de compra y factura iguales)')
    await ctx.close()
  }

  // 9b · llave SIN asignación al proyecto A
  paso('FASE 9b · SIN ASIGNACIÓN AL PROYECTO A: tiene las seis llaves, pero solo está asignada al proyecto B')
  {
    const { ctx, page } = await abrir('sinasig', { ledger: null, tab: 'cxp', vista: /^Facturas/ })
    const opciones = await page.getByLabel('Seleccionar contabilidad').locator('option').allInnerTexts()
    ok(!opciones.some((o) => o.includes(PROYECTO_A)), 'sinasig · el selector de contabilidad NO ofrece el proyecto A', opciones.join(' | '))
    const hay = await page.locator('tbody tr', { hasText: NUM_FACTURA_OC }).count()
    ok(hay === 0, 'sinasig · la lista de facturas NO muestra la factura del proyecto A (no hay botón que pulsar)', `${hay} fila(s)`)
    await irA(page, 'cxp', /^Órdenes de pago/)
    ok(await page.locator('tbody tr', { hasText: 'ZZ UC Proveedor' }).count() === 0, 'sinasig · la lista de órdenes de pago NO muestra las del proyecto A')
    await foto(page, '9-sinasig-lista-vacia')
    const adm = await admin()
    const prueba = [
      ['ordenes_pago', E.op3, { estado: 'anulada' }], ['ordenes_pago', E.op3, { estado: 'aprobada' }],
      ['facturas_proveedor', E.facturas_numeros['1-23'], { estado: 'aprobada' }],
      ['ordenes_compra', E.oc2, { estado: 'aprobada' }],
    ]
    for (const [tabla, id, cuerpo] of prueba) {
      const r = await api(page, { metodo: 'PATCH', ruta: `${tabla}?id=eq.${id}`, cuerpo, cabeceras: { Prefer: 'return=representation' } })
      const rechazo = (r.status >= 400 && /COMPRAS_ALCANCE_PROYECTO|COMPRAS_PERMISO_ACCION/.test(mensajeApi(r))) || (r.status < 300 && Array.isArray(r.json) && r.json.length === 0)
      ok(rechazo, `sinasig · vía API (PATCH a ${tabla} → ${cuerpo.estado}) no cambia nada: ${r.status < 300 ? '0 filas (no ve la fila)' : mensajeApi(r).split(':')[0]}`, `${r.status} ${String(r.texto).slice(0, 150)}`)
    }
    // Sin filtro por columna: la política de SELECT no entra en juego y es el servidor quien decide (alcance de proyecto)
    const fuerte = await api(page, { metodo: 'PATCH', ruta: `ordenes_pago?company_id=eq.${EMPRESA}`, cuerpo: { estado: 'anulada' }, cabeceras: { Prefer: 'return=representation' } })
    console.log(`    (PATCH amplio por company_id de sinasig → ${fuerte.status} ${String(fuerte.texto).slice(0, 200)})`)
    ok(fuerte.status >= 400 ? /COMPRAS_ALCANCE_PROYECTO/.test(mensajeApi(fuerte)) : (Array.isArray(fuerte.json) && fuerte.json.length === 0),
      'sinasig · un PATCH amplio (por empresa) no anula nada: error COMPRAS_ALCANCE_PROYECTO o 0 filas', `${fuerte.status} ${String(fuerte.texto).slice(0, 150)}`)
    // Sondeo informativo: ¿puede quien no está asignada al proyecto A CREAR una orden de compra en borrador en ese proyecto?
    const intruso = await api(page, { metodo: 'POST', ruta: 'ordenes_compra', cuerpo: { company_id: EMPRESA, project_id: PROY_A, proveedor_id: E.proveedor, proveedor_nombre: PROVEEDOR, concepto: 'ZZ UC intruso sin asignación' }, cabeceras: { Prefer: 'return=representation' } })
    if (intruso.status < 300) {
      E.intruso = Array.isArray(intruso.json) ? intruso.json[0]?.id : null
      hallazgo('SONDEO · quien NO está asignada al proyecto A pudo CREAR por API una orden de compra en borrador en ese proyecto (la creación no exige asignación; las seis decisiones sí). Ver informe.')
      ok(true, 'sinasig · sondeo informativo: la creación de un BORRADOR en el proyecto A por API fue aceptada (se anota como observación)', `${intruso.status}`)
    } else {
      ok(/COMPRAS_ALCANCE_PROYECTO|COMPRAS_PERMISO_ACCION/.test(mensajeApi(intruso)), 'sinasig · vía API no puede crear una orden de compra en el proyecto A (rechazada por alcance/permiso)', `${intruso.status} ${String(mensajeApi(intruso)).slice(0, 170)}`)
    }
    const dentro = await api(adm, { ruta: `ordenes_pago?factura_id=eq.${E.factura}&select=referencia,estado&order=created_at` })
    ok(JSON.stringify(dentro.json.map((o) => o.estado)) === JSON.stringify(['anulada', 'pagada', 'pagada']),
      'servidor · tras los intentos de «sinasig» las órdenes de pago siguen: anulada, pagada, pagada', JSON.stringify(dentro.json))
    ok((await uno(`ordenes_compra?id=eq.${E.oc2}&select=estado`)).estado === 'borrador', 'servidor · la orden de contraste sigue en borrador')
    await ctx.close()
  }
  // El resto del circuito de la orden de contraste no se sigue: queda en borrador (no genera asiento)
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FASE 10 · CONCILIACIÓN FINAL
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function fase10() {
  paso('FASE 10 · CONCILIACIÓN FINAL: saldo de la factura, asientos y huérfanos')
  const f = await facturaDe(E.factura)
  const ops = await ordenesPagoDe(E.factura)
  const pagadas = ops.filter((o) => o.estado === 'pagada')
  const sumaPagadas = dinero(pagadas.reduce((s, o) => s + Number(o.monto), 0))
  ok(dinero(f.monto_pagado) === sumaPagadas && sumaPagadas === 1000 && f.estado === 'pagada', 'factura · monto_pagado = suma de las órdenes pagadas vivas = 1000.00 y estado «pagada»', `${f.estado} pagado=${f.monto_pagado} suma=${sumaPagadas}`)
  const asientos = await leer(`conta_asientos?company_id=eq.${EMPRESA}&select=id,origen_tabla,origen_id,origen_evento,estado,anulado_por_id,reversa_de_id,total_debe,total_haber,project_id,conta_asiento_lineas(debe,haber)&order=numero`)
  ok(asientos.length > 0 && asientos.every((a) => a.estado === 'publicado'), 'asientos · todos los asientos de la empresa de prueba están «publicado»', `${asientos.length} asientos`)
  ok(asientos.every(cuadra), 'asientos · TODOS cuadran: total_debe = total_haber = suma de sus líneas')
  const porEvento = {}
  for (const a of asientos) porEvento[a.origen_evento] = (porEvento[a.origen_evento] || 0) + 1
  console.log('    asientos por evento:', JSON.stringify(porEvento))
  ok(asientos.length === 6, 'asientos · la empresa tiene exactamente SEIS asientos: recepción, devengo, tres pagos y un reverso', String(asientos.length))
  const pagos = asientos.filter((a) => a.origen_evento === 'orden_pago_pagada')
  ok(pagos.length === 3, 'asientos · hay exactamente TRES asientos «orden_pago_pagada» (uno por pago, ninguno duplicado)', String(pagos.length))
  const vivos = pagos.filter((a) => a.anulado_por_id === null)
  ok(vivos.length === 2 && vivos.every((a) => pagadas.some((o) => o.id === a.origen_id)), 'asientos · los pagos vivos (2) corresponden uno a uno a las órdenes «pagada»')
  const reversos = asientos.filter((a) => a.origen_evento === 'orden_pago_pagada_revertido')
  ok(reversos.length === 1 && reversos[0].origen_id === E.op1 && reversos[0].reversa_de_id === pagos.find((a) => a.origen_id === E.op1)?.id, 'asientos · hay UN reverso, del pago anulado')
  const idsOrdenes = new Set(ops.map((o) => o.id))
  const huerfanos = asientos.filter((a) => a.origen_tabla === 'ordenes_pago' && !idsOrdenes.has(a.origen_id))
  ok(huerfanos.length === 0, 'asientos · ninguno huérfano: todo asiento de pago nace de una orden de pago que existe', String(huerfanos.length))
  const sinLineas = asientos.filter((a) => !(a.conta_asiento_lineas || []).length)
  ok(sinLineas.length === 0, 'asientos · ninguno sin líneas')
  const devengo = asientos.filter((a) => a.origen_evento === 'factura_prov_aprobada')
  ok(devengo.length === 1 && devengo[0].origen_id === E.factura, 'asientos · UN devengo de factura (la de la orden); las facturas de «números» no se aprobaron y no generan asiento', String(devengo.length))
  const sinAprobar = await leer(`facturas_proveedor?proveedor_id=eq.${E.proveedor}&estado=eq.registrada&select=numero_factura`)
  ok(sinAprobar.length === 3, 'facturas · las tres facturas de números legítimos siguen «registrada»', sinAprobar.map((x) => x.numero_factura).join(','))
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const TABLA = { 1: fase1, 2: fase2, 3: fase3, 4: fase4, 5: fase5, 6: fase6, 7: fase7, 8: fase8, 9: fase9, 10: fase10 }
let abortada = null
for (const n of FASES) {
  if (!TABLA[n]) { console.log(`(fase «${n}» desconocida; se omite)`); continue }
  try {
    await TABLA[n]()
  } catch (e) {
    abortada = `FASE ${n}: ${e.message}`
    ok(false, `la fase ${n} se interrumpió`, e.message.split('\n')[0])
    console.log(e.stack?.split('\n').slice(0, 6).join('\n'))
    break
  } finally {
    guardarEstado()
  }
}
if (ADMIN) await ADMIN.ctx.close().catch(() => {})

console.log('\nDestino de red:', JSON.stringify([...hosts.entries()]))
console.log('Peticiones a producción bloqueadas:', bloqueadas.length)
const consolaOrdenada = [...consolaErrores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
console.log('Errores de consola del navegador (los más repetidos):', JSON.stringify(consolaOrdenada))
await browser.close()
const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones de pantalla en verde${abortada ? ` (interrumpida: ${abortada})` : ''}`)
if (fallos.length) console.log('FALLAN:\n' + fallos.map((f) => `  - ${f.texto} · ${f.extra}`).join('\n'))
fs.writeFileSync(`${OUT}resultado.json`, JSON.stringify({
  fases: FASES, total: resultados.length, ok: resultados.length - fallos.length, fallo: fallos.length, abortada,
  resultados, hallazgos, hosts: [...hosts.entries()], bloqueadas, consola: consolaOrdenada,
}, null, 1))
process.exit(fallos.length || abortada ? 1 : 0)

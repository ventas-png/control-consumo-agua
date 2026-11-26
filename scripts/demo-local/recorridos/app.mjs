// Utilidades para recorrer la app LOCAL con Playwright: entrar con un usuario demo, ir a una pestaña,
// fotografiar y anotar cada paso.
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(new URL('../../../package.json', import.meta.url))
const { chromium } = require('playwright')

export const APP = 'http://127.0.0.1:5173'
export const FOTOS = join(import.meta.dirname, '..', 'fotos')
mkdirSync(FOTOS, { recursive: true })
const clave = readFileSync(join(import.meta.dirname, '..', '.credenciales'), 'utf8').match(/clave: (.+)/)[1].trim()

// Fechas como las escribe la app («jue 26 nov»), en la zona de la empresa demo.
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date()).split('-').map(Number)
export const HOY = new Date(y, m - 1, d, 12)
export const MES = MESES[m - 1]
export const etiqueta = (f) => `${DIAS[f.getDay()].slice(0, 3)} ${f.getDate()} ${MESES[f.getMonth()].slice(0, 3).toLowerCase()}`
/** El día hábil (lunes a viernes) más cercano después de `desde`. */
export function habilSiguiente(desde = HOY) {
  const f = new Date(desde); do f.setDate(f.getDate() + 1); while (f.getDay() === 0 || f.getDay() === 6); return f
}
export function habilAnterior(desde = HOY) {
  const f = new Date(desde); do f.setDate(f.getDate() - 1); while (f.getDay() === 0 || f.getDay() === 6); return f
}

export const pasos = []
export function paso(ok, texto) { pasos.push({ ok, texto }); console.log(`${ok ? 'OK ' : 'MAL'}  ${texto}`) }

export async function abrir(usuario, { ancho = 1440, alto = 900 } = {}) {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, timezoneId: 'America/Guatemala', locale: 'es-GT' })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('at-cookie-consent-v1', JSON.stringify({ analytics: false, functional: false, v: 1, ts: new Date().toISOString() })) } catch { /* */ }
  })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', e => errores.push('excepción: ' + String(e).slice(0, 300)))
  page.on('response', r => {
    const u = r.url()
    if (r.status() >= 400 && u.includes('54321') && !u.includes('/auth/v1/health') && !u.includes('realtime')) {
      errores.push(`${r.status()} ${r.request().method()} ${u.replace('http://127.0.0.1:54321', '').slice(0, 160)}`)
    }
  })
  await page.goto(APP + '/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.getByRole('button', { name: 'Iniciar sesión' }).first().click()
  await page.locator('input[type="email"]').first().fill(`${usuario}@demo.local`)
  await page.locator('input[type="password"]').first().fill(clave)
  await page.locator('input[type="password"]').first().press('Enter')
  await page.waitForURL(u => !u.toString().endsWith(':5173/'), { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)
  // El aviso de cookies tapa la esquina: se acepta lo esencial si aparece.
  const cookies = page.getByRole('button', { name: 'Solo esenciales' })
  if (await cookies.isVisible().catch(() => false)) await cookies.click()
  return { nav, page, errores }
}

export async function ir(page, ruta) {
  await page.goto(APP + ruta, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1500)
  const cookies = page.getByRole('button', { name: 'Solo esenciales' })
  if (await cookies.isVisible().catch(() => false)) await cookies.click()
}

export async function foto(page, nombre, opciones = {}) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(FOTOS, `${nombre}.png`), ...opciones })
}

/** Acepta el diálogo de confirmación del sistema con el texto de su botón. */
export async function confirmar(page, texto) {
  const b = page.getByRole('button', { name: texto, exact: true }).last()
  await b.waitFor({ timeout: 8000 })
  await b.click()
}

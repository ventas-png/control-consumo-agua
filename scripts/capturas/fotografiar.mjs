// Fotografía los HTML que volcó `*.captura.tsx` con los estilos y las fuentes del sistema.
//   node scripts/capturas/fotografiar.mjs [carpeta]   (por defecto scripts/capturas/salida)
// Deja cada PNG en <carpeta>/png, a 2x, con el ancho que pidió la escena.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const RAIZ = resolve(import.meta.dirname, '../..')
const OUT = resolve(process.argv[2] ?? process.env.CAPTURAS_OUT ?? join(RAIZ, 'scripts/capturas/salida'))
mkdirSync(join(OUT, 'png'), { recursive: true })

const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
// /index.css = el CSS del sistema más sus fuentes; /fonts/* = public/fonts; el resto, la carpeta de salida.
const servidor = createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let archivo
  if (ruta === '/index.css') {
    const css = readFileSync(join(RAIZ, 'public/fonts/fonts.css'), 'utf8') + '\n' + readFileSync(join(RAIZ, 'src/index.css'), 'utf8')
    res.writeHead(200, { 'content-type': 'text/css' }); res.end(css); return
  }
  if (ruta.startsWith('/fonts/')) archivo = join(RAIZ, 'public', ruta)
  else archivo = join(OUT, ruta)
  if (!existsSync(archivo)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' })
  res.end(readFileSync(archivo))
})
await new Promise(r => servidor.listen(0, '127.0.0.1', r))
const puerto = servidor.address().port

// El proyecto fija su propia versión de Playwright: se usa el Chromium del sistema si existe.
const navegador = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {})
const solo = process.env.CAPTURAS_SOLO
for (const html of readdirSync(join(OUT, 'html')).filter(f => f.endsWith('.html')).sort()) {
  if (solo && !html.includes(solo)) continue
  const fuente = readFileSync(join(OUT, 'html', html), 'utf8')
  const ancho = Number(/data-ancho="(\d+)"/.exec(fuente)?.[1] ?? 1280)
  const alto = Number(/data-alto="(\d+)"/.exec(fuente)?.[1] ?? 0)
  const pagina = await navegador.newPage({ viewport: { width: ancho, height: alto || 900 }, deviceScaleFactor: 2 })
  await pagina.goto(`http://127.0.0.1:${puerto}/html/${html}`)
  await pagina.evaluate(() => document.fonts.ready)
  // Las ventanas (position: fixed) ocupan la vista: se fotografía la vista; lo demás, la página hasta `alto`.
  const conVentana = await pagina.evaluate(() => [...document.querySelectorAll('body *')].some(e => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().width > 300))
  // Hasta donde termina el contenido (más un margen), no el alto de la ventana.
  const total = await pagina.evaluate(() => Math.ceil(document.getElementById('cap').getBoundingClientRect().bottom) + 16)
  const png = join(OUT, 'png', html.replace('.html', '.png'))
  if (conVentana) await pagina.screenshot({ path: png })
  else await pagina.screenshot({ path: png, clip: { x: 0, y: 0, width: ancho, height: alto ? Math.min(alto, total) : total } })
  console.log(`${html.replace('.html', '.png')}  ${ancho}×${alto ? Math.min(alto, total) : total}${conVentana ? ' (ventana)' : ''}`)
  await pagina.close()
}
await navegador.close()
servidor.close()

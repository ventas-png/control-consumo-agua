// Pre-render estático de las páginas legales. Corre DESPUÉS de `vite build` (ver el script
// "build" en package.json). Toma dist/index.html (ya con sus <script>/<link> + hashes SRI)
// como plantilla, renderiza el contenido legal en español a HTML con esbuild + React SSR, y
// escribe dist/<ruta>/index.html para cada documento. Vercel sirve esos ficheros del sistema
// de archivos ANTES del rewrite SPA (igual que /robots.txt), así que la URL limpia
// /politica-privacidad entrega HTML completo a crawlers/auditorías; el SPA hidrata después.
//
// Resiliente por diseño: cualquier fallo se registra y sale con código 0 para NO romper el
// build/despliegue — el pre-render es una mejora, no un requisito (el SPA sigue funcionando).

import { build } from 'esbuild'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const BASE_URL = 'https://administratodo.com'

async function main() {
  const templatePath = join(DIST, 'index.html')
  const template = await readFile(templatePath, 'utf8').catch(() => null)
  if (!template) {
    console.warn('[prerender] dist/index.html no encontrado — ¿se corrió `vite build`? Omitiendo.')
    return
  }

  // 1. Bundle del entry SSR (esbuild). React queda externo → lo resuelve Node desde node_modules.
  const bundlePath = join(ROOT, 'node_modules/.cache/at-prerender/entry.mjs')
  await build({
    entryPoints: [join(ROOT, 'src/legal/prerenderEntry.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    outfile: bundlePath,
    logLevel: 'silent',
    // Vite reemplaza import.meta.env en su build; esbuild no. Lo neutralizamos a {} para que
    // cualquier módulo que lo lea a nivel de import (p.ej. analytics) devuelva undefined en
    // vez de romper el SSR. Defensa por si el grafo crece; el contenido legal no usa env.
    define: { 'import.meta.env': '{}' },
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
    // Los assets que importan los componentes (CSS/imágenes/fuentes) no afectan al HTML SSR.
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.woff2': 'empty', '.woff': 'empty' },
  })

  const { renderLegal, PRERENDER_DOCS } = await import(pathToFileURL(bundlePath).href)

  // 2. Una página estática por documento (solo ES: versión indexable/vinculante).
  let count = 0
  for (const { doc, path } of PRERENDER_DOCS) {
    const { html, title, description } = renderLegal(doc, 'es')
    const canonical = `${BASE_URL}/${path}`
    const headExtras =
      `\n    <link rel="canonical" href="${canonical}" />` +
      `\n    <link rel="alternate" hreflang="es" href="${canonical}" />` +
      `\n    <link rel="alternate" hreflang="en" href="${canonical}?lang=en" />` +
      `\n    <link rel="alternate" hreflang="x-default" href="${canonical}" />`

    let page = template
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeAttr(description)}" />`)
      .replace('</head>', `${headExtras}\n  </head>`)
      .replace('<div id="root"></div>', `<div id="root">${html}</div>`)

    const outDir = join(DIST, path)
    await mkdir(outDir, { recursive: true })
    await writeFile(join(outDir, 'index.html'), page, 'utf8')
    count++
    console.log(`[prerender] dist/${path}/index.html (${(page.length / 1024).toFixed(1)} kB)`)
  }

  await rm(dirname(bundlePath), { recursive: true, force: true }).catch(() => {})
  console.log(`[prerender] OK — ${count} páginas legales pre-renderizadas.`)
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

main().catch((e) => {
  console.warn('[prerender] omitido (no fatal):', e?.message || e)
  process.exit(0)
})

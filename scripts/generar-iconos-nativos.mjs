// Íconos y splash de la app nativa (iOS y Android), más los gráficos de la ficha de
// Google Play y el ícono de pantalla de inicio de la web instalada en iPhone/iPad
// (PWA), a partir del logo de la marca.
//
// El logo es la cuadrícula 3×3 de public/favicon.svg sobre verde #1B3B36 (el mismo de
// la web y de la PWA). Este script lo dibuja en vector con Chromium y escribe cada PNG
// al tamaño exacto de cada plataforma, con los nombres de la plantilla de Capacitor:
// no hay que tocar Contents.json ni los XML de Android.
//
// Uso (la primera vez: `npx playwright install chromium`):
//   node scripts/generar-iconos-nativos.mjs
// Con otro Chromium: CHROMIUM_PATH=/ruta/al/chrome node scripts/generar-iconos-nativos.mjs
//
// Por qué no `@capacitor/assets`: genera la capa frontal del ícono adaptativo de
// Android a 48 dp (192 px en xxxhdpi) y el XML la estira a 72 dp con un inset, así que
// el ícono queda borroso en pantallas de alta densidad. Además reformatea
// AndroidManifest.xml y deja PNG huérfanos en Splash.imageset.
//
// Si cambia el color de fondo, cambiarlo también en
// android/app/src/main/res/values/ic_launcher_background.xml, que usan el ícono
// adaptativo y el splash de Android (windowSplashScreenBackground en styles.xml).
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IOS = 'ios/App/App/Assets.xcassets'
const RES = 'android/app/src/main/res'

const FONDO = '#1B3B36'
// Colores sólidos equivalentes a los del favicon sobre el fondo: blanco al 92 % →
// #EDEFEF y blanco al 55 % → #98A7A5. Sólidos para que ninguna capa lleve
// transparencias parciales (el lanzador de Android compone las capas por su cuenta).
const CLARO = '#EDEFEF'
const ACENTO = '#B96A3F'
const TENUE = '#98A7A5'
const COLORES = [
  [CLARO, CLARO, CLARO],
  [CLARO, CLARO, ACENTO],
  [CLARO, TENUE, CLARO],
]

// Proporciones del favicon (viewBox 32): cuadros de 4,6, paso 6,7, cuadrícula de 18,
// esquinas de radio 1. Ocupa 18/32 del ícono; aquí además queda centrada (en el
// favicon está desplazada una unidad hacia arriba a la izquierda).
const PROPORCION_ICONO = 18 / 32

/** Cuadrícula de lado `lado` con su esquina superior izquierda en (x, y). */
function cuadricula(x, y, lado) {
  const u = lado / 18
  let rects = ''
  for (let fila = 0; fila < 3; fila++) {
    for (let col = 0; col < 3; col++) {
      rects += `<rect x="${x + col * 6.7 * u}" y="${y + fila * 6.7 * u}" width="${4.6 * u}" height="${4.6 * u}" rx="${u}" fill="${COLORES[fila][col]}"/>`
    }
  }
  return rects
}

/** Cuadrícula centrada en un lienzo de ancho × alto, con lado = fraccion × lado mayor. */
function centrada(ancho, alto, fraccion) {
  const lado = Math.max(ancho, alto) * fraccion
  return cuadricula((ancho - lado) / 2, (alto - lado) / 2, lado)
}

function svg(ancho, alto, contenido) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" shape-rendering="geometricPrecision">${contenido}</svg>`
}

const fondoPleno = (ancho, alto) => `<rect width="${ancho}" height="${alto}" fill="${FONDO}"/>`

// ── iOS ──────────────────────────────────────────────────────────────────────
// Ícono: cuadrado a sangre y SIN canal alfa (App Store rechaza el ícono con alfa);
// iOS aplica su propia máscara redondeada.
const iconoIos = (lado) => svg(lado, lado, fondoPleno(lado, lado) + centrada(lado, lado, PROPORCION_ICONO))

// Splash: 2732 × 2732 con la cuadrícula a 440 px. LaunchScreen.storyboard lo muestra
// con scaleAspectFill, así que en un iPhone queda a ~137 pt de lado.
const FRACCION_SPLASH = 440 / 2732
const splash = (ancho, alto) => svg(ancho, alto, fondoPleno(ancho, alto) + centrada(ancho, alto, FRACCION_SPLASH))

// ── Android ──────────────────────────────────────────────────────────────────
const DENSIDADES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

// Capa frontal del ícono adaptativo: lienzo de 108 dp, del que el lanzador muestra
// como mucho los 72 dp centrales (zona segura: círculo de 66 dp). La cuadrícula mide
// lo mismo que en iOS respecto a lo visible (18/32 de 72 dp = 40,5 dp) y su punto más
// lejano queda a ~28 dp del centro, dentro de la zona segura (33 dp).
const capaFrontal = (lado) => svg(lado, lado, centrada(lado, lado, PROPORCION_ICONO * (72 / 108)))

// Íconos clásicos (Android 7, sin ícono adaptativo): 48 dp con 2 dp de margen.
function iconoClasico(lado, redondo) {
  const margen = lado * (2 / 48)
  const caja = lado - 2 * margen
  const forma = redondo
    ? `<circle cx="${lado / 2}" cy="${lado / 2}" r="${caja / 2}" fill="${FONDO}"/>`
    : `<rect x="${margen}" y="${margen}" width="${caja}" height="${caja}" rx="${caja * 0.25}" fill="${FONDO}"/>`
  const ladoCuadricula = caja * (redondo ? 0.53 : PROPORCION_ICONO)
  const inicio = (lado - ladoCuadricula) / 2
  return svg(lado, lado, forma + cuadricula(inicio, inicio, ladoCuadricula))
}

// Tamaños de los splash de la plantilla de Capacitor (vertical; horizontal invertido).
const SPLASH_ANDROID = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
}

// ── Ficha de Google Play ─────────────────────────────────────────────────────
// Ícono de alta resolución: 512 × 512, cuadrado completo (Play aplica su máscara).
// Gráfico de funciones: 1024 × 500, obligatorio en la ficha.
function graficoFunciones(fuente) {
  const [ancho, alto] = [1024, 500]
  const ladoLogo = 176
  const x = 104
  const y = (alto - ladoLogo) / 2
  const texto = x + ladoLogo + 56
  return `<!doctype html><html><head><style>
    @font-face { font-family: 'Marca'; font-weight: 400 900; src: url(data:font/woff2;base64,${fuente}) format('woff2'); }
    html, body { margin: 0; }
    .lienzo { position: relative; width: ${ancho}px; height: ${alto}px; background: ${FONDO}; font-family: 'Marca', sans-serif; }
    svg { position: absolute; left: 0; top: 0; }
    .texto { position: absolute; left: ${texto}px; top: 0; height: ${alto}px; display: flex; flex-direction: column; justify-content: center; }
    .nombre { color: ${CLARO}; font-size: 72px; font-weight: 700; letter-spacing: -1.5px; line-height: 1; }
    .lema { color: ${TENUE}; font-size: 29px; font-weight: 500; margin-top: 22px; line-height: 1.3; }
    .lema b { color: ${ACENTO}; font-weight: 700; }
  </style></head><body><div class="lienzo">
    ${svg(ancho, alto, cuadricula(x, y, ladoLogo))}
    <div class="texto"><div class="nombre">AdministraTodo</div>
    <div class="lema">Administra agua, edificios y vecinos.<br><b>Todo en uno.</b></div></div>
  </div></body></html>`
}

// ── Generación ───────────────────────────────────────────────────────────────
const pagina = (contenido) =>
  `<!doctype html><html><head><style>html,body{margin:0}svg{display:block}</style></head><body>${contenido}</body></html>`

const trabajos = [
  { ruta: `${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`, ancho: 1024, alto: 1024, html: pagina(iconoIos(1024)) },
  // Los tres archivos que referencia Splash.imageset/Contents.json (1x, 2x, 3x).
  ...['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((nombre) => ({
    ruta: `${IOS}/Splash.imageset/${nombre}`, ancho: 2732, alto: 2732, html: pagina(splash(2732, 2732)),
  })),
  ...Object.entries(DENSIDADES).flatMap(([densidad, escala]) => {
    const clasico = Math.round(48 * escala)
    const frontal = Math.round(108 * escala)
    return [
      { ruta: `${RES}/mipmap-${densidad}/ic_launcher_foreground.png`, ancho: frontal, alto: frontal, html: pagina(capaFrontal(frontal)), transparente: true },
      { ruta: `${RES}/mipmap-${densidad}/ic_launcher.png`, ancho: clasico, alto: clasico, html: pagina(iconoClasico(clasico, false)), transparente: true },
      { ruta: `${RES}/mipmap-${densidad}/ic_launcher_round.png`, ancho: clasico, alto: clasico, html: pagina(iconoClasico(clasico, true)), transparente: true },
    ]
  }),
  { ruta: `${RES}/drawable/splash.png`, ancho: 480, alto: 320, html: pagina(splash(480, 320)) },
  ...Object.entries(SPLASH_ANDROID).flatMap(([densidad, [ancho, alto]]) => [
    { ruta: `${RES}/drawable-port-${densidad}/splash.png`, ancho, alto, html: pagina(splash(ancho, alto)) },
    { ruta: `${RES}/drawable-land-${densidad}/splash.png`, ancho: alto, alto: ancho, html: pagina(splash(alto, ancho)) },
  ]),
  // Play Console pide PNG de 32 bits (con canal alfa) aunque el ícono sea opaco. La
  // captura de pantalla de Chromium omite el canal alfa cuando todo es opaco, así que
  // este se exporta desde un <canvas>, que siempre lo incluye.
  { ruta: 'docs/tiendas/play-icono-512.png', ancho: 512, alto: 512, svgRgba: iconoIos(512) },
  // Web instalada en iPhone/iPad (<link rel="apple-touch-icon"> de index.html).
  // Mismas reglas que el ícono de la app: cuadrado a sangre y sin transparencia.
  // iOS pinta de NEGRO lo transparente, así que un ícono con las esquinas ya
  // redondeadas deja picos negros asomando bajo la máscara del sistema.
  { ruta: 'public/apple-touch-icon.png', ancho: 180, alto: 180, html: pagina(iconoIos(180)) },
]

/** PNG RGBA de un SVG, exportado desde un <canvas> de la página. */
async function pngRgba(p, svgTexto) {
  const dataUrl = await p.evaluate(async (texto) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(texto)
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    canvas.getContext('2d').drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  }, svgTexto)
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

async function main() {
  const fuente = (await readFile(join(ROOT, 'public/fonts/schibsted-grotesk-latin.woff2'))).toString('base64')
  trabajos.push({ ruta: 'docs/tiendas/play-grafico-funciones-1024x500.png', ancho: 1024, alto: 500, html: graficoFunciones(fuente) })

  const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  try {
    for (const t of trabajos) {
      const p = await navegador.newPage({ viewport: { width: t.ancho, height: t.alto }, deviceScaleFactor: 1 })
      const destino = join(ROOT, t.ruta)
      await mkdir(dirname(destino), { recursive: true })
      if (t.svgRgba) {
        await writeFile(destino, await pngRgba(p, t.svgRgba))
      } else {
        await p.setContent(t.html)
        await p.evaluate(() => document.fonts.ready)
        // Sin omitBackground el PNG sale RGB, sin canal alfa: lo que exige el ícono de iOS.
        await p.screenshot({ path: destino, omitBackground: Boolean(t.transparente), clip: { x: 0, y: 0, width: t.ancho, height: t.alto } })
      }
      await p.close()
      console.log(`${t.ruta} (${t.ancho}×${t.alto})`)
    }
  } finally {
    await navegador.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

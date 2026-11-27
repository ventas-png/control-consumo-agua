// Ofrecer la instalación de la web como app (PWA). La detección vive en
// lib/pwaInstall; aquí va lo que ve el usuario:
//
//   - <InstalarAppAviso/>: tarjeta que aparece sola, una vez, abajo, en teléfonos
//     y tablets. Se monta global en main.tsx (solo web), así que cubre la landing,
//     el panel y los portales. Con «Ahora no» no vuelve a salir en 30 días.
//   - <InstalarAppOpcion/>: lo mismo sin caja, para dejarlo fijo en Perfil. Ahí
//     también sirve en escritorio (Chrome y Edge instalan la web como app).
//   - <InstalarAppEnlace/>: un enlace que vuelve a abrir el aviso, para donde no
//     cabe una tarjeta (el pie del portal de condominios).
//
// Android (Chrome, Edge, Samsung) tiene diálogo de instalación propio: el botón
// «Instalar» lo abre. iPhone y iPad no tienen ninguno: solo se puede explicar el
// camino (Compartir → Agregar a inicio), por eso ahí el botón muestra los pasos.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  abrirAvisoDeInstalacion,
  alAbrirAvisoDeInstalacion,
  avisoDescartado,
  descartarAviso,
  leerInstalacion,
  pedirInstalacion,
  suscribirInstalacion,
  type EstadoInstalacion,
  type ViaInstalacion,
} from '../../lib/pwaInstall'
import { readConsent } from '../../lib/cookieConsent'
import { onCookieConsentSaved } from '../../lib/cookieConsentChannel'
import './instalar-app.css'

type Lang = 'es' | 'en'

// La landing es bilingüe (?lang=en) y este aviso sale encima de ella: mismo
// criterio que el banner de cookies. El panel y los portales son en español.
function detectLang(): Lang {
  if (typeof window === 'undefined') return 'es'
  return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'es'
}

// Glifos de iOS, para que el usuario reconozca el botón que tiene que tocar.
function GlifoCompartir() {
  return (
    <svg className="instalar-glifo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3.5" />
      <path d="M8 7l4-4 4 4" />
      <path d="M7.5 10.5H6A1.5 1.5 0 0 0 4.5 12v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5" />
    </svg>
  )
}

function GlifoAgregar() {
  return (
    <svg className="instalar-glifo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  )
}

interface Textos {
  region: string
  titulo: string
  cuerpo: string
  cuerpoPasos: string
  instalar: string
  verPasos: string
  ahoraNo: string
  entendido: string
  cerrar: string
  pasos: Record<Exclude<ViaInstalacion, 'boton' | null>, ReactNode[]>
  notaIosOtro: string
}

const COPY: Record<Lang, Textos> = {
  es: {
    region: 'Instalar la app',
    titulo: 'Instala AdministraTodo',
    cuerpo: 'Ábrela desde tu pantalla de inicio, a pantalla completa, como cualquier otra app.',
    cuerpoPasos: 'Agrégala a tu pantalla de inicio para abrirla como cualquier otra app.',
    instalar: 'Instalar',
    verPasos: 'Ver cómo',
    ahoraNo: 'Ahora no',
    entendido: 'Entendido',
    cerrar: 'Cerrar el aviso de instalación',
    pasos: {
      'ios-safari': [
        <>Toca <GlifoCompartir /> <strong>Compartir</strong> en la barra de Safari. Si no lo ves, toca primero <strong>•••</strong>.</>,
        <>Desliza hacia abajo y elige <GlifoAgregar /> <strong>Agregar a inicio</strong>.</>,
        <>Toca <strong>Agregar</strong>, arriba a la derecha.</>,
      ],
      'ios-otro': [
        <>Toca <GlifoCompartir /> <strong>Compartir</strong>, junto a la barra de direcciones.</>,
        <>Elige <GlifoAgregar /> <strong>Agregar a inicio</strong>.</>,
        <>Toca <strong>Agregar</strong>.</>,
      ],
      manual: [
        <>Abre el menú del navegador (<strong>⋮</strong>).</>,
        <>Elige <strong>Instalar app</strong> o <strong>Agregar a pantalla de inicio</strong>.</>,
      ],
    },
    notaIosOtro: 'Si no ves esa opción, abre esta página en Safari.',
  },
  en: {
    region: 'Install the app',
    titulo: 'Install AdministraTodo',
    cuerpo: 'Open it from your home screen, full screen, like any other app.',
    cuerpoPasos: 'Add it to your home screen to open it like any other app.',
    instalar: 'Install',
    verPasos: 'Show me how',
    ahoraNo: 'Not now',
    entendido: 'Got it',
    cerrar: 'Close the install notice',
    pasos: {
      'ios-safari': [
        <>Tap <GlifoCompartir /> <strong>Share</strong> in the Safari toolbar. If you don’t see it, tap <strong>•••</strong> first.</>,
        <>Scroll down and choose <GlifoAgregar /> <strong>Add to Home Screen</strong>.</>,
        <>Tap <strong>Add</strong> in the top right corner.</>,
      ],
      'ios-otro': [
        <>Tap <GlifoCompartir /> <strong>Share</strong>, next to the address bar.</>,
        <>Choose <GlifoAgregar /> <strong>Add to Home Screen</strong>.</>,
        <>Tap <strong>Add</strong>.</>,
      ],
      manual: [
        <>Open the browser menu (<strong>⋮</strong>).</>,
        <>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</>,
      ],
    },
    notaIosOtro: 'If you don’t see that option, open this page in Safari.',
  },
}

/** Estado de instalación del navegador actual, al día. */
export function useInstalacion(): EstadoInstalacion {
  return useSyncExternalStore(suscribirInstalacion, leerInstalacion, leerInstalacion)
}

function Pasos({ via, t }: { via: Exclude<ViaInstalacion, 'boton' | null>; t: Textos }) {
  return (
    <>
      <ol className="instalar-pasos">
        {t.pasos[via].map((paso, i) => (
          <li key={i}>
            <span>{paso}</span>
          </li>
        ))}
      </ol>
      {via === 'ios-otro' && <p className="instalar-nota">{t.notaIosOtro}</p>}
    </>
  )
}

/**
 * Opción fija de Perfil: texto + botón «Instalar» o los pasos, según el
 * navegador. No dibuja nada si no hay cómo instalar (ya instalada, app nativa o
 * navegador sin soporte): quien la use debe ocultar también su tarjeta con
 * `useInstalacion().via`.
 */
export function InstalarAppOpcion() {
  const { via } = useInstalacion()
  const [instalando, setInstalando] = useState(false)
  const t = COPY.es
  if (!via) return null

  const instalar = async () => {
    setInstalando(true)
    await pedirInstalacion()
    setInstalando(false)
  }

  return (
    <div className="instalar-opcion">
      <p className="instalar-texto">{via === 'boton' ? t.cuerpo : t.cuerpoPasos}</p>
      {via === 'boton' ? (
        <div className="instalar-acciones">
          <button type="button" className="instalar-btn instalar-btn-primario" onClick={() => void instalar()} disabled={instalando}>
            {t.instalar}
          </button>
        </div>
      ) : (
        <Pasos via={via} t={t} />
      )}
    </div>
  )
}

// Vías con las que el aviso sale solo. 'manual' (Android sin diálogo) queda
// fuera: es también lo que reporta Chrome cuando la app YA está instalada y se
// abre la web en una pestaña, y ahí el aviso sería un error.
function saleSolo(via: ViaInstalacion): via is 'boton' | 'ios-safari' | 'ios-otro' {
  return via === 'boton' || via === 'ios-safari' || via === 'ios-otro'
}

/** Teléfono o tablet: el puntero principal es el dedo. */
function esTactil(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
}

/** Espera tras cargar la página, para no aparecer encima de la pantalla de arranque. */
const RETARDO_MS = 2500

export function InstalarAppAviso() {
  const { via } = useInstalacion()
  const [lang] = useState<Lang>(detectLang)
  const [listo, setListo] = useState(false)
  const [cerrado, setCerrado] = useState(() => avisoDescartado())
  // Mientras el banner de cookies está en pantalla (mismo sitio), este espera.
  const [cookiesDecididas, setCookiesDecididas] = useState(() => readConsent().decided)
  const [verPasos, setVerPasos] = useState(false)
  const [instalando, setInstalando] = useState(false)
  // Lo abrió el usuario con «Instalar la app» (InstalarAppEnlace): se muestra
  // aunque lo hubiera cerrado antes, en cualquier dispositivo y con cualquier vía.
  const [pedido, setPedido] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setListo(true), RETARDO_MS)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => onCookieConsentSaved(() => setCookiesDecididas(true)), [])

  useEffect(
    () =>
      alAbrirAvisoDeInstalacion(() => {
        setPedido(true)
        // Quien lo pide quiere saber cómo: los pasos van ya desplegados.
        setVerPasos(true)
      }),
    [],
  )

  const saleSolito = saleSolo(via) && listo && !cerrado && cookiesDecididas && esTactil()
  if (!via || !(pedido || saleSolito)) return null
  const t = COPY[lang]

  const cerrar = () => {
    descartarAviso()
    setCerrado(true)
    setPedido(false)
  }

  const instalar = async () => {
    setInstalando(true)
    const resultado = await pedirInstalacion()
    setInstalando(false)
    // Dijo que no en el diálogo del navegador: no insistir en 30 días. Si aceptó,
    // la vía pasa a null y el aviso desaparece solo.
    if (resultado !== 'aceptada') cerrar()
  }

  return (
    <div className="instalar-root">
      <section className="instalar-card" aria-label={t.region}>
        <button type="button" className="instalar-cerrar" onClick={cerrar} aria-label={t.cerrar}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
        <div className="instalar-cabecera">
          <img className="instalar-icono" src="/pwa-192x192.png" alt="" width={44} height={44} />
          <div>
            <h2 className="instalar-titulo">{t.titulo}</h2>
            <p className="instalar-texto">{via === 'boton' ? t.cuerpo : t.cuerpoPasos}</p>
          </div>
        </div>
        {via !== 'boton' && verPasos && <Pasos via={via} t={t} />}
        <div className="instalar-acciones">
          <button type="button" className="instalar-btn instalar-btn-secundario" onClick={cerrar}>
            {verPasos ? t.entendido : t.ahoraNo}
          </button>
          {via === 'boton' ? (
            <button type="button" className="instalar-btn instalar-btn-primario" onClick={() => void instalar()} disabled={instalando}>
              {t.instalar}
            </button>
          ) : (
            !verPasos && (
              <button type="button" className="instalar-btn instalar-btn-primario" onClick={() => setVerPasos(true)}>
                {t.verPasos}
              </button>
            )
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * Enlace «Instalar la app» para un pie de página: vuelve a abrir el aviso. No
 * dibuja nada si no hay cómo instalar. `separador` es lo que va delante cuando sí
 * se dibuja (el «·» de una lista en línea).
 */
export function InstalarAppEnlace({ separador }: { separador?: ReactNode }) {
  const { via } = useInstalacion()
  if (!via) return null
  return (
    <>
      {separador}
      <button type="button" className="instalar-enlace" onClick={abrirAvisoDeInstalacion}>
        {COPY.es.region}
      </button>
    </>
  )
}

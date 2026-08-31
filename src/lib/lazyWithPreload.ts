import { lazy as reactLazy, type ComponentType, type LazyExoticComponent } from 'react'

// ── Guard del chunk swallowed (Sentry: TypeError en `_result.default`) ──────
//
// El helper de preload que Vite inyecta alrededor de cada `import()` termina en
// `return e().catch(s)`, donde `s` es:
//
//     s = (err) => { const ev = new Event('vite:preloadError', {cancelable:true})
//                    ev.payload = err; window.dispatchEvent(ev)
//                    if (!ev.defaultPrevented) throw err }        ← ojo al if
//
// `main.tsx` escucha ese evento y, ante un chunk viejo tras un deploy, llama
// `preventDefault()` + `location.reload()`. Correcto para recargar… pero al no
// relanzar, el `.catch(s)` deja de rechazar y RESUELVE con `undefined`.
//
// React.lazy guarda ese `undefined` como el módulo (`_status=1`, `_result=undefined`)
// y en el siguiente render hace `payload._result.default` — de ahí el
// `TypeError: undefined is not an object (evaluating 'e._result.default')` con
// stack 100% dentro de react-dom, sin una sola línea de la app. `location.reload()`
// no detiene la ejecución en curso: React alcanza a renderizar y romper antes de
// que la navegación ocurra.
//
// Como el `preventDefault()` es nuestro, la resolución vacía la absorbemos aquí:
// devolvemos una promesa que NUNCA se asienta, así React mantiene el fallback de
// Suspense (un spinner) hasta que la recarga entra. Sin crash y sin pantalla de
// error a cambio de unos milisegundos de spinner.
const NEVER_SETTLES: Promise<never> = new Promise<never>(() => {})

function absorbSwallowedChunk<T>(moduleObject: T): T | Promise<never> {
  return moduleObject == null ? NEVER_SETTLES : moduleObject
}

/**
 * `React.lazy` endurecido: idéntico en firma y comportamiento, salvo que una
 * factory que resuelve `undefined` (ver arriba) suspende en vez de romper.
 * Usar SIEMPRE en lugar de `lazy` de react para componentes de la app.
 */
export function lazySafe<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return reactLazy(() => factory().then(absorbSwallowedChunk))
}

// agua:A8 — `lazy()` sin prefetch: las secciones se descargaban solo al
// navegar a ellas (cold chunk → spinner). Este wrapper expone `.preload()`
// para disparar la descarga del chunk por anticipado (p. ej. al hacer hover
// sobre el item del sidebar), de modo que al hacer click el código ya esté
// en caché. Espeja la firma de React.lazy y memoiza el import para que
// múltiples preloads/render compartan una sola promesa.

// Espeja la firma de React.lazy (`T extends ComponentType<any>`) para no pelear
// con la contravarianza de props de cada sección.
export type PreloadableComponent<T extends ComponentType<any>> =
  LazyExoticComponent<T> & { preload: () => Promise<{ default: T }> }

export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let promise: Promise<{ default: T }> | undefined
  // Mismo guard que `lazySafe`: el preload dispara la misma factory, así que la
  // resolución vacía puede llegar por aquí igual que por el render.
  const load = () => (promise ??= factory().then(absorbSwallowedChunk))
  const Component = reactLazy(load) as PreloadableComponent<T>
  Component.preload = load
  return Component
}

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

// agua:A8 — `lazy()` sin prefetch: las secciones se descargaban solo al
// navegar a ellas (cold chunk → spinner). Este wrapper expone `.preload()`
// para disparar la descarga del chunk por anticipado (p. ej. al hacer hover
// sobre el item del sidebar), de modo que al hacer click el código ya esté
// en caché. Espeja la firma de React.lazy y memoiza el import para que
// múltiples preloads/render compartan una sola promesa.

// Espeja la firma de React.lazy (`T extends ComponentType<any>`) para no pelear
// con la contravarianza de props de cada sección.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PreloadableComponent<T extends ComponentType<any>> =
  LazyExoticComponent<T> & { preload: () => Promise<{ default: T }> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let promise: Promise<{ default: T }> | undefined
  const load = () => (promise ??= factory())
  const Component = lazy(load) as PreloadableComponent<T>
  Component.preload = load
  return Component
}

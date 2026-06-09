import { type SVGProps, type ReactNode } from 'react'

// ============================================================================
// Icon — set de iconos de línea on-brand (SVG inline, sin dependencias).
// ============================================================================
// Reemplaza emojis FUNCIONALES (💧 en métricas de agua, 💰 montos, etc.) por
// iconos vectoriales coherentes. Heredan `currentColor` → respetan el color del
// contexto y el dark mode sin esfuerzo. Los emojis se reservan para momentos de
// deleite (portal del residente).
//
// Accesible: decorativo por defecto (aria-hidden). Si pasas `aria-label`, se
// expone como role="img" con esa etiqueta.
//
//   <Icon name="droplet" size={18} />
//   <Icon name="coins" aria-label="Monto cobrado" />
// ============================================================================

export type IconName =
  | 'droplet' | 'zap' | 'gauge' | 'receipt' | 'coins' | 'check' | 'user'
  | 'users' | 'bell' | 'alert' | 'search' | 'plus' | 'home' | 'wrench'
  | 'chart' | 'inbox' | 'calendar' | 'building'

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /** Lado del icono en px (cuadrado). Default 20. */
  size?: number
  /** Grosor del trazo. Default 1.75. */
  strokeWidth?: number
}

const PATHS: Record<IconName, ReactNode> = {
  droplet: <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />,
  zap: <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />,
  gauge: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  receipt: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </>
  ),
  coins: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  check: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </>
  ),
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  home: (
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  chart: <path d="M18 20V10M12 20V4M6 20v-6" />,
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M10 7h.01M14 7h.01M10 11h.01M14 11h.01M10 15h4" />
    </>
  ),
}

export function Icon({ name, size = 20, strokeWidth = 1.75, 'aria-label': ariaLabel, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}

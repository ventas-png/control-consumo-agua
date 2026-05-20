// Minimal stroke icons (1.5 stroke, currentColor) for the AdministraTodo landing.
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function strokeIcon(paths: ReactNode, vb = '0 0 24 24') {
  return function StrokeIcon({ size = 20, ...props }: IconProps) {
    return (
      <svg
        viewBox={vb}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={size}
        height={size}
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    )
  }
}

export const Icon = {
  drop: strokeIcon(<path d="M12 3c-3 4.5-6 7.8-6 11.5a6 6 0 0 0 12 0C18 10.8 15 7.5 12 3Z" />),
  building: strokeIcon(
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </>,
  ),
  chart: strokeIcon(
    <>
      <path d="M4 20h16" />
      <path d="M6 16V9M10 16v-4M14 16v-7M18 16v-3" />
    </>,
  ),
  bell: strokeIcon(
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 8H4c0-2 2-3 2-8Z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>,
  ),
  ticket: strokeIcon(
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H18.5A1.5 1.5 0 0 1 20 8.5V11a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 18.5 19H5.5A1.5 1.5 0 0 1 4 17.5V15a2 2 0 0 0 0-4V8.5Z" />
      <path d="M14 7v12" />
    </>,
  ),
  calendar: strokeIcon(
    <>
      <rect x="4" y="5" width="16" height="15" rx="1.5" />
      <path d="M4 9h16M9 3v4M15 3v4" />
    </>,
  ),
  message: strokeIcon(<path d="M21 12a8 8 0 1 1-3.4-6.5L21 5l-1 4.4A8 8 0 0 1 21 12Z" />),
  phone: strokeIcon(
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </>,
  ),
  arrow_right: strokeIcon(<path d="M5 12h14M13 6l6 6-6 6" />),
  arrow_up_right: strokeIcon(<path d="M7 17 17 7M9 7h8v8" />),
  check: strokeIcon(<path d="M5 12.5 9.5 17 19 7.5" />),
  play: strokeIcon(<path d="M7 5v14l12-7L7 5Z" fill="currentColor" stroke="none" />),
  plus: strokeIcon(<path d="M12 5v14M5 12h14" />),
  minus: strokeIcon(<path d="M5 12h14" />),
  google: ({ size = 18, ...props }: IconProps) => (
    <svg viewBox="0 0 18 18" width={size} height={size} aria-hidden="true" {...props}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84A4.14 4.14 0 0 1 12 13.56v2.27h2.92c1.7-1.57 2.72-3.88 2.72-6.63Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.9v2.32A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.7 9c0-.6.1-1.18.27-1.72V4.96H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.04l3.07-2.32Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .9 4.96L3.97 7.3C4.68 5.18 6.66 3.58 9 3.58Z" />
    </svg>
  ),
  // Brand mark — stacked grid evoking a condo facade with one tracked unit.
  logo: ({ size = 28, ...props }: IconProps) => (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" {...props}>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="currentColor" />
      <g fill="var(--c-surface)" opacity="0.92">
        <rect x="7" y="7" width="4.6" height="4.6" rx="1" />
        <rect x="13.7" y="7" width="4.6" height="4.6" rx="1" />
        <rect x="20.4" y="7" width="4.6" height="4.6" rx="1" />
        <rect x="7" y="13.7" width="4.6" height="4.6" rx="1" />
        <rect x="13.7" y="13.7" width="4.6" height="4.6" rx="1" />
        <rect x="7" y="20.4" width="4.6" height="4.6" rx="1" />
        <rect x="20.4" y="20.4" width="4.6" height="4.6" rx="1" />
      </g>
      <rect x="20.4" y="13.7" width="4.6" height="4.6" rx="1" fill="var(--c-accent)" />
      <rect x="13.7" y="20.4" width="4.6" height="4.6" rx="1" fill="var(--c-surface)" opacity="0.55" />
    </svg>
  ),
}

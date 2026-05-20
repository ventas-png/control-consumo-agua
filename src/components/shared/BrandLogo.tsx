// AdministraTodo brand mark — a condo-facade grid with one accent ("tracked") unit.
// Colors are hardcoded (Verdant defaults) so it renders correctly anywhere in the
// app, not only inside the landing's .at-root token scope.
interface BrandLogoProps {
  size?: number
  bg?: string
  window?: string
  accent?: string
}

export function BrandLogo({ size = 32, bg = '#1B3B36', window = '#FFFFFF', accent = '#B96A3F' }: BrandLogoProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="8" fill={bg} />
      <g fill={window} opacity="0.92">
        <rect x="7" y="7" width="4.6" height="4.6" rx="1" />
        <rect x="13.7" y="7" width="4.6" height="4.6" rx="1" />
        <rect x="20.4" y="7" width="4.6" height="4.6" rx="1" />
        <rect x="7" y="13.7" width="4.6" height="4.6" rx="1" />
        <rect x="13.7" y="13.7" width="4.6" height="4.6" rx="1" />
        <rect x="7" y="20.4" width="4.6" height="4.6" rx="1" />
        <rect x="20.4" y="20.4" width="4.6" height="4.6" rx="1" />
      </g>
      <rect x="20.4" y="13.7" width="4.6" height="4.6" rx="1" fill={accent} />
      <rect x="13.7" y="20.4" width="4.6" height="4.6" rx="1" fill={window} opacity="0.55" />
    </svg>
  )
}

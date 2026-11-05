import { useEffect } from 'react'
import { useBrandingQuery } from '../../domain/branding/queries'
import { hojaEstilosMarca, BRANDING_STYLE_ID } from '../../lib/branding'

// plat:P20 — Aplica los colores de marca de la empresa (primario + acento) a TODA
// la app: inyecta un <style> con las CSS vars de marca (--at-primary y sus tonos
// -hover/-soft/-2/-tint/-soft-2/-mint/-mint-2, más --at-chip y --at-surface-tint;
// BRAND_CSS_VARS) y de acento (--at-accent y -hover/-dark/-darker/-light/-soft/
// -soft-2/-tint/-tint-2, más --at-accent-2; ACCENT_CSS_VARS) para el tema CLARO y
// el OSCURO (selectores que replican los de src/index.css). NO se usa style
// inline en <html>: un inline gana a la
// cascada y en dark mode dejaba, p. ej., --at-primary-soft casi blanco. Es un
// efecto puro (no renderiza nada). Sin color custom, quita la hoja y la cascada
// vuelve a los defaults. Se monta una vez en el shell autenticado (App).

export function BrandingApplier({ companyId }: { companyId?: string | null }) {
  const { data: row } = useBrandingQuery(companyId ?? undefined)
  const primaryColor = row?.primary_color ?? null
  const accentColor = row?.accent_color ?? null

  useEffect(() => {
    const css = hojaEstilosMarca(primaryColor, accentColor)
    let el = document.getElementById(BRANDING_STYLE_ID) as HTMLStyleElement | null
    if (!css) {
      el?.remove()
      return
    }
    if (!el) {
      el = document.createElement('style')
      el.id = BRANDING_STYLE_ID
      document.head.appendChild(el)
    }
    el.textContent = css
  }, [primaryColor, accentColor])

  return null
}

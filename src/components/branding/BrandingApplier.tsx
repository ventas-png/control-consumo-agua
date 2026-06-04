import { useEffect } from 'react'
import { useBrandingQuery } from '../../domain/branding/queries'
import { estilosMarca, estilosAccent, BRAND_CSS_VARS, ACCENT_CSS_VARS } from '../../lib/branding'

// plat:P20 — Aplica los colores de marca de la empresa (primario + acento) a TODA
// la app: setea las CSS vars --at-primary/-hover/-soft y --at-accent/-hover en
// :root. Es un efecto puro (no renderiza nada). Si la empresa no tiene un color
// custom, RESTABLECE esas vars para que la cascada use los defaults de la hoja de
// estilos. Se monta una vez en el shell autenticado (App).

function aplicarVars(root: HTMLElement, vars: Record<string, string> | null, names: readonly string[]) {
  if (!vars) {
    for (const k of names) root.style.removeProperty(k)
    return
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
}

export function BrandingApplier({ companyId }: { companyId?: string | null }) {
  const { data: row } = useBrandingQuery(companyId ?? undefined)
  const primaryColor = row?.primary_color ?? null
  const accentColor = row?.accent_color ?? null

  useEffect(() => {
    const root = document.documentElement
    aplicarVars(root, estilosMarca(primaryColor), BRAND_CSS_VARS)
    aplicarVars(root, estilosAccent(accentColor), ACCENT_CSS_VARS)
  }, [primaryColor, accentColor])

  return null
}

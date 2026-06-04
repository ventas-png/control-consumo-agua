import { useEffect } from 'react'
import { useBrandingQuery } from '../../domain/branding/queries'
import { estilosMarca, BRAND_CSS_VARS } from '../../lib/branding'

// plat:P20 — Aplica el color de marca de la empresa a TODA la app: setea las CSS
// vars --at-primary/-hover/-soft en :root (document.documentElement). Es un
// efecto puro y no renderiza nada. Si la empresa no tiene color custom, RESTABLECE
// esas vars para que la cascada use los defaults de la hoja de estilos. Se monta
// una vez en el shell autenticado (App).
export function BrandingApplier({ companyId }: { companyId?: string | null }) {
  const { data: row } = useBrandingQuery(companyId ?? undefined)
  const primaryColor = row?.primary_color ?? null

  useEffect(() => {
    const root = document.documentElement
    const vars = estilosMarca(primaryColor)
    if (!vars) {
      for (const k of BRAND_CSS_VARS) root.style.removeProperty(k)
      return
    }
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  }, [primaryColor])

  return null
}

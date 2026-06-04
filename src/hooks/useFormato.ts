import { useMemo } from 'react'
import { useSession } from '../components/shared/SessionContext'
import { useMisPreferenciasQuery } from '../domain/preferencias/queries'
import {
  normalizarPreferencias,
  formatFechaHora as fmtFechaHora,
  formatMoneda as fmtMoneda,
  type PreferenciasRegionales,
} from '../lib/formatoRegional'

export interface FormatoRegionalAPI {
  prefs: PreferenciasRegionales
  formatFechaHora: (iso: string | null | undefined) => string
  formatMoneda: (n: number) => string
}

/**
 * plat:P18 — Formateadores ligados a las preferencias regionales del usuario
 * actual (idioma / zona horaria / moneda). Lee la sesión + sus preferencias
 * (TanStack Query dedupe la consulta entre consumidores) y expone helpers ya
 * ligados. Los componentes del árbol autenticado lo usan para mostrar fechas y
 * montos en el formato local del usuario, reemplazando los `toLocaleDateString`
 * fijos de forma incremental.
 */
export function useFormato(): FormatoRegionalAPI {
  const session = useSession()
  const { data: row } = useMisPreferenciasQuery(session.user_id)
  const prefs = useMemo(() => normalizarPreferencias(row ?? undefined), [row])
  return useMemo(
    () => ({
      prefs,
      formatFechaHora: (iso: string | null | undefined) => fmtFechaHora(iso, prefs),
      formatMoneda: (n: number) => fmtMoneda(n, prefs),
    }),
    [prefs],
  )
}

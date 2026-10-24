import { useEffect, useState } from 'react'
import { fetchDiasAvisoRenovacion } from '../domain/condominios/visitasFrecuentesConfig'
import { DIAS_AVISO_RENOVACION_DEFAULT, normalizarDiasAviso } from '../lib/visitasFrecuentes'

/**
 * Días de aviso de renovación de visitas frecuentes del condominio. Si quien
 * monta ya lo tiene (el portal lo trae en su carga única), lo pasa en
 * `valor` y no se consulta nada; si no, se lee de `projects`.
 */
export function useDiasAvisoRenovacion(proyectoId: string, valor?: number): number {
  const [leido, setLeido] = useState<number | null>(null)
  useEffect(() => {
    if (valor !== undefined || !proyectoId) return
    let cancelado = false
    void fetchDiasAvisoRenovacion(proyectoId).then(r => { if (!cancelado) setLeido(r.dias) })
    return () => { cancelado = true }
  }, [proyectoId, valor])
  if (valor !== undefined) return normalizarDiasAviso(valor)
  return leido ?? DIAS_AVISO_RENOVACION_DEFAULT
}

// Tab "Plantillas" (Seguridad) — consumidor de edición del catálogo compartido
// de actividades. La implementación vive en ActividadesCatalog: Limpieza
// consume EXACTAMENTE el mismo componente en modo consulta (filtrado por
// servicio = limpieza), así que aquí no hay lógica propia que pueda divergir.
import { ActividadesCatalog } from '../ActividadesCatalog'
import type { AreaCondominio, ItemInventario, PlantillaTareaCargo, SuministroCondominio } from '../../../types'

interface Props {
  plantillas: PlantillaTareaCargo[]
  areas: AreaCondominio[]
  suministros: SuministroCondominio[]
  inventario: ItemInventario[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

export function PlantillasCargoTab(props: Props) {
  return <ActividadesCatalog {...props} />
}

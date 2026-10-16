// Tab "Plantillas" (Seguridad) — consumidor de edición del catálogo compartido
// de actividades. La implementación vive en ActividadesCatalog: Limpieza
// consume EXACTAMENTE el mismo componente en modo consulta (filtrado por
// servicio = limpieza), así que aquí no hay lógica propia que pueda divergir.
import { ActividadesCatalog } from '../ActividadesCatalog'
import type { AreaCondominio, CargoCatalogo, ItemInventario, PlantillaTareaCargo, SuministroCondominio } from '../../../types'

interface Props {
  plantillas: PlantillaTareaCargo[]
  /** Cargos del condominio (Configuración RRHH); opcional por los consumidores sin catálogo. */
  cargos?: CargoCatalogo[]
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

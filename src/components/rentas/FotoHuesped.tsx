import { BUCKET_RENTAS_HUESPEDES } from '../../domain/shared/buckets'
import { ImageUploader, MultiImageUploader } from '../shared/ImageUploader'

/**
 * Dónde viven las fotos de los huéspedes de una reserva: con las de la pestaña
 * STR (bucket de Condominios, por proyecto) si la propiedad está enlazada, o en
 * el bucket privado de Rentas, bajo `<empresa>/<propiedad>/`, si es independiente.
 */
export type DestinoFotos =
  | { tipo: 'condominio' }
  | { tipo: 'rentas'; companyId: string; propiedadId: string }

interface Props {
  value: string | null
  onChange: (ruta: string | null) => void
  label: string
  destino: DestinoFotos
  onSubiendo?: (subiendo: boolean) => void
}

/** Una foto (del huésped o de su documento), subida al destino que toca. */
export function FotoHuesped({ value, onChange, label, destino, onSubiendo }: Props) {
  if (destino.tipo === 'condominio') {
    return <ImageUploader value={value} onChange={onChange} folder="str_guests" label={label} capture onSubiendo={onSubiendo} />
  }
  // En Rentas quitar una foto NO la borra al instante: la fila guardada no debe
  // apuntar a un archivo borrado. Se retiran al guardar o cancelar (retirarFotosHuespedes).
  return (
    <MultiImageUploader values={value ? [value] : []} onChange={v => onChange(v[0] ?? null)} maxFiles={1}
      bucket={BUCKET_RENTAS_HUESPEDES} alcance={destino.companyId} folder={destino.propiedadId}
      label={label} capture borrarAlQuitar={false} onSubiendo={onSubiendo} />
  )
}

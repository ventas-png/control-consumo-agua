// Pestañas de Manejo de Rentas. Cada una es una ruta propia (`/rentas/<tab>`)
// y un módulo con su permiso; el Panel vive en `/rentas`.
import type { AppSection } from '../../types'

export type RentasTab = 'panel' | 'propiedades' | 'reservas' | 'contratos' | 'inventario' | 'finanzas'

export const RENTAS_TABS: readonly { id: RentasTab; label: string; icon: string; modulo: AppSection }[] = [
  { id: 'panel',       label: 'Panel',       icon: '📊', modulo: 'rentas_panel' },
  { id: 'propiedades', label: 'Propiedades', icon: '🏘️', modulo: 'rentas_propiedades' },
  { id: 'reservas',    label: 'Reservas',    icon: '📅', modulo: 'rentas_reservas' },
  { id: 'contratos',   label: 'Contratos',   icon: '📝', modulo: 'rentas_contratos' },
  { id: 'inventario',  label: 'Inventario',  icon: '🛋️', modulo: 'rentas_inventario' },
  { id: 'finanzas',    label: 'Finanzas',    icon: '💵', modulo: 'rentas_finanzas' },
]

export function rentasTabToPath(tab: RentasTab): string {
  return tab === 'panel' ? '/rentas' : `/rentas/${tab}`
}

// Elegir cuánto equipo se pide para una reserva (panel de administración).
// Calcula la disponibilidad en el cliente con lo cargado en memoria —el panel
// ve TODOS los préstamos del proyecto—; la base vuelve a validarla al escribir.
// El portal del residente no usa este componente: él consulta la
// disponibilidad por RPC porque sólo ve sus propios préstamos.
import { useId } from 'react'
import type { AmenidadInventario, ItemInventario, PrestamoEquipo } from '../../../../types'
import { disponibilidadEquipo, rentaEquipoSolicitado, rentaUnitaria, topePorReserva } from '../../../../lib/prestamosEquipo'
import { CATEGORIA_INVENTARIO_ICON } from './SelectorEquiposAmenidad'

interface Props {
  /** Enlaces amenidad ↔ inventario de la amenidad elegida. */
  links: AmenidadInventario[]
  inventario: ItemInventario[]
  prestamos: PrestamoEquipo[]
  /** Fecha de la reserva ('' mientras no se elige: la disponibilidad no se calcula). */
  fecha: string
  moneda: string
  value: Record<string, number>
  onChange: (value: Record<string, number>) => void
  titulo?: string
}

export function SelectorEquiposReserva({ links, inventario, prestamos, fecha, moneda, value, onChange, titulo = '🪑 Equipo para la reserva' }: Props) {
  const uid = useId()
  const filas = links
    .map(l => ({ link: l, item: inventario.find(i => i.id === l.inventario_id) }))
    .filter((f): f is { link: AmenidadInventario; item: ItemInventario } => !!f.item && f.item.estado !== 'dado_de_baja')
    .sort((a, b) => a.item.nombre.localeCompare(b.item.nombre))
  if (filas.length === 0) return null

  function setCantidad(id: string, raw: string, tope: number) {
    const n = Math.max(0, Math.min(tope, parseInt(raw) || 0))
    const next = { ...value }
    if (n > 0) next[id] = n
    else delete next[id]
    onChange(next)
  }

  const pedidos = Object.values(value).filter(n => n > 0).length
  // Renta de lo pedido (20261118000000): se suma a la tarifa de la reserva.
  const renta = rentaEquipoSolicitado(value, inventario)

  return (
    <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)' }}>{titulo}</div>
        <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)' }}>
          {fecha ? `Disponible para el ${fecha}` : 'Elige la fecha para ver cuánto hay disponible'}
          {pedidos > 0 && ` · ${pedidos} equipo${pedidos === 1 ? '' : 's'} pedido${pedidos === 1 ? '' : 's'}`}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filas.map(({ link, item }) => {
          const disponible = fecha ? disponibilidadEquipo(item, prestamos, fecha) : 0
          const tope = fecha ? topePorReserva(link, disponible) : 0
          const inputId = `${uid}-${item.id}`
          const agotado = fecha && tope <= 0
          return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, opacity: agotado ? 0.65 : 1 }}>
              <span style={{ fontSize: 16 }} aria-hidden="true">{CATEGORIA_INVENTARIO_ICON[item.categoria] ?? '📋'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)', cursor: 'pointer' }}>{item.nombre}</label>
                <div style={{ fontSize: 11, color: agotado ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                  {!fecha ? 'Disponibilidad según la fecha'
                    : agotado ? 'Sin disponibilidad para esa fecha'
                    : `${Math.max(0, disponible)} disponible${disponible === 1 ? '' : 's'}`}
                  {link.cantidad_max_por_reserva != null && ` · máx. ${link.cantidad_max_por_reserva} por reserva`}
                  {item.costo_unitario != null && ` · reposición ${moneda} ${Number(item.costo_unitario).toFixed(2)} c/u`}
                  {rentaUnitaria(item) != null && <strong style={{ color: 'var(--at-primary-hover)' }}>{` · renta ${moneda} ${rentaUnitaria(item)!.toFixed(2)} c/u`}</strong>}
                </div>
                {link.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontStyle: 'italic' }}>{link.notas}</div>}
              </div>
              <input
                id={inputId}
                type="number"
                min={0}
                max={tope}
                value={value[item.id] ?? ''}
                placeholder="0"
                disabled={!fecha || tope <= 0}
                onChange={e => setCantidad(item.id, e.target.value, tope)}
                aria-label={`Cantidad de ${item.nombre}`}
                style={{ width: 78, padding: '7px 8px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)', textAlign: 'right' }}
              />
            </div>
          )
        })}
      </div>
      {renta > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--at-primary-hover)' }}>
          <span>🪑 Renta de equipo (adicional a la reserva)</span>
          <span>{moneda} {renta.toFixed(2)}</span>
        </div>
      )}
    </div>
  )
}

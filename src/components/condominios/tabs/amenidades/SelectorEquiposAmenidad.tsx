// Configuración de la amenidad: qué equipo del inventario se presta con ella
// y hasta cuánto por reserva (20261108000000). El valor es un mapa
// inventario_id → tope ('' = sin tope); lo que no está en el mapa no se presta.
import { useId, useState } from 'react'
import type { CategoriaInventario, ItemInventario, PrestamoEquipo } from '../../../../types'
import { enCirculacion, rentaUnitaria } from '../../../../lib/prestamosEquipo'

export const CATEGORIA_INVENTARIO_ICON: Record<CategoriaInventario, string> = {
  herramienta: '🔨', equipo: '⚙️', material: '📦', mobiliario: '🪑', vehiculo: '🚗', otro: '📋',
}

interface Props {
  inventario: ItemInventario[]
  prestamos: PrestamoEquipo[]
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
}

export function SelectorEquiposAmenidad({ inventario, prestamos, value, onChange }: Props) {
  const [filtro, setFiltro] = useState('')
  const uid = useId()
  // Lo dado de baja no se ofrece; lo que está en reparación se muestra (puede
  // volver) pero se avisa que hoy no se presta.
  const prestables = inventario.filter(i => i.estado !== 'dado_de_baja')
  const q = filtro.trim().toLowerCase()
  const visibles = q ? prestables.filter(i => i.nombre.toLowerCase().includes(q) || (i.ubicacion ?? '').toLowerCase().includes(q)) : prestables
  const seleccionados = Object.keys(value).length

  function toggle(id: string, on: boolean) {
    const next = { ...value }
    if (on) next[id] = next[id] ?? ''
    else delete next[id]
    onChange(next)
  }

  return (
    <div style={{ borderTop: '1px dashed var(--at-line)', paddingTop: 12, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)' }}>🪑 Equipo que el residente puede solicitar</div>
          <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', lineHeight: 1.45 }}>
            Al reservar, el residente elige de esta lista qué se le entrega; la entrega y la devolución quedan registradas en Préstamo de equipos y lo que falte se cobra al costo del inventario. Lo marcado en Inventario como «se presta a un costo» suma su renta por unidad al cobro de la reserva.
          </div>
        </div>
        {seleccionados > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-primary-hover)', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
            {seleccionados} seleccionado{seleccionados === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {prestables.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', border: '1px dashed var(--at-line-strong)', borderRadius: 8, padding: '10px 12px' }}>
          No hay equipo en el inventario de este condominio. Regístralo en Operaciones › Inventario y vuelve aquí para enlazarlo.
        </div>
      ) : (
        <>
          {prestables.length > 6 && (
            <input
              type="text"
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
              placeholder="Buscar equipo por nombre o ubicación…"
              aria-label="Buscar equipo del inventario"
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, background: 'var(--at-surface-2)', marginBottom: 6 }}
            />
          )}
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--at-line)', borderRadius: 10, background: 'var(--at-surface)' }}>
            {visibles.length === 0 && (
              <div style={{ padding: 12, fontSize: 12.5, color: 'var(--at-ink-3)' }}>Ningún equipo coincide con «{filtro}».</div>
            )}
            {visibles.map(i => {
              const on = i.id in value
              const fuera = enCirculacion(i.id, prestamos)
              const inputId = `${uid}-max-${i.id}`
              return (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--at-line)', background: on ? 'var(--at-primary-tint)' : 'transparent' }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={e => toggle(i.id, e.target.checked)}
                    aria-label={`Prestar ${i.nombre} con esta amenidad`}
                  />
                  <span style={{ fontSize: 16 }} aria-hidden="true">{CATEGORIA_INVENTARIO_ICON[i.categoria] ?? '📋'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)' }}>{i.nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>
                      {i.cantidad} {i.unidad_medida} en inventario
                      {fuera > 0 && ` · ${fuera} en préstamo`}
                      {i.estado === 'en_reparacion' && ' · en reparación (no se presta hasta que vuelva)'}
                      {i.costo_unitario != null && ` · reposición ${Number(i.costo_unitario).toFixed(2)} c/u`}
                      {rentaUnitaria(i) != null && <strong style={{ color: 'var(--at-primary-hover)' }}>{` · se renta a ${rentaUnitaria(i)!.toFixed(2)} c/u`}</strong>}
                    </div>
                  </div>
                  {on && (
                    <label htmlFor={inputId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--at-ink-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Máx./reserva
                      <input
                        id={inputId}
                        type="number"
                        min={1}
                        value={value[i.id] ?? ''}
                        onChange={e => onChange({ ...value, [i.id]: e.target.value })}
                        placeholder="sin tope"
                        style={{ width: 84, padding: '6px 8px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, background: 'var(--at-surface-2)' }}
                      />
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

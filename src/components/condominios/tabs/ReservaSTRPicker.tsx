// Selector de la reserva STR a la que se vincula un servicio de housekeeping (opcional).
//
// El catálogo lo da el servidor (hk_reservas_vinculables: en curso y confirmadas del
// proyecto, exige hk_acceso); aquí solo se busca, se ordena por conveniencia (la unidad y
// la fecha del servicio primero) y se elige. La base vuelve a validar al guardar
// (trg_hk_reserva): elegir aquí nunca sustituye esa validación.
import { useMemo, useState } from 'react'
import { etiquetaReserva, filtrarReservas, sugerirReservas } from '../../../domain/condominios/housekeepingFlujo'
import type { ReservaSTRResumen, ReservaSTRVinculable } from '../../../types'

interface Props {
  /** Catálogo del servidor; `null` mientras carga. */
  reservas: ReservaSTRVinculable[] | null
  cargando: boolean
  error: string | null
  value: string | null
  onChange: (id: string | null, reserva: ReservaSTRVinculable | null) => void
  /** Resumen sellado por la base (al editar): se muestra mientras carga el catálogo o si la reserva ya no es vinculable. */
  resumen?: ReservaSTRResumen | null
  /** Contexto del servicio para ordenar sugerencias. */
  unidadId?: string | null
  fecha?: string | null
  disabled?: boolean
}

const ESTADO_LABEL: Record<ReservaSTRVinculable['estado'], string> = { en_curso: 'en curso', confirmada: 'confirmada' }

export function ReservaSTRPicker({ reservas, cargando, error, value, onChange, resumen, unidadId, fecha, disabled }: Props) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const elegida = value ? reservas?.find(r => r.id === value) ?? null : null
  const lista = useMemo(
    () => (reservas ? sugerirReservas(filtrarReservas(reservas, texto), { unidadId, fecha }) : []),
    [reservas, texto, unidadId, fecha],
  )

  if (error) {
    return <div role="alert" style={{ fontSize: 12, color: 'var(--at-danger)' }}>No se pudieron cargar las reservas: {error}</div>
  }

  if (value) {
    return (
      <div data-testid="reserva-elegida" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
        <span>🔖 {elegida ? `${etiquetaReserva(elegida)} · ${elegida.unidad_nombre ?? 'sin unidad'} (${ESTADO_LABEL[elegida.estado]})`
          : resumen && resumen.reserva_id === value ? `${etiquetaReserva(resumen)}${resumen.estado ? ` (${resumen.estado.replace('_', ' ')})` : ''}`
          : `Reserva ${value.slice(0, 8)}`}</span>
        {!disabled && (
          <>
            <button type="button" onClick={() => { onChange(null, null); setAbierto(true) }}
              style={{ padding: '2px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', cursor: 'pointer' }}>Cambiar</button>
            <button type="button" onClick={() => onChange(null, null)}
              style={{ padding: '2px 8px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Quitar</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <input aria-label="Buscar reserva" placeholder={cargando ? 'Cargando reservas…' : 'Código, huésped o unidad (opcional)'}
        value={texto} disabled={disabled || cargando} onFocus={() => setAbierto(true)} onChange={e => { setTexto(e.target.value); setAbierto(true) }}
        style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }} />
      {abierto && !cargando && reservas && (
        <ul role="listbox" aria-label="Reservas vinculables"
          style={{ listStyle: 'none', margin: '4px 0 0', padding: 4, border: '1.5px solid var(--at-line)', borderRadius: 8, background: 'var(--at-surface)', maxHeight: 200, overflowY: 'auto' }}>
          <li role="option" aria-selected={false}>
            <button type="button" onClick={() => { onChange(null, null); setAbierto(false); setTexto('') }}
              style={{ width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--at-ink-3)' }}>— Sin reserva —</button>
          </li>
          {lista.length === 0 && <li style={{ padding: '6px 8px', fontSize: 12, color: 'var(--at-ink-3)' }}>{reservas.length === 0 ? 'No hay reservas en curso ni confirmadas en este proyecto.' : 'Sin coincidencias.'}</li>}
          {lista.map(r => (
            <li key={r.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onChange(r.id, r); setAbierto(false); setTexto('') }}
                style={{ width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--at-ink)' }}>
                🔖 {etiquetaReserva(r)} <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}>· {r.unidad_nombre ?? 'sin unidad'} · {ESTADO_LABEL[r.estado]} · {r.plataforma}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

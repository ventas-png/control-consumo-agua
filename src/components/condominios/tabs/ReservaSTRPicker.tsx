// Selector de la reserva STR a la que se vincula un servicio de housekeeping (opcional).
//
// El catálogo lo da el servidor (hk_reservas_vinculables: en curso y confirmadas del
// proyecto, exige hk_acceso); aquí solo se busca, se acota a la unidad elegida (con opción
// de ver todas), se ordena por conveniencia (la fecha del servicio primero) y se elige. La
// base vuelve a validar al guardar (trg_hk_reserva): elegir aquí nunca sustituye esa
// validación.
import { useMemo, useState } from 'react'
import { etiquetaReserva, filtrarReservas, reservasDeUnidad, sugerirReservas } from '../../../domain/condominios/housekeepingFlujo'
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
  /** Unidad del servicio: acota la lista a sus reservas (y a las que no tienen unidad). */
  unidadId?: string | null
  /** Nombre de esa unidad, para los textos. */
  unidadNombre?: string | null
  fecha?: string | null
  disabled?: boolean
}

const ESTADO_LABEL: Record<ReservaSTRVinculable['estado'], string> = { en_curso: 'en curso', confirmada: 'confirmada' }

const btnChico = { padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', cursor: 'pointer' } as const

export function ReservaSTRPicker({ reservas, cargando, error, value, onChange, resumen, unidadId, unidadNombre, fecha, disabled }: Props) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [verTodas, setVerTodas] = useState(false)
  const elegida = value ? reservas?.find(r => r.id === value) ?? null : null
  const acotar = !!unidadId && !verTodas
  const { lista, ocultas } = useMemo(() => {
    if (!reservas) return { lista: [], ocultas: 0 }
    const buscadas = filtrarReservas(reservas, texto)
    const visibles = acotar ? reservasDeUnidad(buscadas, unidadId) : buscadas
    return { lista: sugerirReservas(visibles, { unidadId, fecha }), ocultas: buscadas.length - visibles.length }
  }, [reservas, texto, acotar, unidadId, fecha])

  if (error) {
    return <div role="alert" style={{ fontSize: 12, color: 'var(--at-danger)' }}>No se pudieron cargar las reservas: {error}</div>
  }

  if (value) {
    return (
      <div data-testid="reserva-elegida" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, minWidth: 0 }}>
        <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>🔖 {elegida ? `${etiquetaReserva(elegida)} · ${elegida.unidad_nombre ?? 'sin unidad'} (${ESTADO_LABEL[elegida.estado]})`
          : resumen && resumen.reserva_id === value ? `${etiquetaReserva(resumen)}${resumen.estado ? ` (${resumen.estado.replace('_', ' ')})` : ''}`
          : `Reserva ${value.slice(0, 8)}`}</span>
        {!disabled && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => { onChange(null, null); setAbierto(true) }} style={btnChico}>Cambiar</button>
            <button type="button" onClick={() => onChange(null, null)} style={{ ...btnChico, color: 'var(--at-ink-3)' }}>Quitar</button>
          </span>
        )}
      </div>
    )
  }

  const vacio = reservas?.length === 0
    ? 'No hay reservas en curso ni confirmadas en este proyecto.'
    : acotar && !texto.trim() ? `No hay reservas para ${unidadNombre ?? 'esta unidad'}.` : 'Sin coincidencias.'

  return (
    <div style={{ minWidth: 0 }}>
      <input aria-label="Buscar reserva" placeholder={cargando ? 'Cargando reservas…' : 'Código, huésped o unidad'}
        value={texto} disabled={disabled || cargando} onFocus={() => setAbierto(true)} onChange={e => { setTexto(e.target.value); setAbierto(true) }}
        style={{ width: '100%', minWidth: 0, padding: '10px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }} />
      {abierto && !cargando && reservas && (
        <ul role="listbox" aria-label="Reservas vinculables"
          style={{ listStyle: 'none', margin: '6px 0 0', padding: 4, border: '1.5px solid var(--at-line)', borderRadius: 8, background: 'var(--at-surface)', maxHeight: 260, overflowY: 'auto' }}>
          <li role="option" aria-selected={false}>
            <button type="button" onClick={() => { onChange(null, null); setAbierto(false); setTexto('') }}
              style={{ width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--at-ink-3)' }}>— Sin reserva —</button>
          </li>
          {lista.length === 0 && <li style={{ padding: '8px 10px', fontSize: 12, color: 'var(--at-ink-3)' }}>{vacio}</li>}
          {lista.map(r => (
            <li key={r.id} role="option" aria-selected={false} style={{ borderTop: '1px solid var(--at-line)' }}>
              <button type="button" onClick={() => { onChange(r.id, r); setAbierto(false); setTexto('') }}
                style={{ width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--at-ink)', display: 'block' }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>🔖 {etiquetaReserva(r)}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                  {r.unidad_nombre ?? 'sin unidad'} · {ESTADO_LABEL[r.estado]} · {r.plataforma}
                </span>
              </button>
            </li>
          ))}
          {unidadId && (ocultas > 0 || verTodas) && (
            <li style={{ borderTop: '1px solid var(--at-line)', padding: '6px 6px 2px' }}>
              <button type="button" onClick={() => setVerTodas(v => !v)}
                style={{ ...btnChico, width: '100%', color: 'var(--at-primary)' }}>
                {verTodas ? `Solo las de ${unidadNombre ?? 'la unidad elegida'}` : `Ver reservas de otras unidades (${ocultas})`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

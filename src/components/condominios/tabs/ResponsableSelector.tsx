// Selector del responsable de un servicio de housekeeping: un buscador sobre el
// catálogo de ELEGIBLES del proyecto (RPC hk_responsables_elegibles). No ofrece a
// nadie más; y aunque alguien mandara otro id por la API, la base lo rechaza.
import { useMemo, useState, type CSSProperties } from 'react'
import type { AppUser } from '../../../domain/usuarios/queries'
import { filtrarElegibles, type EstadoResponsable } from '../../../domain/condominios/housekeepingResponsable'
import { UsuarioChip } from '../../shared/UsuarioChip'

interface Props {
  elegibles: AppUser[] | null
  cargando: boolean
  /** Error al pedir el catálogo (p. ej. sin autorización en este proyecto). */
  error: string | null
  value: string | null
  onChange: (userId: string | null) => void
  /** Usuario conectado: se marca «(tú)» en la lista. */
  userId: string
  disabled?: boolean
}

const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

export function ResponsableSelector({ elegibles, cargando, error, value, onChange, userId, disabled }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState(false)
  const lista = useMemo(() => filtrarElegibles(elegibles ?? [], busqueda), [elegibles, busqueda])
  const elegido = value ? elegibles?.find(u => u.id === value) ?? null : null

  if (error) {
    return <div role="alert" style={{ fontSize: 12, color: 'var(--at-danger)' }}>No se pudo cargar la lista de responsables: {error}</div>
  }

  return (
    <div>
      {elegido ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }} data-testid="responsable-elegido">
          <span style={{ fontWeight: 600 }}>{elegido.full_name}{elegido.id === userId ? ' (tú)' : ''}</span>
          <span style={{ color: 'var(--at-ink-3)', fontSize: 11 }}>· {elegido.role}</span>
          {!disabled && (
            <button type="button" onClick={() => { onChange(null); setAbierto(true) }}
              style={{ marginLeft: 'auto', padding: '2px 8px', border: '1.5px solid var(--at-line)', borderRadius: 6, background: 'var(--at-surface)', fontSize: 11, cursor: 'pointer' }}>
              Cambiar
            </button>
          )}
        </div>
      ) : (
        <>
          <input
            style={inputStyle}
            aria-label="Buscar responsable"
            placeholder={cargando ? 'Cargando usuarios…' : 'Buscar por nombre o rol'}
            value={busqueda}
            disabled={disabled || cargando}
            onChange={e => { setBusqueda(e.target.value); setAbierto(true) }}
            onFocus={() => setAbierto(true)}
          />
          {abierto && !cargando && (
            <ul role="listbox" aria-label="Responsables elegibles"
              style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 180, overflowY: 'auto', border: '1.5px solid var(--at-line)', borderRadius: 8, background: 'var(--at-surface)' }}>
              {lista.length === 0 && (
                <li style={{ padding: '8px 10px', fontSize: 12, color: 'var(--at-ink-3)' }}>
                  {elegibles && elegibles.length === 0 ? 'Nadie es elegible en este proyecto.' : 'Sin coincidencias.'}
                </li>
              )}
              {lista.map(u => (
                <li key={u.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => { onChange(u.id); setBusqueda(''); setAbierto(false) }}
                    style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--at-ink)' }}>
                    {u.full_name}{u.id === userId ? ' (tú)' : ''} <span style={{ color: 'var(--at-ink-3)', fontSize: 11 }}>· {u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Línea «Responsable» de una tarjeta o del detalle. Distingue al responsable del
 * autor de las evidencias (iniciado/completado/fotos, que muestran sus propios chips).
 */
export function ResponsableLinea({ estado }: { estado: EstadoResponsable }) {
  switch (estado.kind) {
    case 'vinculado':
      return <div>👤 Responsable: <UsuarioChip userId={estado.userId} nombre={estado.nombre} /></div>
    case 'requiere_reasignacion':
      return (
        <div>
          👤 Responsable: <UsuarioChip userId={estado.userId} />{' '}
          <span title="Esta persona ya no tiene acceso a este proyecto o al módulo; elige otro responsable."
            style={{ padding: '1px 6px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' }}>
            requiere reasignación
          </span>
        </div>
      )
    case 'anterior_sin_vincular':
      return <div title="Nombre escrito antes de la asignación por usuario; no está vinculado a ninguna cuenta.">👤 Responsable anterior sin vincular: {estado.texto}</div>
    case 'sin_responsable':
      return null
  }
}

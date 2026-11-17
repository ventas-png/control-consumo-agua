// Selector de cliente con buscador. Reemplaza al <select> con todos los clientes
// de la empresa, que con cientos de nombres obligaba a recorrer la lista a mano.
//
// - Se busca por nombre, código, teléfono, correo, DPI o NIT, sin distinguir
//   acentos ni mayúsculas (ver domain/clientes/busqueda).
// - El cliente elegido se ve como ficha con «Cambiar» y «Quitar». «Cambiar» no
//   suelta al actual hasta que se elige otro: Escape o «Cancelar» lo conservan.
// - La lista de resultados va en el flujo de la página, no flotando: dentro de
//   una ventana con scroll una lista absoluta quedaba cortada.
// - Escape con la lista abierta cierra solo la lista (preventDefault), no la
//   ventana: EditModal ignora un Escape ya atendido.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Cliente } from '../../types'
import { buscarClientes } from '../../domain/clientes/busqueda'

export const MAX_RESULTADOS = 50

const entradaPorDefecto: CSSProperties = {
  padding: '10px 14px', border: '2px solid var(--at-line)', borderRadius: 8, fontSize: 14,
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none',
  background: 'var(--at-surface)', color: 'var(--at-ink)',
}

const botonTexto: CSSProperties = {
  border: '1.5px solid var(--at-line)', borderRadius: 6, background: 'var(--at-surface)',
  color: 'var(--at-ink-2)', padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

interface Props {
  clientes: readonly Cliente[]
  /** id del cliente; '' = sin cliente. */
  value: string
  onChange: (clienteId: string) => void
  /** Nombre accesible del buscador. */
  label?: string
  placeholder?: string
  disabled?: boolean
  /** Estilo de la caja de texto, para que combine con el formulario anfitrión. */
  estiloEntrada?: CSSProperties
}

/** Teléfono · correo, lo que haya, para distinguir homónimos. */
function detalle(c: Cliente): string {
  return [c.telefono || c.whatsapp, c.email].filter(Boolean).join(' · ')
}

export function ClienteSelector({
  clientes, value, onChange, label = 'Buscar cliente',
  placeholder = 'Buscar por nombre, código, teléfono, correo, DPI o NIT…',
  disabled = false, estiloEntrada = entradaPorDefecto,
}: Props) {
  const uid = useId()
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState(false)
  const [activo, setActivo] = useState(0)
  const refEntrada = useRef<HTMLInputElement>(null)
  const refLista = useRef<HTMLUListElement>(null)

  const seleccionado = useMemo(() => (value ? clientes.find(c => c.id === value) ?? null : null), [clientes, value])
  const coincidencias = useMemo(() => buscarClientes(clientes, texto), [clientes, texto])
  const visibles = coincidencias.slice(0, MAX_RESULTADOS)
  const mostrarBuscador = !value || editando

  // La opción activa siempre a la vista al moverse con las flechas.
  useEffect(() => {
    if (!abierto) return
    const el = refLista.current?.querySelector<HTMLElement>(`[data-indice="${activo}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activo, abierto])

  function enfocarBuscador() {
    setTimeout(() => refEntrada.current?.focus(), 0)
  }

  function elegir(c: Cliente) {
    onChange(c.id)
    setTexto('')
    setAbierto(false)
    setEditando(false)
    setActivo(0)
  }

  function cancelarCambio() {
    setTexto('')
    setAbierto(false)
    setEditando(false)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!abierto) { setAbierto(true); return }
      setActivo(a => Math.min(a + 1, visibles.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      // Nunca envía el formulario desde el buscador.
      e.preventDefault()
      if (abierto && visibles[activo]) elegir(visibles[activo])
    } else if (e.key === 'Escape') {
      if (abierto) { e.preventDefault(); setAbierto(false) }
      else if (editando) { e.preventDefault(); cancelarCambio() }
    }
  }

  const idLista = `${uid}-lista`

  return (
    <div>
      {!mostrarBuscador && (
        <div
          data-testid="cliente-seleccionado"
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px',
                   border: '2px solid var(--at-line)', borderRadius: 8, background: 'var(--at-surface-2)' }}
        >
          <span aria-hidden="true">👤</span>
          <div style={{ minWidth: 0, flex: '1 1 200px' }}>
            {seleccionado ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>
                  {seleccionado.nombre}
                  {seleccionado.codigo && <span style={{ fontWeight: 500, color: 'var(--at-ink-3)' }}> · {seleccionado.codigo}</span>}
                </div>
                {detalle(seleccionado) && (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', overflowWrap: 'anywhere' }}>{detalle(seleccionado)}</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>
                El cliente asignado ya no está en la lista de clientes de la empresa.
              </div>
            )}
          </div>
          {!disabled && (
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button type="button" style={botonTexto} onClick={() => { setEditando(true); setAbierto(true); setActivo(0); enfocarBuscador() }}>
                Cambiar
              </button>
              <button type="button" style={{ ...botonTexto, color: 'var(--at-danger)' }} onClick={() => { onChange(''); setAbierto(false) }}>
                Quitar
              </button>
            </div>
          )}
        </div>
      )}

      {mostrarBuscador && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={refEntrada}
              type="search"
              role="combobox"
              aria-label={label}
              aria-expanded={abierto}
              aria-controls={idLista}
              aria-autocomplete="list"
              aria-activedescendant={abierto && visibles[activo] ? `${uid}-op-${visibles[activo].id}` : undefined}
              autoComplete="off"
              value={texto}
              disabled={disabled}
              placeholder={placeholder}
              onChange={e => { setTexto(e.target.value); setAbierto(true); setActivo(0) }}
              onFocus={() => setAbierto(true)}
              onBlur={() => setAbierto(false)}
              onKeyDown={onKey}
              style={{ ...estiloEntrada, flex: 1, minWidth: 0 }}
            />
            {editando && (
              <button type="button" style={botonTexto} onClick={cancelarCambio}>Cancelar</button>
            )}
          </div>

          {!abierto && !value && (
            <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>Sin cliente asignado</div>
          )}

          {abierto && (
            <ul
              ref={refLista}
              id={idLista}
              role="listbox"
              aria-label="Clientes"
              style={{ listStyle: 'none', margin: '6px 0 0', padding: 4, maxHeight: 280, overflowY: 'auto',
                       border: '1.5px solid var(--at-line)', borderRadius: 8, background: 'var(--at-surface)',
                       boxShadow: '0 6px 18px rgba(0,0,0,0.08)' }}
            >
              {visibles.length === 0 && (
                <li role="presentation" style={{ padding: 10, fontSize: 13, color: 'var(--at-ink-3)' }}>
                  {clientes.length === 0
                    ? 'Todavía no hay clientes. Regístralos en Clientes.'
                    : 'Sin coincidencias. Se busca por nombre, código, teléfono, correo, DPI o NIT.'}
                </li>
              )}
              {visibles.map((c, i) => (
                <li
                  key={c.id}
                  id={`${uid}-op-${c.id}`}
                  data-indice={i}
                  role="option"
                  aria-selected={c.id === value}
                  // mouseDown + preventDefault: elige antes de que el blur cierre la lista.
                  onMouseDown={e => { e.preventDefault(); elegir(c) }}
                  onMouseEnter={() => setActivo(i)}
                  style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                           background: i === activo ? 'var(--at-chip)' : 'transparent' }}
                >
                  <div style={{ fontSize: 14, color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>
                    <strong style={{ fontWeight: 600 }}>{c.nombre}</strong>
                    {c.codigo && <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}> · {c.codigo}</span>}
                    {c.id === value && <span style={{ color: 'var(--at-accent)', fontSize: 12 }}> · actual</span>}
                  </div>
                  {detalle(c) && <div style={{ fontSize: 12, color: 'var(--at-ink-3)', overflowWrap: 'anywhere' }}>{detalle(c)}</div>}
                </li>
              ))}
              {coincidencias.length > MAX_RESULTADOS && (
                <li role="presentation" style={{ padding: '8px 10px', fontSize: 12, color: 'var(--at-ink-3)', borderTop: '1px solid var(--at-line)' }}>
                  Mostrando {MAX_RESULTADOS} de {coincidencias.length}. Escribe más para acotar.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

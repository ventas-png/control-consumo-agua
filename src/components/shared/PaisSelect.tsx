import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { banderaPais, buscarPaises, etiquetaPais } from '../../domain/shared/paises'

interface Props {
  /** Código ISO 3166-1 alfa-2; '' = sin especificar. */
  value: string
  onChange: (codigo: string) => void
  id?: string
  /** Estilo del campo de texto (el mismo que el resto del formulario). */
  style?: CSSProperties
  disabled?: boolean
  placeholder?: string
}

/**
 * País por búsqueda: se escribe parte del nombre («guat», «esta», «us») y se
 * elige de la lista; no acepta texto libre. Con teclado: flechas, Enter y Esc.
 */
export function PaisSelect({ value, onChange, id, style, disabled, placeholder = 'Buscar país…' }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [activo, setActivo] = useState(0)
  const raiz = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLUListElement>(null)
  const idLista = useId()
  const opciones = useMemo(() => buscarPaises(texto), [texto])

  const cerrar = () => { setAbierto(false); setTexto('') }
  const abrir = () => { if (!abierto) { setAbierto(true); setTexto(''); setActivo(0) } }
  const elegir = (codigo: string) => { onChange(codigo); cerrar() }

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) cerrar() }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  // Dentro de un modal con scroll la lista puede abrir fuera de la vista: se trae.
  useEffect(() => { if (abierto) lista.current?.scrollIntoView?.({ block: 'nearest' }) }, [abierto])

  useEffect(() => {
    if (abierto) lista.current?.querySelector<HTMLElement>(`[data-indice="${activo}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activo, abierto])

  const alTeclear = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!abierto) { setAbierto(true); return }
      const n = opciones.length
      if (n > 0) setActivo(i => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (e.key === 'Enter') {
      if (!abierto) return
      e.preventDefault()
      const p = opciones[activo]
      if (p) elegir(p.codigo)
    } else if (e.key === 'Escape' && abierto) {
      e.preventDefault(); e.stopPropagation()
      cerrar()
    } else if (!abierto && (e.key.length === 1 || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Con el foco ya puesto y la lista cerrada, escribir empieza una búsqueda nueva (no edita el nombre mostrado).
      abrir()
    }
  }

  return (
    <div ref={raiz} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        <input
          id={id} type="text" role="combobox" autoComplete="off" disabled={disabled}
          aria-expanded={abierto} aria-controls={idLista} aria-autocomplete="list"
          aria-activedescendant={abierto && opciones[activo] ? `${idLista}-${opciones[activo].codigo}` : undefined}
          style={{ ...style, flex: '1 1 auto', minWidth: 0 }}
          placeholder={placeholder}
          value={abierto ? texto : etiquetaPais(value)}
          onFocus={abrir}
          onClick={abrir}
          onChange={e => {
            // Si aún estaba cerrada, el valor trae pegado el nombre mostrado: se descarta.
            const mostrado = etiquetaPais(value)
            const v = e.target.value
            setTexto(!abierto && mostrado && v.startsWith(mostrado) ? v.slice(mostrado.length) : v)
            setActivo(0); setAbierto(true)
          }}
          onKeyDown={alTeclear}
          onBlur={e => { if (!raiz.current?.contains(e.relatedTarget as Node | null)) cerrar() }}
        />
        {value && !disabled && (
          <button type="button" aria-label="Quitar país" title="Quitar país" onClick={() => elegir('')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--at-ink-3)', padding: '0.25rem 0.4rem' }}>
            ✕
          </button>
        )}
      </div>
      {abierto && (
        <ul ref={lista} id={idLista} role="listbox" aria-label="Países"
          style={{
            position: 'absolute', zIndex: 20, left: 0, right: 0, top: 'calc(100% + 4px)', margin: 0, padding: '0.25rem', listStyle: 'none',
            maxHeight: '14rem', overflowY: 'auto', background: 'var(--at-surface)', border: '1px solid var(--at-line-strong)',
            borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          }}>
          {opciones.length === 0 && <li style={{ padding: '0.5rem 0.6rem', color: 'var(--at-ink-3)', fontSize: '14px' }}>Ningún país coincide</li>}
          {opciones.map((p, i) => (
            <li key={p.codigo} id={`${idLista}-${p.codigo}`} role="option" aria-selected={p.codigo === value} data-indice={i}
              // mousedown, no click: el blur del campo cerraría la lista antes del click.
              onMouseDown={e => { e.preventDefault(); elegir(p.codigo) }}
              onMouseEnter={() => setActivo(i)}
              style={{
                padding: '0.45rem 0.6rem', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', color: 'var(--at-ink)',
                background: i === activo ? 'var(--at-primary-tint)' : 'transparent', fontWeight: p.codigo === value ? 600 : 400,
              }}>
              <span aria-hidden="true">{banderaPais(p.codigo)}</span> {p.nombre}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

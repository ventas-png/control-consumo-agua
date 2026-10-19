// Ventana para sumar VARIAS áreas o actividades de una vez al recorrido.
//
// Complementa al arrastre: en vez de traerlas una por una, se marcan las que
// hacen falta y entran todas juntas AL FINAL, en el orden en que se marcaron (el
// número de cada marca lo dice). Después se acomodan en el recorrido con ↑ ↓ o
// arrastrándolas.
//
// Las que ya están se ven marcadas y apagadas en vez de faltar de la lista: así
// se entiende por qué no se pueden volver a sumar. Las marcas sobreviven a la
// búsqueda y al filtro: buscar «vidrio» después de marcar «barrido» no lo pierde.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { EditModal } from '../../../shared/EditModal'

export interface OpcionVarios {
  id: string
  icono: string
  titulo: string
  detalle?: ReactNode
  /** Contra qué compara el filtro opcional (el servicio de una actividad). */
  grupo?: string
  /** Ya está donde se sumaría: se muestra marcada y apagada. */
  yaEsta: boolean
}

interface Props {
  titulo: string
  subtitulo: ReactNode
  /** En el orden en que se listan. */
  opciones: OpcionVarios[]
  /** Filtro opcional por `grupo`; el valor '' es «todos». */
  grupos?: { etiqueta: string; todos: string; valores: Array<{ id: string; texto: string }>; inicial: string }
  /** «Buscar área», «Buscar actividad». */
  buscar: string
  /** Lo que se lee junto a las que ya están. */
  textoYaEsta: string
  /** Si no hay nada que listar (sin filtro). */
  vacio: string
  /** Lo que suman las marcadas (p. ej. sus minutos), al pie. */
  resumen?: (ids: string[]) => ReactNode
  textoAgregar: (n: number) => string
  /** Recibe las marcadas en el orden en que se marcaron. */
  onAgregar: (ids: string[]) => void
  onCerrar: () => void
}

const inputStyle: CSSProperties = {
  flex: '1 1 160px', minWidth: 0, boxSizing: 'border-box', padding: '8px 11px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px',
  background: 'var(--at-surface-2)',
}
const botonTexto: CSSProperties = {
  padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer',
  fontSize: '12.5px', fontWeight: 600, color: 'var(--at-primary)', borderRadius: '6px',
}

export function SelectorVarios({
  titulo, subtitulo, opciones, grupos, buscar, textoYaEsta, vacio, resumen, textoAgregar, onAgregar, onCerrar,
}: Props) {
  const [marcadas, setMarcadas] = useState<string[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [grupo, setGrupo] = useState(grupos?.inicial ?? '')

  const q = busqueda.trim().toLowerCase()
  const visibles = opciones
    .filter(o => !grupos || !grupo || o.grupo === grupo)
    .filter(o => !q || o.titulo.toLowerCase().includes(q))
  const marcables = visibles.filter(o => !o.yaEsta && !marcadas.includes(o.id))

  const alternar = (id: string) =>
    setMarcadas(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id]))

  const filtrando = q !== '' || (grupos !== undefined && grupo !== '')

  return (
    <EditModal
      title={titulo}
      subtitle={subtitulo}
      size="sm"
      noPadding
      onClose={onCerrar}
      footer={
        <>
          <span style={{ flex: 1, minWidth: 0, fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
            {resumen && marcadas.length > 0 ? resumen(marcadas) : null}
          </span>
          <button
            onClick={onCerrar}
            style={{ padding: '8px 14px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-ink-2)' }}
          >Cancelar</button>
          <button
            onClick={() => onAgregar(marcadas)}
            disabled={marcadas.length === 0}
            style={{
              padding: '8px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px',
              fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap',
              cursor: marcadas.length === 0 ? 'default' : 'pointer', opacity: marcadas.length === 0 ? 0.5 : 1,
            }}
          >{textoAgregar(marcadas.length)}</button>
        </>
      }
    >
      {/* Búsqueda y marcas: quietas arriba mientras la lista se desplaza. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--at-surface)', padding: '14px 20px 8px', borderBottom: '1px solid var(--at-chip)' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="search"
            aria-label={buscar}
            placeholder={`${buscar}…`}
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            style={inputStyle}
          />
          {grupos && (
            <select
              aria-label={grupos.etiqueta}
              value={grupo}
              onChange={e => setGrupo(e.target.value)}
              style={{ ...inputStyle, flex: '0 1 170px' }}
            >
              <option value="">{grupos.todos}</option>
              {grupos.valores.map(v => <option key={v.id} value={v.id}>{v.texto}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', flexWrap: 'wrap', minHeight: '28px' }}>
          <span aria-live="polite" style={{ flex: 1, fontSize: '12.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>
            {marcadas.length === 0 ? 'Ninguna marcada' : `${marcadas.length} marcada${marcadas.length !== 1 ? 's' : ''}`}
          </span>
          <button
            onClick={() => setMarcadas(m => [...m, ...marcables.map(o => o.id)])}
            disabled={marcables.length === 0}
            style={{ ...botonTexto, opacity: marcables.length === 0 ? 0.4 : 1, cursor: marcables.length === 0 ? 'default' : 'pointer' }}
          >{filtrando ? 'Marcar las que se ven' : 'Marcar todas'}</button>
          {marcadas.length > 0 && (
            <button onClick={() => setMarcadas([])} style={{ ...botonTexto, color: 'var(--at-ink-3)' }}>Quitar marcas</button>
          )}
        </div>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: '8px 20px 14px', display: 'grid', gap: '5px' }}>
        {visibles.map(o => {
          const orden = marcadas.indexOf(o.id) + 1
          const marcada = orden > 0
          return (
            <li key={o.id}>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', minHeight: '44px', boxSizing: 'border-box',
                  border: `1.5px solid ${marcada ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px',
                  background: marcada ? 'var(--at-primary-soft)' : o.yaEsta ? 'var(--at-surface-2)' : 'var(--at-surface)',
                  opacity: o.yaEsta ? 0.6 : 1, cursor: o.yaEsta ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={marcada || o.yaEsta}
                  disabled={o.yaEsta}
                  onChange={() => alternar(o.id)}
                  style={{ width: '18px', height: '18px', margin: 0, flexShrink: 0, accentColor: 'var(--at-primary)' }}
                />
                <span aria-hidden style={{ fontSize: '18px' }}>{o.icono}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>{o.titulo}</span>
                  {o.detalle && <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{o.detalle}</span>}
                </span>
                {o.yaEsta && (
                  <span style={{ fontSize: '11px', color: 'var(--at-success)', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ {textoYaEsta}</span>
                )}
                {marcada && (
                  // El lugar en que va a entrar. Es una ayuda visual: el lector
                  // de pantalla ya oye «marcada», y el orden se corrige después
                  // con ↑ ↓ igual.
                  <span aria-hidden title={`Entra en el lugar ${orden}`} style={{
                    minWidth: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--at-primary)', color: 'white', fontSize: '12px', fontWeight: 800, flexShrink: 0,
                  }}>{orden}</span>
                )}
              </label>
            </li>
          )
        })}
      </ul>
      {visibles.length === 0 && (
        <div style={{ padding: '4px 20px 18px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
          {filtrando ? 'Nada coincide con la búsqueda.' : vacio}
        </div>
      )}
    </EditModal>
  )
}

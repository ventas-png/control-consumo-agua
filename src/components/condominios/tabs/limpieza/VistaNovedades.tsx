// Vista "Novedades": todo lo que el personal encontró y no le tocaba resolver.
//
// Es la razón por la que la novedad se captura EN la ruta y no en un formulario
// aparte: el operativo la reporta donde está parado, y el administrador la lee
// aquí junta, ordenada por prioridad, con la foto y el área ya asociadas.
//
// LA VISTA NO SABE DE TABLAS. Recibe `NovedadOperativa[]` ya normalizadas
// (domain/condominios/novedades) y un `onAtender` que decide el padre. Así el
// mismo listado sirve a la ruta de limpieza y a los turnos de personal, que
// guardan el hallazgo en tablas distintas pero se administran igual. Duplicar
// esta pantalla habría sido duplicar el orden por prioridad y los filtros — dos
// maneras de estar en desacuerdo.
import { useState, useMemo } from 'react'
import { ImageGallery } from '../../../shared/ImageGallery'
import type { NovedadOperativa } from '../../../../domain/condominios/novedades'
import { btn, chip, inputStyle, labelStyle, PRIORIDAD_LABEL } from './ui'

/** Para el buscador: sin acentos ni mayúsculas, para que «fundida» encuentre «Luminaria fundida». */
const sinAcentos = (t: string | null | undefined) =>
  (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

interface Props {
  /** Ya ordenadas y filtradas por el adaptador de su fuente. */
  novedades: NovedadOperativa[]
  canEdit: boolean
  /** Baja la bandera de mantenimiento en la tabla que corresponda. */
  onAtender: (novedad: NovedadOperativa) => void | Promise<void>
}

export function VistaNovedades({ novedades, canEdit, onAtender }: Props) {
  const [soloMantenimiento, setSoloMantenimiento] = useState(false)
  const [filtroPrioridad, setFiltroPrioridad] = useState('')
  const [busqueda, setBusqueda] = useState('')
  /** La que se está marcando: su botón espera en vez de aceptar un segundo toque. */
  const [atendiendo, setAtendiendo] = useState<string | null>(null)

  async function atender(nov: NovedadOperativa) {
    if (atendiendo) return
    setAtendiendo(nov.clave)
    try { await onAtender(nov) } finally { setAtendiendo(null) }
  }

  // El buscador acota por dónde (título), qué (texto), quién y fecha, sin
  // distinguir acentos. El contador de mantenimiento pendiente no se toca.
  const termino = sinAcentos(busqueda)
  const visibles = useMemo(() => novedades
    .filter(n => !soloMantenimiento || n.requiere_mantenimiento)
    .filter(n => !filtroPrioridad || n.prioridad === filtroPrioridad)
    .filter(n => !termino || [n.titulo, n.texto, n.persona, n.fecha].some(c => sinAcentos(c).includes(termino))),
  [novedades, soloMantenimiento, filtroPrioridad, termino])

  const pendientesManto = novedades.filter(n => n.requiere_mantenimiento).length

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle} htmlFor="novedades-filtro-prioridad">Prioridad</label>
          <select id="novedades-filtro-prioridad" style={{ ...inputStyle, width: '150px', maxWidth: '100%' }} value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(PRIORIDAD_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setSoloMantenimiento(v => !v)}
          style={soloMantenimiento
            ? btn('var(--at-danger-tint)', 'var(--at-danger)')
            : btn('var(--at-chip)', 'var(--at-ink-2)')}
        >
          🛠 Solo mantenimiento pendiente ({pendientesManto})
        </button>
        <input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar novedad…" aria-label="Buscar novedad"
          style={{ ...inputStyle, width: 'auto', flex: '1 1 200px', minWidth: '160px', maxWidth: '340px' }} />
      </div>

      {visibles.length === 0 && termino && novedades.length > 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)', margin: '0 0 4px' }}>Ninguna novedad coincide con «{busqueda.trim()}»</p>
          <p style={{ fontSize: '13px', margin: 0 }}>Se busca por lugar, texto, persona y fecha.</p>
        </div>
      ) : visibles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>✨</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin novedades reportadas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {visibles.map(nov => {
            const pr = nov.prioridad ? PRIORIDAD_LABEL[nov.prioridad] : null
            return (
              <div key={nov.clave} style={{
                background: nov.requiere_mantenimiento ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)',
                border: `1.5px solid ${nov.requiere_mantenimiento ? 'var(--at-danger-border)' : 'var(--at-warning-border)'}`,
                borderRadius: '12px', padding: '16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{nov.icono} {nov.titulo}</div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      {nov.fecha} · 👤 {nov.persona}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {pr && <span style={chip(pr.bg, pr.color)}>{pr.label}</span>}
                    {nov.requiere_mantenimiento && <span style={chip('var(--at-danger-tint)', 'var(--at-danger)')}>🛠 Requiere mantenimiento</span>}
                  </div>
                </div>

                <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '8px' }}>{nov.texto}</div>
                {nov.foto_urls.length > 0 && (
                  <div style={{ marginBottom: '8px' }}><ImageGallery urls={nov.foto_urls} maxVisible={4} /></div>
                )}

                {canEdit && nov.requiere_mantenimiento && (
                  <button
                    onClick={() => void atender(nov)}
                    disabled={atendiendo !== null}
                    aria-busy={atendiendo === nov.clave}
                    style={btn('var(--at-success)', 'var(--at-on-status)', { padding: '6px 14px', fontSize: '12px', fontWeight: 700, opacity: atendiendo !== null ? 0.6 : 1, cursor: atendiendo !== null ? 'default' : 'pointer' })}
                  >
                    {atendiendo === nov.clave ? 'Marcando…' : '✓ Marcar atendida'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

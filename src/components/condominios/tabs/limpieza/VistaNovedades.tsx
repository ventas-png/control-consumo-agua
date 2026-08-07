// Vista "Novedades": todo lo que el personal encontró y no le tocaba resolver.
//
// Es la razón por la que la novedad se captura EN la ruta y no en un formulario
// aparte: el operativo la reporta donde está parado, y el administrador la lee
// aquí junta, ordenada por prioridad, con la foto y el área ya asociadas.
import { useState, useMemo } from 'react'
import { updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import { notify } from '../../../shared/Dialog'
import { ImageGallery } from '../../../shared/ImageGallery'
import type { ProgramacionLimpieza, EjecucionLimpieza, PersonalCondominio } from '../../../../types'
import { btn, chip, inputStyle, labelStyle, PRIORIDAD_LABEL } from './ui'

interface Props {
  programaciones: ProgramacionLimpieza[]
  ejecuciones: EjecucionLimpieza[]
  personal: PersonalCondominio[]
  canEdit: boolean
  onRefresh: () => void
}

const PESO_PRIORIDAD: Record<string, number> = { alta: 0, media: 1, baja: 2 }

export function VistaNovedades({ programaciones, ejecuciones, personal, canEdit, onRefresh }: Props) {
  const [soloMantenimiento, setSoloMantenimiento] = useState(false)
  const [filtroPrioridad, setFiltroPrioridad] = useState('')

  const areaPorId = useMemo(() => new Map(programaciones.map(p => [p.id, p])), [programaciones])
  const nombrePersonal = useMemo(() => new Map(personal.map(p => [p.id, p.nombre])), [personal])

  const novedades = useMemo(() => {
    return ejecuciones
      .filter(e => e.novedad || e.requiere_mantenimiento)
      .filter(e => !soloMantenimiento || e.requiere_mantenimiento)
      .filter(e => !filtroPrioridad || e.prioridad === filtroPrioridad)
      .sort((a, b) =>
        (PESO_PRIORIDAD[a.prioridad ?? 'baja'] ?? 3) - (PESO_PRIORIDAD[b.prioridad ?? 'baja'] ?? 3) ||
        b.fecha.localeCompare(a.fecha),
      )
  }, [ejecuciones, soloMantenimiento, filtroPrioridad])

  /**
   * "Atender" no borra la novedad: baja la bandera de mantenimiento y deja el
   * texto. El histórico de qué falló en cada área es justo lo que hace útil
   * este listado el mes que viene.
   */
  async function marcarAtendida(ejec: EjecucionLimpieza) {
    const { error } = await updateCondominioRow('ejecuciones_limpieza', ejec.id, {
      requiere_mantenimiento: false,
    })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const pendientesManto = ejecuciones.filter(e => e.requiere_mantenimiento).length

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Prioridad</label>
          <select style={{ ...inputStyle, width: '150px' }} value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(PRIORIDAD_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <button
          onClick={() => setSoloMantenimiento(v => !v)}
          style={soloMantenimiento
            ? btn('var(--at-danger-tint)', 'var(--at-danger)')
            : btn('var(--at-chip)', 'var(--at-ink-2)')}
        >
          🛠 Solo mantenimiento pendiente ({pendientesManto})
        </button>
      </div>

      {novedades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>✨</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin novedades reportadas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {novedades.map(ejec => {
            const prog = areaPorId.get(ejec.programacion_id)
            const pr = ejec.prioridad ? PRIORIDAD_LABEL[ejec.prioridad] : null
            return (
              <div key={ejec.id} style={{
                background: ejec.requiere_mantenimiento ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)',
                border: `1.5px solid ${ejec.requiere_mantenimiento ? 'var(--at-danger-border)' : 'var(--at-warning-border)'}`,
                borderRadius: '12px', padding: '16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>🧹 {prog?.area ?? 'Área eliminada'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      {ejec.fecha} · 👤 {ejec.personal_id ? (nombrePersonal.get(ejec.personal_id) ?? 'Empleado dado de baja') : 'Sin asignar'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {pr && <span style={chip(pr.bg, pr.color)}>{pr.label}</span>}
                    {ejec.requiere_mantenimiento && <span style={chip('var(--at-danger-tint)', 'var(--at-danger)')}>🛠 Requiere mantenimiento</span>}
                  </div>
                </div>

                {ejec.novedad && <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '8px' }}>{ejec.novedad}</div>}
                {ejec.foto_urls.length > 0 && (
                  <div style={{ marginBottom: '8px' }}><ImageGallery urls={ejec.foto_urls} maxVisible={4} /></div>
                )}

                {canEdit && ejec.requiere_mantenimiento && (
                  <button onClick={() => marcarAtendida(ejec)} style={btn('var(--at-success)', 'var(--at-on-status)', { padding: '6px 14px', fontSize: '12px', fontWeight: 700 })}>
                    ✓ Marcar atendida
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

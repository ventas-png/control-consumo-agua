// Vista de SOLO LECTURA del catálogo de áreas para los tabs que lo consumen.
//
// Reemplaza al CRUD que Rutas Ronda y Limpieza montaban embebido: el catálogo
// se sigue viendo desde donde se usa (armar una ruta sin ver las áreas es
// incómodo), pero darlo de alta pasa a ser una sola puerta — el tab "Áreas".
// Quien puede verlo recibe el botón que lleva ahí; quien no, la instrucción de
// a quién pedírselo, que es más útil que un botón que va a fallar.
import type { AreaCondominio } from '../../types'
import { EmptyState } from '../shared/EmptyState'

interface Props {
  areas: AreaCondominio[]
  /** Para qué las usa el tab anfitrión ("los puntos de control de cada ruta"). */
  uso: string
  /**
   * Navega al tab "Áreas". `undefined` = el usuario no tiene visibilidad de ese
   * tab: se le explica dónde se administran en vez de ofrecerle un atajo vedado.
   */
  onConfigurar?: () => void
}

export function AreasResumen({ areas, uso, onConfigurar }: Props) {
  const activas = [...areas]
    .filter(a => a.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const inactivas = areas.length - activas.length

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '12px', flexWrap: 'wrap', marginBottom: '14px',
        background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
        borderRadius: '12px', padding: '12px 14px',
      }}>
        <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
          Catálogo compartido del condominio. Aquí se <strong>eligen</strong> para {uso};
          se dan de alta en el tab <strong>Áreas</strong>.
        </div>
        {onConfigurar
          ? (
            <button
              onClick={onConfigurar}
              style={{
                padding: '8px 14px', background: 'var(--at-surface)',
                border: '1.5px solid var(--at-accent)', borderRadius: '8px',
                color: 'var(--at-accent)', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              📍 Configurar áreas
            </button>
          )
          : (
            <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>
              Sin acceso al tab Áreas — pídeselo al administrador.
            </span>
          )}
      </div>

      {activas.length === 0 ? (
        <EmptyState
          icon="📍"
          title="Sin áreas activas"
          description="Las áreas del condominio se crean en el tab Áreas; desde ahí quedan disponibles para rondas, limpieza, plantillas y tareas."
        />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
            {activas.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                background: 'var(--at-surface)', border: '1px solid var(--at-line)',
                borderRadius: '12px', padding: '12px',
              }}>
                <span style={{
                  fontSize: '22px', width: '36px', height: '36px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--at-accent-tint-2)', borderRadius: '9px',
                }}>{a.icono}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</div>
                  {a.descripcion && (
                    <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.descripcion}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {inactivas > 0 && (
            <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '10px' }}>
              {inactivas} área{inactivas === 1 ? '' : 's'} inactiva{inactivas === 1 ? '' : 's'}: no se ofrecen al capturar,
              pero los registros que ya las usan las siguen mostrando.
            </div>
          )}
        </>
      )}
    </div>
  )
}

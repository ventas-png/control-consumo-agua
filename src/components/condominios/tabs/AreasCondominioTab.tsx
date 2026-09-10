// Tab "Áreas" — EL lugar donde se dan de alta las áreas del condominio.
//
// El catálogo (`areas_condominio`) siempre fue uno solo, pero su CRUD estaba
// montado dos veces: dentro de Rutas Ronda y dentro de Limpieza. Mismo
// componente, misma tabla, y aun así confundía: quien creaba un área desde
// Limpieza no sabía que estaba tocando el catálogo de las rondas, y quien no
// la encontraba donde la creó la volvía a crear. Este tab es la respuesta:
// aquí se crea, se edita, se desactiva y se borra; los demás tabs SOLO eligen
// del catálogo (rutas, programaciones de limpieza, plantillas y tareas).
//
// El tab no agrega lógica sobre AreasCatalog: le pone contexto (dónde se usan
// las áreas, qué significa desactivar) y sus KPIs. El CRUD, las validaciones
// de duplicado y el manejo de FK en uso siguen viviendo en el componente
// compartido.
import { AreasCatalog } from '../AreasCatalog'
import type { AreaCondominio } from '../../../types'

interface Props {
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

/** Los tabs que CONSUMEN el catálogo, para que se vea el alcance de un alta. */
const CONSUMIDORES = [
  { icon: '🗺️', label: 'Rutas de ronda', detalle: 'puntos de control' },
  { icon: '🧹', label: 'Limpieza',       detalle: 'programaciones y ruta del día' },
  { icon: '📋', label: 'Plantillas',     detalle: 'actividades por cargo' },
  { icon: '✅', label: 'Tareas',         detalle: 'tareas del condominio' },
]

export function AreasCondominioTab({ areas, proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const activas = areas.filter(a => a.activo).length

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Áreas del condominio</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
          {areas.length} áreas · {activas} activas · se configuran una vez y se usan en todo el módulo
        </p>
      </div>

      <div style={{
        background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-line)',
        borderRadius: '14px', padding: '14px 16px', marginBottom: '20px',
      }}>
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
          Este es el único lugar donde se crean. Los demás tabs las eligen de aquí:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {CONSUMIDORES.map(c => (
            <span key={c.label} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: 'var(--at-surface)', border: '1px solid var(--at-line)',
              borderRadius: '999px', padding: '5px 12px', fontSize: '12px', color: 'var(--at-ink-2)',
            }}>
              <span>{c.icon}</span>
              <strong style={{ fontWeight: 700 }}>{c.label}</strong>
              <span style={{ color: 'var(--at-ink-3)' }}>· {c.detalle}</span>
            </span>
          ))}
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '10px' }}>
          Un área en uso no se puede eliminar: se desactiva. Deja de ofrecerse al capturar y los
          registros históricos la siguen mostrando.
        </div>
      </div>

      <AreasCatalog
        areas={areas}
        proyectoId={proyectoId}
        companyId={companyId}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        onRefresh={onRefresh}
      />
    </div>
  )
}

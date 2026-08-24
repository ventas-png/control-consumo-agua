// Tab Limpieza — cuatro vistas sobre el mismo dato:
//
//   Áreas       programaciones + a quién le toca cada área (persona, o perfil
//               turno+cargo), con asignación en bloque. Desde 20260904000000
//               el área se elige del catálogo canónico (`areas_condominio`).
//   Catálogo    el catálogo compartido de áreas (el mismo CRUD que usa Rondas
//               en seguridad), para dar de alta/baja áreas sin salir del tab.
//   Actividades el catálogo compartido de actividades (ActividadesCatalog, el
//               mismo componente del tab Plantillas), filtrado de entrada por
//               servicio = limpieza y en modo consulta: la administración vive
//               en Seguridad → Plantillas y no se duplica aquí. La RLS de
//               20260904000100/000200 acepta `prog_limpieza` en el SELECT, así
//               que se lee sin permisos del módulo Seguridad.
//   Ruta        lo que le toca hoy a cada empleado, con foto de evidencia y
//               cierre área por área.
//   Novedades   lo que se encontró de paso y necesita mantenimiento.
//
// Antes el tab era solo el catálogo, con `responsable` como texto libre: se
// programaba la limpieza pero no se podía repartir entre la plantilla ya
// cargada en Personal, ni verificar que se hizo. Las vistas cubren el ciclo
// completo — programar, ejecutar con evidencia, escalar el hallazgo.
import { useState, useMemo } from 'react'
import { hoyLocalISO } from '../../../lib/format'
import type {
  AreaCondominio, EjecucionLimpieza, ItemInventario, PersonalCondominio,
  PlantillaTareaCargo, ProgramacionLimpieza, SuministroCondominio,
} from '../../../types'
import { AreasCatalog } from '../AreasCatalog'
import { ActividadesCatalog } from '../ActividadesCatalog'
import { VistaAreas } from './limpieza/VistaAreas'
import { VistaRuta } from './limpieza/VistaRuta'
import { VistaNovedades } from './limpieza/VistaNovedades'
import { sumarDias } from '../../../domain/condominios/limpieza'

interface Props {
  programaciones: ProgramacionLimpieza[]
  ejecuciones: EjecucionLimpieza[]
  personal: PersonalCondominio[]
  areas: AreaCondominio[]
  plantillas: PlantillaTareaCargo[]
  suministros: SuministroCondominio[]
  inventario: ItemInventario[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

type Vista = 'areas' | 'catalogo' | 'actividades' | 'ruta' | 'novedades'

const VISTAS: { id: Vista; label: string; icon: string }[] = [
  { id: 'areas',       label: 'Áreas',     icon: '🧹' },
  { id: 'catalogo',    label: 'Catálogo de áreas', icon: '📍' },
  { id: 'actividades', label: 'Actividades', icon: '📋' },
  { id: 'ruta',        label: 'Ruta del día', icon: '🗓️' },
  { id: 'novedades',   label: 'Novedades', icon: '⚠️' },
]

export function ProgramacionLimpiezaTab({
  programaciones, ejecuciones, personal, areas, plantillas, suministros, inventario,
  proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh,
}: Props) {
  const [vista, setVista] = useState<Vista>('areas')

  const kpis = useMemo(() => {
    const hoy = hoyLocalISO()
    const en3 = sumarDias(hoy, 3)
    const activas = programaciones.filter(p => p.activo)
    const vencidas = activas.filter(p => p.proxima_ejecucion && p.proxima_ejecucion < hoy).length
    const proximas = activas.filter(p => p.proxima_ejecucion && p.proxima_ejecucion >= hoy && p.proxima_ejecucion <= en3).length
    const sinAsignar = activas.filter(p => !p.personal_id && !p.turno && !p.cargo && !p.responsable).length
    const delDia = ejecuciones.filter(e => e.fecha === hoy)
    const pendientesHoy = delDia.filter(e => e.estado === 'pendiente').length
    const novedades = ejecuciones.filter(e => e.requiere_mantenimiento).length
    return { vencidas, proximas, sinAsignar, pendientesHoy, novedades, totalHoy: delDia.length }
  }, [programaciones, ejecuciones])

  return (
    <div style={{ padding: '20px', maxWidth: '1060px', margin: '0 auto' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        {[
          { label: 'Vencidas', value: kpis.vencidas, icon: '🔴', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
          { label: 'Próximas (≤3d)', value: kpis.proximas, icon: '🟡', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
          { label: 'Sin asignar', value: kpis.sinAsignar, icon: '👤', bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
          { label: `Pendientes hoy (de ${kpis.totalHoy})`, value: kpis.pendientesHoy, icon: '🗓️', bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
          { label: 'Requieren manto.', value: kpis.novedades, icon: '🛠', bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', marginBottom: '2px' }}>{k.icon}</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Selector de vista */}
      <div role="tablist" aria-label="Vistas de limpieza" style={{ display: 'flex', gap: '6px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {VISTAS.map(v => (
          <button
            key={v.id}
            role="tab"
            aria-selected={vista === v.id}
            onClick={() => setVista(v.id)}
            style={{
              padding: '8px 16px',
              background: vista === v.id ? 'var(--at-primary)' : 'var(--at-chip)',
              color: vista === v.id ? 'white' : 'var(--at-ink-2)',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontSize: '13px', fontWeight: 700,
            }}
          >
            {v.icon} {v.label}
            {v.id === 'novedades' && kpis.novedades > 0 && ` (${kpis.novedades})`}
          </button>
        ))}
      </div>

      {vista === 'areas' && (
        <VistaAreas
          programaciones={programaciones}
          personal={personal}
          areas={areas}
          proyectoId={proyectoId}
          companyId={companyId}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          onRefresh={onRefresh}
        />
      )}
      {vista === 'actividades' && (
        // MISMO componente que el tab Plantillas: un solo catálogo, sin
        // implementación paralela. Aquí abre filtrado por servicio=limpieza y
        // en consulta (soloLectura); administrarlo sigue siendo de Plantillas.
        <ActividadesCatalog
          plantillas={plantillas}
          areas={areas}
          suministros={suministros}
          inventario={inventario}
          proyectoId={proyectoId}
          companyId={companyId}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          onRefresh={onRefresh}
          servicioInicial="limpieza"
          soloLectura
          titulo="Actividades de limpieza"
          subtitulo="Catálogo compartido de actividades, filtrado por servicio de limpieza."
        />
      )}
      {vista === 'catalogo' && (
        // El mismo componente que usa Rondas: un solo catálogo, un solo CRUD.
        // Los permisos son los del tab anfitrión (prog_limpieza); la BD acepta
        // la escritura desde este tab desde 20260904000000.
        <AreasCatalog
          areas={areas}
          proyectoId={proyectoId}
          companyId={companyId}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          onRefresh={onRefresh}
        />
      )}
      {vista === 'ruta' && (
        <VistaRuta
          programaciones={programaciones}
          ejecuciones={ejecuciones}
          personal={personal}
          proyectoId={proyectoId}
          companyId={companyId}
          canCreate={canCreate}
          canEdit={canEdit}
          onRefresh={onRefresh}
        />
      )}
      {vista === 'novedades' && (
        <VistaNovedades
          programaciones={programaciones}
          ejecuciones={ejecuciones}
          personal={personal}
          canEdit={canEdit}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

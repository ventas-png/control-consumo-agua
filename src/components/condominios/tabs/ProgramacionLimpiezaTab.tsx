// Tab Limpieza — cuatro vistas sobre el mismo trabajo (20261103000000):
//
//   Calendario   cada empleado con sus turnos del mes; sobre cada día se le
//                asignan rutinas, arrastrando o con ＋. Asignar CREA las tareas
//                del recorrido en ese turno: no hay que «generar» después.
//   Rutinas      los recorridos (20261102000000): las áreas en orden y, en cada
//                una, sus actividades. Es la DEFINICIÓN de lo que se asigna.
//   Ruta del día lo asignado para un día, para ejecutarlo con evidencia y cierre
//                (el tablero de «Tareas por turno» en modo ruta, sin copia).
//   Novedades    lo que se encontró al ejecutar las rutinas y necesita
//                mantenimiento.
//
// Los indicadores de arriba salen de las mismas tareas: lo atrasado de la
// semana, lo de hoy, y los turnos de hoy que nadie programó.
//
// Antes había además «Áreas» (programar cada área con frecuencia y responsable,
// sobre programacion_limpieza → ejecuciones_limpieza), «Áreas del catálogo» y
// «Actividades». El calendario reemplaza a la primera; las otras dos eran
// consultas de catálogos que se administran en el tab Áreas y en Plantillas, y
// se consultan allá. Las filas del motor anterior quedan como historia.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { hoyLocalISO } from '../../../lib/format'
import type {
  AreaCondominio, BloqueTurno, CargoCatalogo, EstadoBloqueTurno, PersonalCondominio,
  PlantillaTareaCargo, TareaBloque, TurnoCalendarioLimpieza,
} from '../../../types'
import { VistaCalendario } from './limpieza/VistaCalendario'
import { VistaRutinas } from './limpieza/VistaRutinas'
import { VistaRutaDia } from './limpieza/VistaRutaDia'
import { VistaNovedades } from './limpieza/VistaNovedades'
import { sumarDias } from '../../../domain/condominios/limpieza'
import { kpisLimpieza } from '../../../domain/condominios/calendarioLimpieza'
import { novedadesDeTareas, type NovedadOperativa } from '../../../domain/condominios/novedades'
import { fetchCalendarioLimpieza, fetchNovedadesRutinas } from '../../../domain/condominios/tabQueries'
import { atenderNovedad } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'

interface Props {
  personal: PersonalCondominio[]
  /** Catálogo de cargos del condominio (Configuración RRHH), para nombrarlos. */
  cargos?: CargoCatalogo[]
  areas: AreaCondominio[]
  plantillas: PlantillaTareaCargo[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

type Vista = 'calendario' | 'rutinas' | 'ruta' | 'novedades'

const VISTAS: { id: Vista; label: string; icon: string }[] = [
  { id: 'calendario', label: 'Calendario',   icon: '🗓️' },
  { id: 'rutinas',    label: 'Rutinas',      icon: '🧭' },
  { id: 'ruta',       label: 'Ruta del día', icon: '🧹' },
  { id: 'novedades',  label: 'Novedades',    icon: '⚠️' },
]

/** Días hacia atrás que cuentan como «atrasado» y que alimentan las novedades. */
const DIAS_ATRASO = 7
const DIAS_NOVEDADES = 30

export function ProgramacionLimpiezaTab({
  personal, areas, plantillas, proyectoId, companyId, userId,
  canCreate, canEdit, canDelete, onRefresh, cargos = [],
}: Props) {
  const [vista, setVista] = useState<Vista>('calendario')
  const hoy = hoyLocalISO()

  // Una sola lectura para indicadores y novedades: los turnos de los últimos 30
  // días (con el nombre de su persona) y las tareas de rutina con hallazgo.
  const [turnos, setTurnos] = useState<TurnoCalendarioLimpieza[]>([])
  const [tareasNovedad, setTareasNovedad] = useState<TareaBloque[]>([])
  /** Si la lectura falla se dice: antes los indicadores quedaban en 0 como si no hubiera nada. */
  const [errorOperacion, setErrorOperacion] = useState<string | null>(null)

  const cargarOperacion = useCallback(async () => {
    const desde = sumarDias(hoy, -DIAS_NOVEDADES)
    const [cal, nov] = await Promise.all([
      fetchCalendarioLimpieza(proyectoId, desde, hoy),
      fetchNovedadesRutinas(proyectoId, desde),
    ])
    if (!cal.error) setTurnos(cal.turnos)
    if (!nov.error) setTareasNovedad(nov.tareas)
    setErrorOperacion(cal.error?.message ?? nov.error?.message ?? null)
  }, [proyectoId, hoy])

  useEffect(() => { void cargarOperacion() }, [cargarOperacion])

  const novedades = useMemo(() => {
    // Lo que novedadesDeTareas necesita del turno: fecha y persona.
    const bloques = turnos.map(t => ({
      id: t.bloque_id, personal_id: t.personal_id, personal_nombre: t.personal_nombre,
      fecha: t.fecha, estado: t.estado as EstadoBloqueTurno,
    })) as BloqueTurno[]
    return novedadesDeTareas(bloques, tareasNovedad, personal)
  }, [turnos, tareasNovedad, personal])

  const kpis = useMemo(() => {
    const k = kpisLimpieza(turnos, hoy, sumarDias(hoy, -DIAS_ATRASO))
    return { ...k, conManto: novedades.filter(n => n.requiere_mantenimiento).length }
  }, [turnos, hoy, novedades])

  /** Asignar, quitar o ejecutar cambia los indicadores; el resto del panel también lo ve. */
  const alCambiar = useCallback(() => {
    void cargarOperacion()
    onRefresh()
  }, [cargarOperacion, onRefresh])

  async function atender(novedad: NovedadOperativa) {
    const { error } = await atenderNovedad(novedad)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    alCambiar()
  }

  return (
    <div style={{ padding: '16px', maxWidth: '1060px', margin: '0 auto' }}>
      {errorOperacion && (
        <div role="alert" style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontSize: '13px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px' }}>No se pudieron cargar los indicadores ni las novedades: {errorOperacion}</span>
          <button type="button" onClick={() => void cargarOperacion()} style={{ padding: '3px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Reintentar</button>
        </div>
      )}

      {/* Indicadores: dos por fila en el teléfono */}
      <div aria-label="Indicadores de limpieza" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '12px', marginBottom: '18px' }}>
        {[
          { label: `Atrasadas (${DIAS_ATRASO} días)`, value: kpis.atrasadas, icon: '🔴', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
          { label: `Pendientes hoy (de ${kpis.totalHoy})`, value: kpis.pendientesHoy, icon: '🟡', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
          { label: 'Hechas hoy', value: kpis.hechasHoy, icon: '✅', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'Turnos de hoy sin rutina', value: kpis.turnosHoySinRutina, icon: '👤', bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
          { label: 'Requieren manto.', value: kpis.conManto, icon: '🛠', bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '14px', textAlign: 'center', minWidth: 0 }}>
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
            {v.id === 'novedades' && kpis.conManto > 0 && ` (${kpis.conManto})`}
          </button>
        ))}
      </div>

      {vista === 'calendario' && (
        <VistaCalendario
          proyectoId={proyectoId}
          companyId={companyId}
          plantillas={plantillas}
          cargos={cargos}
          canEdit={canEdit}
          onCambio={alCambiar}
        />
      )}
      {vista === 'rutinas' && (
        <VistaRutinas
          plantillas={plantillas}
          cargos={cargos}
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
        <VistaRutaDia
          proyectoId={proyectoId}
          companyId={companyId}
          userId={userId}
          personal={personal}
          plantillas={plantillas}
          areas={areas}
          cargos={cargos}
          canEdit={canEdit}
          onCambio={alCambiar}
        />
      )}
      {vista === 'novedades' && (
        <VistaNovedades
          novedades={novedades}
          canEdit={canEdit}
          onAtender={atender}
        />
      )}
    </div>
  )
}

// RUTINAS de limpieza (20260907000200), armadas como RECORRIDO (20261102000000).
//
// QUÉ ES UNA RUTINA. El recorrido que alguien va a hacer en su turno: primero
// las áreas, en orden («Apartamento 1AB → Apartamento 1C → Gradas»), y en cada
// una las actividades del catálogo que se hacen ahí. Es DEFINICIÓN — aquí no hay
// fechas, ni personal, ni tareas hechas. A quién le toca y qué día se decide en
// el Calendario (20261103000000): asignarla a un turno crea sus tareas en
// `tareas_bloque`, heredando de cada actividad su duración, checklist,
// instrucciones de seguridad y recursos planificados, con el área de su parada y
// en el orden del recorrido. («Generar tareas» por jornada, que se la daba a
// TODOS los turnos de esa jornada, dejó de ofrecerse.)
//
// EL ARMADO vive en EditorRutina: arrastrar y soltar (con botones para quien no
// puede arrastrar), el tiempo acumulado por área y contra la jornada, y un solo
// «Guardar» que persiste cabecera y recorrido — el recorrido en una transacción.
// Esta vista lista las rutinas y abre el editor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notify, confirm } from '../../../shared/Dialog'
import { EmptyState } from '../../../shared/EmptyState'
import {
  deleteCondominioRow,
  updateCondominioRow,
} from '../../../../domain/condominios/tabMutations'
import { fetchRutinasLimpieza } from '../../../../domain/condominios/tabQueries'
import {
  formatearMinutos, recorridoDesdeFilas, tiempoRecorrido,
} from '../../../../domain/condominios/rutinasRecorrido'
import { EditorRutina, type Jornada } from './EditorRutina'
import type {
  AreaCondominio,
  PlantillaTareaCargo,
  RutinaActividad,
  RutinaArea,
  RutinaLimpieza,
  CargoCatalogo,
} from '../../../../types'

interface Props {
  plantillas: PlantillaTareaCargo[]
  cargos?: CargoCatalogo[]
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

/** Cuántas áreas se nombran en la vista previa de la tarjeta antes de «+N». */
const AREAS_EN_PREVIA = 3

export function VistaRutinas({
  plantillas, areas, proyectoId, companyId,
  canCreate, canEdit, canDelete, onRefresh, cargos = [],
}: Props) {
  const [rutinas, setRutinas] = useState<RutinaLimpieza[]>([])
  const [pasos, setPasos] = useState<RutinaActividad[]>([])
  const [paradas, setParadas] = useState<RutinaArea[]>([])
  const [horarios, setHorarios] = useState<Jornada[]>([])
  const [cargaError, setCargaError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  /**
   * Editor abierto (uno a la vez). `rutina: null` = rutina nueva. `vez` remonta
   * el editor al abrir otro: su borrador es suyo y no se mezcla con el anterior.
   */
  const [editor, setEditor] = useState<{ rutina: RutinaLimpieza | null; vez: number } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { rutinas: r, pasos: p, paradas: z, horarios: h, error } = await fetchRutinasLimpieza(proyectoId, companyId)
    setRutinas(r); setPasos(p); setParadas(z); setHorarios(h)
    setCargaError(error?.message ?? null)
    setCargando(false)
  }, [proyectoId, companyId])

  useEffect(() => { void cargar() }, [cargar])

  const porPlantilla = useMemo(
    () => new Map(plantillas.map(p => [p.id, p])),
    [plantillas],
  )
  const porArea = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])
  const recorridoDe = useCallback(
    (rutinaId: string) => recorridoDesdeFilas(rutinaId, paradas, pasos),
    [paradas, pasos],
  )

  function abrir(rutina: RutinaLimpieza | null) {
    setEditor(e => ({ rutina, vez: (e?.vez ?? 0) + 1 }))
  }

  async function toggleActiva(r: RutinaLimpieza) {
    const { error } = await updateCondominioRow('rutinas_limpieza', r.id, { activa: !r.activa })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargar()
  }

  async function borrar(r: RutinaLimpieza) {
    const { paradas: nAreas, pasos: n } = tiempoRecorrido(recorridoDe(r.id), porPlantilla)
    const res = await confirm({
      title: '¿Eliminar la rutina?',
      text: n > 0 || nAreas > 0
        ? `Se eliminará «${r.nombre}» con su recorrido (${nAreas} área${nAreas !== 1 ? 's' : ''}, ${n} actividad${n !== 1 ? 'es' : ''}). Las áreas y actividades del catálogo no se tocan, y si la rutina ya generó tareas en algún turno, la base lo va a impedir.`
        : `Se eliminará la rutina «${r.nombre}».`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!res.isConfirmed) return
    const { error } = await deleteCondominioRow('rutinas_limpieza', r.id)
    if (error) {
      // 23503 = tareas_bloque_rutina_fk (RESTRICT, 20260907000300). Una rutina
      // que ya generó trabajo es historia: su baja es desactivarla.
      notify({
        variant: 'error',
        title: error.code === '23503' ? 'La rutina ya generó trabajo' : 'Error',
        text: error.code === '23503'
          ? 'Esta rutina ya tiene tareas en turnos, y esas tareas son evidencia. Desactivala en vez de borrarla: deja de generar trabajo nuevo y el historial queda intacto.'
          : error.message,
      })
      return
    }
    if (editor?.rutina?.id === r.id) setEditor(null)
    void cargar(); onRefresh()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (cargando && rutinas.length === 0) {
    return <div style={{ padding: '20px', color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando rutinas…</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--at-ink)' }}>Rutinas de limpieza</h3>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
            Cada rutina es un recorrido: las áreas en el orden en que se intervienen, y en cada una sus actividades. A quién le toca y qué día se asigna en el Calendario.
          </p>
        </div>
        {canCreate && !editor && (
          <button onClick={() => abrir(null)} style={{ padding: '8px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
            + Nueva rutina
          </button>
        )}
      </div>

      {cargaError && (
        <div role="alert" style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--at-danger-tint)', borderRadius: '8px', fontSize: '12.5px', color: 'var(--at-danger)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ flex: 1 }}>No se pudieron cargar las rutinas: {cargaError}</span>
          <button onClick={() => void cargar()} style={{ padding: '2px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Reintentar</button>
        </div>
      )}

      {editor && (
        <EditorRutina
          key={editor.vez}
          rutina={editor.rutina}
          recorridoInicial={editor.rutina ? recorridoDe(editor.rutina.id) : []}
          areas={areas}
          plantillas={plantillas}
          horarios={horarios}
          cargos={cargos}
          proyectoId={proyectoId}
          companyId={companyId}
          soloLectura={!canEdit}
          onGuardado={() => { setEditor(null); void cargar(); onRefresh() }}
          onCerrar={() => { setEditor(null); void cargar() }}
        />
      )}

      {rutinas.length === 0 && !cargaError ? (
        !editor && (
          <EmptyState
            icon="🧭"
            title="Todavía no hay rutinas"
            description="Una rutina es un recorrido: las áreas en orden y lo que se hace en cada una, para no rearmarlo cada día."
          />
        )
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {rutinas.map(r => {
            const rec = recorridoDe(r.id)
            const t = tiempoRecorrido(rec, porPlantilla)
            const nombres = rec.filter(p => p.area_id !== null).map(p => porArea.get(p.area_id!)?.nombre ?? '(área)')
            const abierta = editor?.rutina?.id === r.id
            return (
              <div key={r.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${abierta ? 'var(--at-primary)' : r.activa ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '12px', padding: '14px', opacity: r.activa ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '24px', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--at-primary-soft)', borderRadius: '9px', flexShrink: 0 }}>🧭</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)' }}>{r.nombre}</div>
                    {r.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{r.descripcion}</div>}
                    {nombres.length > 0 && (
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '4px' }} title={nombres.join(' → ')}>
                        🗺 {nombres.slice(0, AREAS_EN_PREVIA).join(' → ')}
                        {nombres.length > AREAS_EN_PREVIA && <span style={{ color: 'var(--at-ink-3)' }}> → +{nombres.length - AREAS_EN_PREVIA}</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '5px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>📍 {t.paradas} área{t.paradas !== 1 ? 's' : ''}</span>
                      <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>📋 {t.pasos} actividad{t.pasos !== 1 ? 'es' : ''}</span>
                      <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>⏱ {formatearMinutos(t.minutos)}</span>
                      {t.sinDato > 0 && (
                        <span style={{ fontSize: '11.5px', color: 'var(--at-warning-strong)' }} title="Estas actividades no declaran duración estimada: el total de la rutina se queda corto.">
                          ⚠ {t.sinDato} sin duración
                        </span>
                      )}
                      {r.horario_nombre && <span style={{ fontSize: '11.5px', color: 'var(--at-accent-hover)' }}>🕒 {r.horario_nombre}</span>}
                      {!r.activa && <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-warning-strong)' }}>Inactiva</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <button onClick={() => abrir(r)} disabled={abierta} aria-label={`${canEdit ? 'Editar' : 'Ver'} el recorrido de ${r.nombre}`} style={{ flex: 1, padding: '5px', background: abierta ? 'var(--at-primary-soft)' : 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: abierta ? 'default' : 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>
                    {canEdit ? '🧭 Editar recorrido' : '👁 Ver recorrido'}
                  </button>
                  {canEdit && (
                    <button onClick={() => void toggleActiva(r)} style={{ padding: '5px 10px', background: r.activa ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: `1px solid ${r.activa ? 'var(--at-warning-border)' : 'var(--at-success-border)'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: r.activa ? 'var(--at-warning-strong)' : 'var(--at-success)' }}>
                      {r.activa ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                  {canDelete && <button onClick={() => void borrar(r)} aria-label={`Eliminar ${r.nombre}`} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

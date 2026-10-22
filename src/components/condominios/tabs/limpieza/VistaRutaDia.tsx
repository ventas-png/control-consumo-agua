// Ruta del día de Limpieza (20261103000000): lo que cada empleado tiene asignado
// en el calendario para un día, para ejecutarlo con evidencia y cierre.
//
// No es una segunda implementación de la ejecución: monta el tablero de «Tareas
// por turno» en modo ruta (sin alta ni borrado). Evidencia, checklist, insumos,
// novedad y cierre son exactamente los de siempre, con sus controles en la base
// (trg_exigir_evidencia, cerrar_tarea_y_consumir_insumos).
//
// Qué entra: los turnos de ese día que tienen al menos una rutina asignada. Del
// turno se traen TODAS sus tareas, no sólo las de rutina: cerrar el turno calcula
// su puntaje sobre lo que ve, y con una lista parcial escribiría uno falso.
import { useCallback, useEffect, useState } from 'react'
import { fetchCalendarioLimpieza, fetchTareasDeTurnos } from '../../../../domain/condominios/tabQueries'
import { hoyLocalISO } from '../../../../lib/format'
import { TareasPersonalTab } from '../TareasPersonalTab'
import type {
  AreaCondominio, BloqueTurno, CargoCatalogo, EstadoBloqueTurno, PersonalCondominio,
  PlantillaTareaCargo, TareaBloque, TurnoCalendarioLimpieza,
} from '../../../../types'

interface Props {
  proyectoId: string
  companyId: string
  userId: string
  personal: PersonalCondominio[]
  plantillas: PlantillaTareaCargo[]
  areas: AreaCondominio[]
  cargos?: CargoCatalogo[]
  canEdit: boolean
  /** Se cerró o se avanzó algo: el tab recarga sus indicadores. */
  onCambio?: () => void
}

/** El turno del calendario con la forma que espera el tablero de tareas. */
function aBloque(t: TurnoCalendarioLimpieza, companyId: string, proyectoId: string): BloqueTurno {
  return {
    id: t.bloque_id,
    company_id: companyId,
    project_id: proyectoId,
    personal_id: t.personal_id,
    turno: t.turno,
    fecha: t.fecha,
    estado: t.estado as EstadoBloqueTurno,
    iniciado_en: t.iniciado_en,
    cerrado_en: t.cerrado_en,
    created_at: '',
    plantilla_horario_id: t.plantilla_horario_id,
    hora_inicio: t.hora_inicio,
    hora_fin: t.hora_fin,
    horas_planificadas: t.horas_planificadas,
    personal_nombre: t.personal_nombre,
    personal_cargo: t.personal_cargo ?? undefined,
  }
}

export function VistaRutaDia({
  proyectoId, companyId, userId, personal, plantillas, areas, cargos = [], canEdit, onCambio,
}: Props) {
  const [fecha, setFecha] = useState(hoyLocalISO)
  const [bloques, setBloques] = useState<BloqueTurno[]>([])
  const [tareas, setTareas] = useState<TareaBloque[]>([])
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async (dia: string) => {
    const cal = await fetchCalendarioLimpieza(proyectoId, dia, dia)
    if (cal.error) { setError(cal.error.message); return }
    const conRutina = cal.turnos.filter(t => t.rutinas.length > 0 && t.estado !== 'cancelado')
    const tar = await fetchTareasDeTurnos(conRutina.map(t => t.bloque_id))
    if (tar.error) { setError(tar.error.message); return }
    setError(null)
    setBloques(conRutina.map(t => aBloque(t, companyId, proyectoId)))
    setTareas(tar.tareas)
  }, [proyectoId, companyId])

  useEffect(() => { void cargar(fecha) }, [cargar, fecha])

  const recargar = useCallback(() => {
    void cargar(fecha)
    onCambio?.()
  }, [cargar, fecha, onCambio])

  return (
    <div>
      {error && (
        <div role="alert" style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontSize: '13px', marginBottom: '10px' }}>
          No se pudo cargar la ruta: {error}
        </div>
      )}
      <TareasPersonalTab
        bloques={bloques}
        tareas={tareas}
        plantillas={plantillas}
        personal={personal}
        areas={areas}
        cargos={cargos}
        proyectoId={proyectoId}
        companyId={companyId}
        userId={userId}
        canCreate={false}
        canEdit={canEdit}
        canDelete={false}
        onRefresh={recargar}
        modoRuta={{
          titulo: 'Ruta del día',
          subtitulo: 'Lo que cada empleado tiene asignado en el calendario. Iniciá el turno para ejecutar sus tareas, con evidencia, y cerralo al terminar.',
          onFechaChange: setFecha,
        }}
      />
    </div>
  )
}

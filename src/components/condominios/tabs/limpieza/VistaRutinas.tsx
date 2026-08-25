// Armado de RUTINAS de limpieza (20260905000200).
//
// QUÉ ES UNA RUTINA. Un conjunto ordenado de actividades del catálogo que se
// ejecuta junto: "la rutina matutina de la piscina". Es DEFINICIÓN — aquí no
// hay fechas, ni personal, ni tareas hechas. La ocurrencia del día se
// materializará en `tareas_bloque` (PR siguiente), heredando de cada actividad
// su duración, checklist, instrucciones de seguridad y recursos planificados.
//
// POR QUÉ EL SELECTOR ES `ActividadesCatalog` Y NO UN LISTADO PROPIO. Elegir
// actividades necesita exactamente lo que ese catálogo ya resuelve: filtros por
// cargo, servicio y estado, el aviso de recursos por revisar, y el panel de
// insumos/herramientas para ver qué hace falta ANTES de meter el paso en la
// rutina. Un listado propio empezaría siendo la mitad y terminaría divergiendo.
// El catálogo entra en modo `seleccion`, que apaga toda su escritura.
//
// GUARDADO. La cabecera de la rutina es un BORRADOR (nada persiste hasta
// "Guardar"). Los pasos viven fuera del formulario, en el panel de la rutina ya
// creada, y cada cambio ahí se guarda al instante — el panel lo dice. Es el
// mismo criterio que ActividadesCatalog usa con sus recursos: cancelar un
// formulario nunca debe dejar cambios ocultos ya persistidos.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notify, confirm } from '../../../shared/Dialog'
import { EmptyState } from '../../../shared/EmptyState'
import {
  createCondominioRow,
  deleteCondominioRow,
  materializarRutinasTurno,
  updateCondominioRow,
} from '../../../../domain/condominios/tabMutations'
import { fetchRutinasLimpieza } from '../../../../domain/condominios/tabQueries'
import { hoyLocalISO } from '../../../../lib/format'
import { sumarDias } from '../../../../domain/condominios/limpieza'
import { ActividadesCatalog } from '../../ActividadesCatalog'
import type {
  AreaCondominio,
  ItemInventario,
  PlantillaTareaCargo,
  ResultadoMaterializacionRutinas,
  RutinaActividad,
  RutinaLimpieza,
  SuministroCondominio,
} from '../../../../types'

interface Props {
  plantillas: PlantillaTareaCargo[]
  areas: AreaCondominio[]
  suministros: SuministroCondominio[]
  inventario: ItemInventario[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onRefresh: () => void
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  background: 'var(--at-surface-2)',
} as const
const labelStyle = {
  fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)',
  display: 'block', marginBottom: '4px',
} as const

function blankForm() {
  return { nombre: '', descripcion: '', area_id: '', plantilla_horario_id: '', orden: 0 }
}

/** "1 h 45 min" a partir de minutos; "—" si nada de la rutina declara duración. */
export function formatearDuracion(minutos: number): string {
  if (minutos <= 0) return '—'
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

export function VistaRutinas({
  plantillas, areas, suministros, inventario, proyectoId, companyId,
  canCreate, canEdit, canDelete, onRefresh,
}: Props) {
  const [rutinas, setRutinas] = useState<RutinaLimpieza[]>([])
  const [pasos, setPasos] = useState<RutinaActividad[]>([])
  const [horarios, setHorarios] = useState<Array<{ id: string; nombre: string; hora_inicio: string; hora_fin: string }>>([])
  const [cargaError, setCargaError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  /** Rutina cuyo panel de pasos está abierto (uno a la vez). */
  const [pasosDe, setPasosDe] = useState<string | null>(null)
  const [eligiendo, setEligiendo] = useState(false)

  // ── Materialización (20260905000300) ───────────────────────────────────────
  // Por defecto la semana que viene: es el horizonte con el que se trabaja, y
  // un rango corto hace evidente el resultado en vez de sepultarlo en cientos
  // de tareas. La RPC acepta hasta 400 días si alguien quiere más.
  const [desde, setDesde] = useState(hoyLocalISO())
  const [hasta, setHasta] = useState(sumarDias(hoyLocalISO(), 7))
  const [materializando, setMaterializando] = useState(false)
  const [ultimo, setUltimo] = useState<ResultadoMaterializacionRutinas | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { rutinas: r, pasos: p, horarios: h, error } = await fetchRutinasLimpieza(proyectoId, companyId)
    setRutinas(r); setPasos(p); setHorarios(h)
    setCargaError(error?.message ?? null)
    setCargando(false)
  }, [proyectoId, companyId])

  useEffect(() => { void cargar() }, [cargar])

  const porPlantilla = useMemo(
    () => new Map(plantillas.map(p => [p.id, p])),
    [plantillas],
  )
  const pasosDeRutina = useCallback(
    (rutinaId: string) =>
      pasos.filter(p => p.rutina_id === rutinaId).sort((a, b) => a.orden - b.orden),
    [pasos],
  )

  /**
   * Suma de duraciones estimadas. Se devuelve también cuántos pasos NO declaran
   * duración: sin ese dato el total miente por defecto, y quien arma la rutina
   * no tiene forma de saber que le falta información.
   */
  const duracionDe = useCallback((rutinaId: string) => {
    const propios = pasosDeRutina(rutinaId)
    let total = 0
    let sinDato = 0
    for (const paso of propios) {
      const min = porPlantilla.get(paso.plantilla_tarea_id)?.duracion_estimada_min
      if (min == null) sinDato++
      else total += min
    }
    return { total, sinDato, pasos: propios.length }
  }, [pasosDeRutina, porPlantilla])

  // ── Cabecera de la rutina (borrador hasta "Guardar") ───────────────────────

  function abrirNueva() {
    setForm(blankForm()); setEditId(null); setShowForm(true)
  }

  function startEdit(r: RutinaLimpieza) {
    setForm({
      nombre: r.nombre,
      descripcion: r.descripcion ?? '',
      area_id: r.area_id ?? '',
      plantilla_horario_id: r.plantilla_horario_id ?? '',
      orden: r.orden,
    })
    setEditId(r.id); setShowForm(true)
  }

  async function guardar() {
    const nombre = form.nombre.trim()
    if (!nombre) { notify({ variant: 'error', title: 'Error', text: 'La rutina necesita un nombre.' }); return }

    setSaving(true)
    const payload = {
      nombre,
      descripcion: form.descripcion.trim() || null,
      area_id: form.area_id || null,
      plantilla_horario_id: form.plantilla_horario_id || null,
      orden: Number(form.orden) || 0,
    }
    const { error } = editId
      ? await updateCondominioRow('rutinas_limpieza', editId, payload)
      : await createCondominioRow('rutinas_limpieza', {
          ...payload, company_id: companyId, project_id: proyectoId, servicio: 'limpieza',
        })
    setSaving(false)

    if (error) {
      // 23505 = el índice único por nombre normalizado. El mensaje crudo de
      // Postgres no le dice nada a quien está capturando.
      notify({
        variant: 'error',
        title: error.code === '23505' ? 'Nombre repetido' : 'Error',
        text: error.code === '23505'
          ? 'Ya existe una rutina con ese nombre en este proyecto. Editá la que existe o elegí otro nombre.'
          : error.message,
      })
      return
    }
    setShowForm(false); setEditId(null); setForm(blankForm())
    void cargar(); onRefresh()
  }

  async function toggleActiva(r: RutinaLimpieza) {
    const { error } = await updateCondominioRow('rutinas_limpieza', r.id, { activa: !r.activa })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargar()
  }

  async function borrar(r: RutinaLimpieza) {
    const n = pasosDeRutina(r.id).length
    const res = await confirm({
      title: '¿Eliminar la rutina?',
      text: n > 0
        ? `Se eliminará «${r.nombre}» y sus ${n} paso${n !== 1 ? 's' : ''}. Las actividades del catálogo no se tocan, y si la rutina ya generó tareas en algún turno, la base lo va a impedir.`
        : `Se eliminará la rutina «${r.nombre}».`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!res.isConfirmed) return
    const { error } = await deleteCondominioRow('rutinas_limpieza', r.id)
    if (error) {
      // 23503 = tareas_bloque_rutina_fk (RESTRICT, 20260905000300). Una rutina
      // que ya generó trabajo es historia: su baja es desactivarla.
      notify({
        variant: 'error',
        title: error.code === '23503' ? 'La rutina ya generó trabajo' : 'Error',
        text: error.code === '23503'
          ? 'Esta rutina ya materializó tareas en turnos, y esas tareas son evidencia. Desactivala en vez de borrarla: deja de generar trabajo nuevo y el historial queda intacto.'
          : error.message,
      })
      return
    }
    if (pasosDe === r.id) setPasosDe(null)
    void cargar(); onRefresh()
  }

  async function materializar() {
    setMaterializando(true)
    const { data, error } = await materializarRutinasTurno(proyectoId, desde, hasta)
    setMaterializando(false)
    if (error) {
      notify({ variant: 'error', title: 'No se pudo materializar', text: error.message })
      return
    }
    setUltimo(data)
    // Las tareas viven en otro tab; refrescar aquí es para que el padre vuelva a
    // bajar lo que corresponda, no para esta vista.
    onRefresh()
  }

  // ── Pasos: guardado inmediato, FUERA del formulario ────────────────────────

  async function agregarPaso(rutinaId: string, plantilla: PlantillaTareaCargo) {
    const actuales = pasosDeRutina(rutinaId)
    const { error } = await createCondominioRow('rutina_actividades', {
      // company_id/project_id los sella la BD desde la rutina
      // (rutina_actividad_coherente); van igual porque son NOT NULL.
      company_id: companyId,
      project_id: proyectoId,
      rutina_id: rutinaId,
      plantilla_tarea_id: plantilla.id,
      orden: actuales.length,
    })
    if (error) {
      notify({
        variant: 'error',
        title: error.code === '23505' ? 'Ya está en la rutina' : 'Error',
        text: error.code === '23505' ? 'Esa actividad ya forma parte de esta rutina.' : error.message,
      })
      return
    }
    void cargar()
  }

  async function quitarPaso(paso: RutinaActividad) {
    const { error } = await deleteCondominioRow('rutina_actividades', paso.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargar()
  }

  async function toggleObligatoria(paso: RutinaActividad) {
    const { error } = await updateCondominioRow('rutina_actividades', paso.id, {
      obligatoria: !paso.obligatoria,
    })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargar()
  }

  /** Intercambia el `orden` con el vecino: dos updates, sin renumerar todo. */
  async function mover(paso: RutinaActividad, delta: -1 | 1) {
    const lista = pasosDeRutina(paso.rutina_id)
    const i = lista.findIndex(p => p.id === paso.id)
    const vecino = lista[i + delta]
    if (!vecino) return
    const [a, b] = await Promise.all([
      updateCondominioRow('rutina_actividades', paso.id, { orden: vecino.orden }),
      updateCondominioRow('rutina_actividades', vecino.id, { orden: paso.orden }),
    ])
    const error = a.error ?? b.error
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    void cargar()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function panelPasos(r: RutinaLimpieza) {
    const lista = pasosDeRutina(r.id)
    const elegidas = new Set(lista.map(p => p.plantilla_tarea_id))
    const { total, sinDato } = duracionDe(r.id)

    return (
      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--at-line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>
            Pasos de la rutina ({lista.length}) · ⏱ {formatearDuracion(total)}
            {sinDato > 0 && (
              <span
                style={{ marginLeft: '6px', color: 'var(--at-warning-strong)' }}
                title="Estas actividades no declaran duración estimada: el total de la rutina se queda corto."
              >
                ⚠ {sinDato} sin duración
              </span>
            )}
          </span>
          {canEdit && (
            <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
              ⚡ Los cambios en los pasos se guardan al instante
            </span>
          )}
        </div>

        {lista.length === 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginBottom: '8px' }}>
            Todavía no tiene pasos. Agregá actividades del catálogo.
          </div>
        )}

        {lista.map((paso, i) => {
          const act = porPlantilla.get(paso.plantilla_tarea_id)
          return (
            <div key={paso.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--at-ink-2)', marginBottom: '5px' }}>
              <span style={{ color: 'var(--at-ink-3)', minWidth: '20px' }}>{i + 1}.</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {act?.icono ?? '✅'} {act?.titulo ?? '(actividad no encontrada en el catálogo)'}
                {act?.duracion_estimada_min != null && (
                  <span style={{ color: 'var(--at-ink-3)' }}> · {act.duracion_estimada_min} min</span>
                )}
                {act && act.activo === false && (
                  <span style={{ color: 'var(--at-warning-strong)', fontWeight: 700 }} title="La actividad está desactivada en el catálogo: la rutina la conserva pero no debería materializarse."> · ⚠ inactiva</span>
                )}
              </span>
              {canEdit && (
                <>
                  <button onClick={() => void toggleObligatoria(paso)} title={paso.obligatoria ? 'Paso obligatorio' : 'Paso opcional'} aria-label={`${paso.obligatoria ? 'Volver opcional' : 'Volver obligatorio'} ${act?.titulo ?? 'el paso'}`} style={{ padding: '2px 8px', background: paso.obligatoria ? 'var(--at-primary-soft)' : 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600, color: paso.obligatoria ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
                    {paso.obligatoria ? 'Obligatorio' : 'Opcional'}
                  </button>
                  <button onClick={() => void mover(paso, -1)} disabled={i === 0} aria-label={`Subir ${act?.titulo ?? 'el paso'}`} style={{ padding: '2px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.4 : 1, fontSize: '11.5px' }}>↑</button>
                  <button onClick={() => void mover(paso, 1)} disabled={i === lista.length - 1} aria-label={`Bajar ${act?.titulo ?? 'el paso'}`} style={{ padding: '2px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: i === lista.length - 1 ? 'default' : 'pointer', opacity: i === lista.length - 1 ? 0.4 : 1, fontSize: '11.5px' }}>↓</button>
                  <button onClick={() => void quitarPaso(paso)} aria-label={`Quitar ${act?.titulo ?? 'el paso'} de la rutina`} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11.5px', color: 'var(--at-danger)' }}>✕</button>
                </>
              )}
            </div>
          )
        })}

        {canEdit && (
          <button
            onClick={() => setEligiendo(v => !v)}
            style={{ marginTop: '8px', padding: '6px 12px', background: eligiendo ? 'var(--at-chip)' : 'var(--at-primary-soft)', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 700, color: eligiendo ? 'var(--at-ink-2)' : 'var(--at-primary)' }}
          >
            {eligiendo ? 'Cerrar el catálogo' : '➕ Agregar actividades del catálogo'}
          </button>
        )}

        {canEdit && eligiendo && (
          <div style={{ marginTop: '10px', padding: '10px', background: 'var(--at-surface-2)', borderRadius: '10px' }}>
            <ActividadesCatalog
              plantillas={plantillas}
              areas={areas}
              suministros={suministros}
              inventario={inventario}
              proyectoId={proyectoId}
              companyId={companyId}
              canCreate={false}
              canEdit={false}
              canDelete={false}
              onRefresh={onRefresh}
              servicioInicial="limpieza"
              seleccion={{
                yaElegidas: elegidas,
                onElegir: p => void agregarPaso(r.id, p),
              }}
              titulo="Catálogo de actividades"
              subtitulo="Elegí las que componen esta rutina. La administración del catálogo vive en Plantillas."
            />
          </div>
        )}
      </div>
    )
  }

  if (cargando) {
    return <div style={{ padding: '20px', color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando rutinas…</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--at-ink)' }}>Rutinas de limpieza</h3>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
            Conjuntos de actividades que se ejecutan juntos. Definir la rutina no programa nada todavía.
          </p>
        </div>
        {canCreate && !showForm && (
          <button onClick={abrirNueva} style={{ padding: '8px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
            + Nueva rutina
          </button>
        )}
      </div>

      {canEdit && (
        <div style={{ marginBottom: '14px', padding: '12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '10px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Generar el trabajo de los turnos
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
            Cada rutina activa entra en los turnos de <strong>su misma jornada</strong>. No pisa lo que ya
            haya, no repite lo anulado y no toca turnos cerrados: repetirlo es seguro.
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={labelStyle} htmlFor="mat-desde">Desde</label>
              <input id="mat-desde" type="date" style={{ ...inputStyle, width: 'auto' }}
                value={desde} onChange={e => setDesde(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="mat-hasta">Hasta</label>
              <input id="mat-hasta" type="date" style={{ ...inputStyle, width: 'auto' }}
                value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
            <button onClick={() => void materializar()} disabled={materializando}
              style={{ padding: '9px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: materializando ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700, opacity: materializando ? 0.6 : 1 }}>
              {materializando ? 'Generando…' : '🗓️ Generar tareas'}
            </button>
          </div>

          {ultimo && (
            <div role="status" style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
              <strong>{ultimo.generadas}</strong> tarea{ultimo.generadas !== 1 ? 's' : ''} generada{ultimo.generadas !== 1 ? 's' : ''}.
              {ultimo.omitidas_existente > 0 && (
                <span style={{ color: 'var(--at-ink-3)' }}> · {ultimo.omitidas_existente} ya estaban</span>
              )}
              {ultimo.omitidas_bloque_cerrado > 0 && (
                <span style={{ color: 'var(--at-ink-3)' }}> · {ultimo.omitidas_bloque_cerrado} en turnos ya cerrados</span>
              )}
              {ultimo.rutinas_sin_jornada > 0 && (
                <div style={{ marginTop: '4px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
                  ⚠ {ultimo.rutinas_sin_jornada} rutina{ultimo.rutinas_sin_jornada !== 1 ? 's' : ''} activa{ultimo.rutinas_sin_jornada !== 1 ? 's' : ''} sin jornada: no se puede saber en qué turno va. Editala y elegile una.
                </div>
              )}
              {ultimo.generadas === 0 && ultimo.omitidas_existente === 0
                && ultimo.omitidas_bloque_cerrado === 0 && ultimo.rutinas_sin_jornada === 0 && (
                <div style={{ marginTop: '4px', color: 'var(--at-ink-3)' }}>
                  No hubo turnos de esas jornadas en el rango. Generá los turnos primero, en el tab de Turnos.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {cargaError && (
        <div role="alert" style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--at-danger-tint)', borderRadius: '8px', fontSize: '12.5px', color: 'var(--at-danger)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ flex: 1 }}>No se pudieron cargar las rutinas: {cargaError}</span>
          <button onClick={() => void cargar()} style={{ padding: '2px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Reintentar</button>
        </div>
      )}

      {showForm && (
        <div style={{ marginBottom: '16px', padding: '14px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px' }}>
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div>
              <label style={labelStyle} htmlFor="rutina-nombre">Nombre</label>
              <input id="rutina-nombre" style={inputStyle} value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Rutina matutina de piscina" />
            </div>
            <div>
              <label style={labelStyle} htmlFor="rutina-area">Área (opcional)</label>
              <select id="rutina-area" style={inputStyle} value={form.area_id}
                onChange={e => setForm(f => ({ ...f, area_id: e.target.value }))}>
                <option value="">Sin área específica</option>
                {areas.filter(a => a.activo !== false).map(a => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="rutina-horario">Jornada (opcional)</label>
              <select id="rutina-horario" style={inputStyle} value={form.plantilla_horario_id}
                onChange={e => setForm(f => ({ ...f, plantilla_horario_id: e.target.value }))}>
                <option value="">Sin jornada fija</option>
                {horarios.map(h => (
                  <option key={h.id} value={h.id}>{h.nombre} ({h.hora_inicio}–{h.hora_fin})</option>
                ))}
              </select>
              {horarios.length === 0 && (
                <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                  No hay jornadas activas cargadas (se definen en Turnos).
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle} htmlFor="rutina-orden">Orden</label>
              <input id="rutina-orden" type="number" style={inputStyle} value={form.orden}
                onChange={e => setForm(f => ({ ...f, orden: Number(e.target.value) }))} />
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <label style={labelStyle} htmlFor="rutina-desc">Descripción</label>
            <input id="rutina-desc" style={inputStyle} value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={() => void guardar()} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); setForm(blankForm()) }} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-ink-2)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {rutinas.length === 0 && !cargaError ? (
        <EmptyState
          icon="🧭"
          title="Todavía no hay rutinas"
          description="Una rutina agrupa las actividades que se hacen juntas, para no rearmarlas cada día."
        />
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {rutinas.map(r => {
            const { total, pasos: n } = duracionDe(r.id)
            return (
              <div key={r.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${r.activa ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '12px', padding: '14px', opacity: r.activa ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '24px', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--at-primary-soft)', borderRadius: '9px', flexShrink: 0 }}>🧭</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)' }}>{r.nombre}</div>
                    {r.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{r.descripcion}</div>}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '5px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>📋 {n} paso{n !== 1 ? 's' : ''}</span>
                      <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>⏱ {formatearDuracion(total)}</span>
                      {r.area_nombre && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>📍 {r.area_nombre}</span>}
                      {r.horario_nombre && <span style={{ fontSize: '11.5px', color: 'var(--at-accent-hover)' }}>🕒 {r.horario_nombre}</span>}
                      {!r.activa && <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-warning-strong)' }}>Inactiva</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <button onClick={() => { setPasosDe(a => (a === r.id ? null : r.id)); setEligiendo(false) }} aria-label={`Pasos de ${r.nombre}`} style={{ flex: 1, padding: '5px', background: pasosDe === r.id ? 'var(--at-primary-soft)' : 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>
                    📋 Pasos ({n})
                  </button>
                  {canEdit && <button onClick={() => startEdit(r)} style={{ flex: 1, padding: '5px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️ Editar</button>}
                  {canEdit && (
                    <button onClick={() => void toggleActiva(r)} style={{ padding: '5px 10px', background: r.activa ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: `1px solid ${r.activa ? 'var(--at-warning-border)' : 'var(--at-success-border)'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: r.activa ? 'var(--at-warning-strong)' : 'var(--at-success)' }}>
                      {r.activa ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                  {canDelete && <button onClick={() => void borrar(r)} aria-label={`Eliminar ${r.nombre}`} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>}
                </div>
                {pasosDe === r.id && panelPasos(r)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

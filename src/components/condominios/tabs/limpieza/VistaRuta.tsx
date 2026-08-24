// Vista "Ruta del día": lo que el empleado tiene que hacer hoy, en orden, y
// cómo lo cierra.
//
// El ciclo completo de una fila:
//   generar (desde las áreas asignadas) → subir fotos → cerrar
//   ↳ o reportar una novedad, que la cierra igual pero deja el hallazgo
//     registrado con prioridad y bandera de mantenimiento.
//
// Cerrar un área también mueve `ultima_ejecucion`/`proxima_ejecucion` de la
// programación según su frecuencia: es lo que mantiene vivos los semáforos de
// "vencida / próxima" del catálogo sin que nadie los toque a mano.
import { useState, useMemo } from 'react'
import { hoyLocalISO } from '../../../../lib/format'
// Sin deleteCondominioRow a propósito: el historial de ejecuciones no se borra
// desde la app (20260904000000) — se anula lógicamente con motivo.
import { createCondominioRow, updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import { notify } from '../../../shared/Dialog'
import { openPromptDialog } from '../../../shared/PromptDialog'
import { MultiImageUploader } from '../../../shared/ImageUploader'
import { ImageGallery } from '../../../shared/ImageGallery'
import type {
  ProgramacionLimpieza, EjecucionLimpieza, PersonalCondominio, EstadoEjecucionLimpieza,
} from '../../../../types'
import {
  areasDeEmpleado, construirRuta, avanceRuta, puedeCerrar, proximaEjecucion,
} from '../../../../domain/condominios/limpieza'
import { btn, chip, inputStyle, labelStyle, ESTADO_EJECUCION, PRIORIDAD_LABEL, TURNO_LABEL, CARGO_LABEL } from './ui'

interface Props {
  programaciones: ProgramacionLimpieza[]
  ejecuciones: EjecucionLimpieza[]
  personal: PersonalCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

export function VistaRuta({
  programaciones, ejecuciones, personal, proyectoId, companyId, canCreate, canEdit, onRefresh,
}: Props) {
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [empleadoId, setEmpleadoId] = useState('')
  const [saving, setSaving] = useState(false)
  const [subiendoEn, setSubiendoEn] = useState<string | null>(null)

  const disponibles = useMemo(
    () => personal.filter(p => p.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [personal],
  )
  const empleado = disponibles.find(e => e.id === empleadoId) ?? null

  const areaPorId = useMemo(
    () => new Map(programaciones.map(p => [p.id, p])),
    [programaciones],
  )
  const nombrePersonal = useMemo(() => new Map(personal.map(p => [p.id, p.nombre])), [personal])

  // Las anuladas no cuentan como ruta del día: no bloquean regenerar el área
  // ni entran en el avance. Se listan aparte (`anuladasDelDia`) para poder
  // restaurarlas, con su motivo a la vista.
  const delDia = useMemo(
    () => ejecuciones.filter(e => e.fecha === fecha && !e.anulada_en),
    [ejecuciones, fecha],
  )
  const anuladasDelDia = useMemo(
    () => ejecuciones.filter(e => e.fecha === fecha && e.anulada_en),
    [ejecuciones, fecha],
  )
  const visibles = useMemo(() => {
    const base = empleadoId ? delDia.filter(e => e.personal_id === empleadoId) : delDia
    return [...base].sort((a, b) =>
      a.orden - b.orden ||
      (areaPorId.get(a.programacion_id)?.area ?? '').localeCompare(areaPorId.get(b.programacion_id)?.area ?? ''),
    )
  }, [delDia, empleadoId, areaPorId])

  const avance = avanceRuta(visibles)
  // Áreas que le tocan al empleado pero que aún no están en la ruta del día:
  // es lo que el botón "Generar ruta" va a crear, y decirlo antes evita el
  // clic a ciegas.
  const porGenerar = empleado
    ? areasDeEmpleado(programaciones, empleado).filter(
        p => !delDia.some(e => e.programacion_id === p.id),
      ).length
    : 0

  // ── Generar la ruta ───────────────────────────────────────────────────────
  async function generarRuta() {
    if (!empleado) return
    const filas = construirRuta({
      programaciones, empleado, fecha,
      ejecucionesDelDia: delDia, companyId, projectId: proyectoId,
    })
    if (filas.length === 0) {
      return notify({
        variant: 'info', title: 'Nada que generar',
        text: 'Todas las áreas asignadas a esta persona ya están en la ruta de esa fecha.',
      })
    }
    setSaving(true)
    const { error } = await createCondominioRow('ejecuciones_limpieza', filas)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    notify({ variant: 'success', title: 'Ruta generada', text: `${filas.length} ${filas.length === 1 ? 'área asignada' : 'áreas asignadas'} para ${empleado.nombre}.` })
    onRefresh()
  }

  // ── Cierre de un área ─────────────────────────────────────────────────────
  /**
   * Al cerrar se sella la ejecución Y se corre el calendario del área. Si lo
   * segundo falla, la ejecución ya quedó cerrada: se avisa en vez de dejar al
   * usuario creyendo que el semáforo del catálogo se movió.
   */
  async function cerrar(ejec: EjecucionLimpieza, estado: Extract<EstadoEjecucionLimpieza, 'completada' | 'con_novedad'>, extra: Record<string, unknown> = {}) {
    const prog = areaPorId.get(ejec.programacion_id)
    const chequeo = puedeCerrar(ejec, prog)
    if (!chequeo.ok) {
      return notify({ variant: 'warning', title: 'Falta evidencia', text: chequeo.motivo })
    }
    setSaving(true)
    const { error } = await updateCondominioRow('ejecuciones_limpieza', ejec.id, {
      estado, completada_en: new Date().toISOString(), ...extra,
    })
    if (error) {
      setSaving(false)
      return notify({ variant: 'error', title: 'Error', text: error.message })
    }
    if (prog) {
      const { error: errProg } = await updateCondominioRow('programacion_limpieza', prog.id, {
        ultima_ejecucion: ejec.fecha,
        proxima_ejecucion: proximaEjecucion(ejec.fecha, prog.frecuencia),
        estado: 'completado',
      })
      if (errProg) {
        notify({
          variant: 'warning', title: 'Área cerrada, calendario sin actualizar',
          text: `Se registró la ejecución de ${prog.area}, pero no se pudo mover su próxima fecha: ${errProg.message}`,
        })
      }
    }
    setSaving(false)
    onRefresh()
  }

  async function completar(ejec: EjecucionLimpieza) {
    const r = await openPromptDialog({
      title: 'Cerrar área',
      description: areaPorId.get(ejec.programacion_id)?.area ?? '',
      fields: [{
        name: 'observacion', label: 'Observación (opcional)', control: 'textarea', rows: 3,
        placeholder: 'Cómo quedó, qué producto se usó, etc.',
      }],
      submitText: 'Marcar completada',
    })
    if (!r) return
    await cerrar(ejec, 'completada', { observacion: r.observacion?.trim() || null })
  }

  async function reportarNovedad(ejec: EjecucionLimpieza) {
    const r = await openPromptDialog({
      title: 'Reportar novedad',
      description: `${areaPorId.get(ejec.programacion_id)?.area ?? ''} — queda registrada para el administrador.`,
      fields: [
        {
          name: 'novedad', label: '¿Qué encontraste?', control: 'textarea', rows: 4, required: true, autoFocus: true,
          placeholder: 'Ej. la llave del lavamanos gotea, falta luminaria en el pasillo…',
        },
        {
          name: 'prioridad', label: 'Prioridad', control: 'select', initialValue: 'media',
          options: [
            { value: 'baja', label: 'Baja' },
            { value: 'media', label: 'Media' },
            { value: 'alta', label: 'Alta' },
          ],
        },
        { name: 'requiere_mantenimiento', label: 'Requiere mantenimiento', control: 'checkbox' },
      ],
      submitText: 'Registrar novedad',
    })
    if (!r) return
    await cerrar(ejec, 'con_novedad', {
      novedad: r.novedad.trim(),
      prioridad: r.prioridad || 'media',
      // El checkbox de PromptDialog devuelve string: 'true' / '' según estado.
      requiere_mantenimiento: r.requiere_mantenimiento === 'true',
    })
  }

  async function omitir(ejec: EjecucionLimpieza) {
    const r = await openPromptDialog({
      title: 'Omitir área',
      description: areaPorId.get(ejec.programacion_id)?.area ?? '',
      fields: [{
        name: 'observacion', label: 'Motivo', control: 'textarea', rows: 3, required: true, autoFocus: true,
        placeholder: 'Ej. área en uso por evento privado, sin acceso…',
      }],
      submitText: 'Omitir',
    })
    if (!r) return
    setSaving(true)
    const { error } = await updateCondominioRow('ejecuciones_limpieza', ejec.id, {
      estado: 'omitida', observacion: r.observacion.trim(), completada_en: new Date().toISOString(),
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function reabrir(ejec: EjecucionLimpieza) {
    // La evidencia NO se borra al reabrir: si el área se rehace, las fotos
    // nuevas se suman a las que ya había y el historial queda completo.
    setSaving(true)
    await updateCondominioRow('ejecuciones_limpieza', ejec.id, {
      estado: 'pendiente', completada_en: null,
    })
    setSaving(false)
    onRefresh()
  }

  /**
   * Quitar de la ruta = ANULAR, no borrar. Desde 20260904000000 el DELETE de
   * `ejecuciones_limpieza` está reservado a soporte de plataforma: la fila y
   * sus fotos son historial operativo. La anulación exige motivo (CHECK en BD)
   * y la BD sella quién la hizo; la fila queda fuera de la ruta activa y es
   * restaurable.
   */
  async function anular(ejec: EjecucionLimpieza) {
    const prog = areaPorId.get(ejec.programacion_id)
    const r = await openPromptDialog({
      title: 'Anular de la ruta',
      description: `${prog?.area ?? ''} — la ejecución se conserva con sus fotos y queda marcada como anulada; no se borra.`,
      fields: [{
        name: 'motivo', label: 'Motivo de la anulación', control: 'textarea', rows: 3,
        required: true, autoFocus: true,
        placeholder: 'Ej. se generó al área equivocada, quedó duplicada…',
      }],
      submitText: 'Anular',
    })
    if (!r) return
    setSaving(true)
    const { error } = await updateCondominioRow('ejecuciones_limpieza', ejec.id, {
      anulada_en: new Date().toISOString(),
      motivo_anulacion: r.motivo.trim(),
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function restaurarAnulada(ejec: EjecucionLimpieza) {
    setSaving(true)
    const { error } = await updateCondominioRow('ejecuciones_limpieza', ejec.id, {
      anulada_en: null, anulada_por: null, motivo_anulacion: null,
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function guardarFotos(ejec: EjecucionLimpieza, urls: string[]) {
    setSubiendoEn(ejec.id)
    const { error } = await updateCondominioRow('ejecuciones_limpieza', ejec.id, { foto_urls: urls })
    setSubiendoEn(null)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function reasignar(ejec: EjecucionLimpieza) {
    const r = await openPromptDialog({
      title: 'Reasignar área',
      description: areaPorId.get(ejec.programacion_id)?.area ?? '',
      fields: [{
        name: 'personal_id', label: 'Empleado', control: 'select',
        initialValue: ejec.personal_id ?? '',
        options: [
          { value: '', label: '— Sin asignar —' },
          ...disponibles.map(e => ({ value: e.id, label: `${e.nombre} · ${CARGO_LABEL[e.cargo] ?? e.cargo}` })),
        ],
      }],
      submitText: 'Reasignar',
    })
    if (!r) return
    const { error } = await updateCondominioRow('ejecuciones_limpieza', ejec.id, {
      personal_id: r.personal_id || null,
    })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  return (
    <div>
      {/* Selector de ruta */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Fecha</label>
          <input type="date" style={{ ...inputStyle, width: '160px' }} value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Empleado</label>
          <select style={{ ...inputStyle, width: '230px' }} value={empleadoId} onChange={e => setEmpleadoId(e.target.value)}>
            <option value="">Todos los empleados</option>
            {disponibles.map(e => (
              <option key={e.id} value={e.id}>
                {e.nombre} · {CARGO_LABEL[e.cargo] ?? e.cargo} · {TURNO_LABEL[e.turno]?.label ?? e.turno}
              </option>
            ))}
          </select>
        </div>
        {canCreate && empleado && (
          <button onClick={generarRuta} disabled={saving || porGenerar === 0} style={btn(porGenerar === 0 ? 'var(--at-chip)' : 'var(--at-primary)', porGenerar === 0 ? 'var(--at-ink-3)' : 'white')}>
            {porGenerar === 0 ? 'Ruta al día' : `Generar ruta (${porGenerar})`}
          </button>
        )}
      </div>

      {!empleado && (
        <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '14px' }}>
          Elegí un empleado para generar su ruta desde las áreas que tiene asignadas en la pestaña <strong>Áreas</strong>.
        </div>
      )}

      {/* Avance */}
      {visibles.length > 0 && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
            <strong style={{ fontSize: '13px', color: 'var(--at-ink)' }}>
              {empleado ? `Ruta de ${empleado.nombre}` : 'Todas las rutas'} · {fecha}
            </strong>
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
              {avance.completadas} completadas · {avance.novedades} con novedad · {avance.pendientes} pendientes
              {avance.omitidas > 0 && ` · ${avance.omitidas} omitidas`}
            </span>
          </div>
          <div style={{ height: '10px', background: 'var(--at-chip)', borderRadius: '99px', overflow: 'hidden' }}>
            <div style={{ width: `${avance.porcentaje}%`, height: '100%', background: 'var(--at-success)', transition: 'width 0.25s ease' }} />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>{avance.porcentaje}% de la ruta resuelta</div>
        </div>
      )}

      {/* Ítems de la ruta */}
      {visibles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🗓️</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin ruta generada para esta fecha</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {visibles.map((ejec, i) => {
            const prog = areaPorId.get(ejec.programacion_id)
            const est = ESTADO_EJECUCION[ejec.estado]
            const abierta = ejec.estado === 'pendiente'
            return (
              <div key={ejec.id} style={{ background: est.bg, border: `1.5px solid ${est.border}`, borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                      {i + 1}. {prog?.area ?? 'Área eliminada'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      👤 {ejec.personal_id ? (nombrePersonal.get(ejec.personal_id) ?? 'Empleado dado de baja') : 'Sin asignar'}
                      {ejec.turno && ` · ${TURNO_LABEL[ejec.turno]?.icon ?? ''} ${TURNO_LABEL[ejec.turno]?.label ?? ejec.turno}`}
                    </div>
                    {prog?.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>📋 {prog.notas}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={chip(est.bg, est.color)}>{est.icon} {est.label}</span>
                    {prog?.requiere_foto !== false && <span style={chip('var(--at-accent-tint)', 'var(--at-accent-hover)')}>📸 Foto obligatoria</span>}
                  </div>
                </div>

                {/* Evidencia */}
                {canEdit && abierta ? (
                  <div style={{ marginBottom: '10px', opacity: subiendoEn === ejec.id ? 0.6 : 1 }}>
                    <MultiImageUploader
                      values={ejec.foto_urls}
                      onChange={urls => { void guardarFotos(ejec, urls) }}
                      folder="limpieza"
                      label="Evidencia"
                      maxFiles={6}
                      capture
                    />
                  </div>
                ) : (
                  ejec.foto_urls.length > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                      <ImageGallery urls={ejec.foto_urls} maxVisible={4} />
                    </div>
                  )
                )}

                {ejec.observacion && (
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginBottom: '8px' }}>📝 {ejec.observacion}</div>
                )}
                {ejec.novedad && (
                  <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-warning-border)', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '12px', color: 'var(--at-warning-strong)' }}>⚠️ Novedad</strong>
                      {ejec.prioridad && (
                        <span style={chip(PRIORIDAD_LABEL[ejec.prioridad].bg, PRIORIDAD_LABEL[ejec.prioridad].color)}>
                          {PRIORIDAD_LABEL[ejec.prioridad].label}
                        </span>
                      )}
                      {ejec.requiere_mantenimiento && <span style={chip('var(--at-danger-tint)', 'var(--at-danger)')}>🛠 Requiere mantenimiento</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>{ejec.novedad}</div>
                  </div>
                )}

                {/* Acciones */}
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {abierta ? (
                      <>
                        <button disabled={saving} onClick={() => completar(ejec)} style={btn('var(--at-success)', 'var(--at-on-status)', { padding: '6px 14px', fontSize: '12px', fontWeight: 700 })}>
                          ✓ Completada
                        </button>
                        <button disabled={saving} onClick={() => reportarNovedad(ejec)} style={btn('var(--at-warning-tint)', 'var(--at-warning-strong)', { padding: '6px 14px', fontSize: '12px' })}>
                          ⚠️ Reportar novedad
                        </button>
                        <button disabled={saving} onClick={() => omitir(ejec)} style={btn('var(--at-chip)', 'var(--at-ink-2)', { padding: '6px 14px', fontSize: '12px' })}>
                          ⏭ Omitir
                        </button>
                        <button disabled={saving} onClick={() => reasignar(ejec)} style={btn('var(--at-chip)', 'var(--at-ink-2)', { padding: '6px 14px', fontSize: '12px' })}>
                          👤 Reasignar
                        </button>
                      </>
                    ) : (
                      <button disabled={saving} onClick={() => reabrir(ejec)} style={btn('var(--at-chip)', 'var(--at-ink-2)', { padding: '6px 14px', fontSize: '12px' })}>
                        ↩ Reabrir
                      </button>
                    )}
                    {ejec.anulada_en
                      ? (
                        <button disabled={saving} onClick={() => restaurarAnulada(ejec)} aria-label={`Restaurar ${areaPorId.get(ejec.programacion_id)?.area ?? 'ejecución'}`} style={btn('var(--at-chip)', 'var(--at-ink-2)', { padding: '6px 12px', fontSize: '12px' })}>
                          ♻ Restaurar
                        </button>
                      )
                      : (
                        <button disabled={saving} onClick={() => anular(ejec)} aria-label={`Anular ${areaPorId.get(ejec.programacion_id)?.area ?? 'ejecución'}`} style={btn('var(--at-danger-tint)', 'var(--at-danger)', { padding: '6px 12px', fontSize: '12px' })}>
                          🚫 Anular
                        </button>
                      )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Anuladas del día — se conservan (con fotos) y son restaurables. */}
      {anuladasDelDia.length > 0 && (
        <div style={{ marginTop: '18px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '8px' }}>
            🚫 Anuladas ({anuladasDelDia.length}) — se conservan como historial
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {anuladasDelDia.map(ejec => (
              <div key={ejec.id} style={{ background: 'var(--at-surface-2)', border: '1px dashed var(--at-line)', borderRadius: '10px', padding: '10px 14px', opacity: 0.75 }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', flex: 1 }}>
                    {areaPorId.get(ejec.programacion_id)?.area ?? 'Área'}
                  </span>
                  {(ejec.foto_urls?.length ?? 0) > 0 && (
                    <span style={chip('var(--at-chip)', 'var(--at-ink-3)')}>📷 {ejec.foto_urls.length}</span>
                  )}
                  {canEdit && (
                    <button
                      disabled={saving}
                      onClick={() => restaurarAnulada(ejec)}
                      aria-label={`Restaurar ${areaPorId.get(ejec.programacion_id)?.area ?? 'ejecución'}`}
                      style={btn('var(--at-chip)', 'var(--at-ink-2)', { padding: '5px 12px', fontSize: '12px' })}
                    >
                      ♻ Restaurar
                    </button>
                  )}
                </div>
                {ejec.motivo_anulacion && (
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                    Motivo: {ejec.motivo_anulacion}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

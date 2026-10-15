// Flujo por pasos de un servicio de housekeeping (sustituye a HousekeepingEvidencias).
//
//   Paso 1 · Ingreso   estado en que se encontró la unidad + fotos; «Inconvenientes
//                      encontrados» aparte, con su texto y sus fotos; Guardar.
//   Paso 2 · Resultado cómo quedó + fotos; «Guardar y dar por finalizado» mueve el
//                      servicio a completado (la base sella completado_en y las horas
//                      dedicadas salen de iniciado_en → completado_en) y pregunta si
//                      notificar el informe: correo a dueño/administradores (RPC
//                      hk_notificar_informe), WhatsApp (PDF compartido desde el
//                      dispositivo o enlace wa.me) y/o un destinatario tecleado.
//
// Las fotos se depuran a los 90 días; los textos no (ver docs/PURGA_FOTOS_SCHEDULE.md).
// Un servicio completado o cancelado se abre en solo lectura, con el PDF y la opción de
// volver a notificar el informe.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ModalPortal } from '../../shared/ModalPortal'
import { SecureImage } from '../../shared/SecureImage'
import { notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { useUsuariosMap } from '../../../domain/usuarios/queries'
import { updateCondominioRow, updateCondominioRowAfectando } from '../../../domain/condominios/tabMutations'
import { BUCKET_HOUSEKEEPING } from '../../../domain/shared/buckets'
import {
  MAX_FOTOS_POR_FASE, cupoDisponible, eliminarFotoServicio, listarFotosServicio, subirFotoServicio,
} from '../../../domain/condominios/housekeepingEvidencias'
import {
  clasificarDestinatario, construirEnlaceWhatsApp, horasDedicadas, mensajeErrorFlujo, resumenTextoInforme,
} from '../../../domain/condominios/housekeepingFlujo'
import { notificarInformeHousekeeping } from '../../../domain/condominios/housekeepingReservas'
import { compartirOdescargarPdf, generarInformeHousekeepingPdf } from './housekeepingPdf'
import { lineaResponsablePdf, type EstadoResponsable } from '../../../domain/condominios/housekeepingResponsable'
import { ResponsableLinea } from './ResponsableSelector'
import { HousekeepingFaseFotos } from './HousekeepingFaseFotos'
import type { FaseFotoHousekeeping, FotoHousekeeping, ServicioHousekeeping } from '../../../types'

export type PasoHK = 1 | 2

interface Props {
  servicio: ServicioHousekeeping
  projectId: string
  companyId: string
  tipoLabel: string
  estadoLabel: string
  /** Responsable del servicio (vinculado, requiere reasignación, texto heredado o ninguno). */
  responsableEstado: EstadoResponsable
  /** Nombre del responsable ya resuelto (para el texto de WhatsApp). */
  responsableNombre?: string
  canEdit: boolean
  pasoInicial?: PasoHK
  onClose: () => void
  onRefresh: () => void
}

const area: CSSProperties = { width: '100%', minHeight: 80, padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }
const btn: CSSProperties = { padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink)' }
const btnPrimario: CSSProperties = { ...btn, background: 'var(--at-primary)', color: 'white', border: 'none' }

export function HousekeepingServicioPasos({ servicio, projectId, tipoLabel, estadoLabel, responsableEstado, responsableNombre, canEdit, pasoInicial = 1, onClose, onRefresh }: Props) {
  const { mapa } = useUsuariosMap()
  const [paso, setPaso] = useState<PasoHK>(pasoInicial)
  const [fotos, setFotos] = useState<FotoHousekeeping[]>([])
  const [hallazgos, setHallazgos] = useState(servicio.hallazgos_ingreso ?? '')
  const [inconvenientes, setInconvenientes] = useState(servicio.inconvenientes ?? '')
  const [cierre, setCierre] = useState(servicio.observaciones_cierre ?? '')
  const [mostrarInconvenientes, setMostrarInconvenientes] = useState(!!servicio.inconvenientes)
  const [guardando, setGuardando] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [subiendo, setSubiendo] = useState<FaseFotoHousekeeping | null>(null)
  const [generando, setGenerando] = useState(false)
  const [visor, setVisor] = useState<string | null>(null)

  // Un servicio completado o cancelado no se edita desde aquí (reabrir es cosa de dueño/admin
  // desde la tarjeta); se mira, se comparte y se vuelve a notificar.
  const cerrado = servicio.estado === 'completado' || servicio.estado === 'cancelado'
  const editable = canEdit && !cerrado
  const enProceso = servicio.estado === 'en_proceso'

  const cargar = useCallback(async () => {
    const { data, error } = await listarFotosServicio(servicio.id)
    if (error) notify({ variant: 'error', title: 'No se pudieron cargar las fotos', text: error })
    else {
      setFotos(data)
      if (data.some(f => f.fase === 'inconvenientes')) setMostrarInconvenientes(true)
    }
  }, [servicio.id])
  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (visor) setVisor(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, visor])

  const nombre = (id?: string | null) => (id ? (mapa.get(id)?.full_name?.trim() || `Usuario ${id.slice(0, 8)}`) : undefined)
  const sucio = hallazgos !== (servicio.hallazgos_ingreso ?? '') || inconvenientes !== (servicio.inconvenientes ?? '') || cierre !== (servicio.observaciones_cierre ?? '')

  async function guardarTexto(): Promise<boolean> {
    if (!sucio) return true
    setGuardando(true)
    const { error } = await updateCondominioRow('servicios_housekeeping', servicio.id, {
      hallazgos_ingreso: hallazgos.trim() || null, inconvenientes: inconvenientes.trim() || null, observaciones_cierre: cierre.trim() || null,
    })
    setGuardando(false)
    if (error) { notify({ variant: 'error', title: 'Error al guardar', text: error.message }); return false }
    onRefresh()
    return true
  }

  async function agregar(fase: FaseFotoHousekeeping, files: File[]) {
    const actuales = fotos.filter(f => f.fase === fase).length
    const caben = cupoDisponible(actuales, files.length)
    if (caben < files.length) notify({ variant: 'warning', title: 'Límite de fotos', text: `Máximo ${MAX_FOTOS_POR_FASE} por fase; se subirán ${caben}.` })
    setSubiendo(fase)
    for (const file of files.slice(0, caben)) {
      const { data, error } = await subirFotoServicio({ projectId, servicioId: servicio.id, fase, file })
      if (error || !data) { notify({ variant: 'error', title: 'No se pudo subir la foto', text: error ?? '' }); break }
      setFotos(prev => [...prev, data])
    }
    setSubiendo(null)
  }

  async function eliminar(f: FotoHousekeeping) {
    const { error, limpieza } = await eliminarFotoServicio(f)
    if (error) return notify({ variant: 'error', title: 'No se pudo eliminar la foto', text: error })
    setFotos(prev => prev.filter(x => x.id !== f.id))
    if (limpieza === 'pendiente') notify({ variant: 'info', title: 'Foto eliminada', text: 'El archivo se retirará del almacenamiento en segundo plano.' })
  }

  function servicioActual(): ServicioHousekeeping {
    return { ...servicio, hallazgos_ingreso: hallazgos, inconvenientes, observaciones_cierre: cierre }
  }

  async function generarPdf(s: ServicioHousekeeping): Promise<Blob> {
    return generarInformeHousekeepingPdf({
      servicio: s, fotos, tipoLabel, estadoLabel: s.estado === 'completado' ? 'Completado' : estadoLabel,
      iniciadoPor: nombre(s.iniciado_por), completadoPor: nombre(s.completado_por),
      responsableLinea: lineaResponsablePdf(responsableEstado, nombre),
      evidenciasPor: [...new Set(fotos.map(f => f.creado_por).filter((id): id is string => !!id))].map(id => nombre(id)!),
    })
  }

  const nombrePdf = (s: ServicioHousekeeping) => `housekeeping-${s.unidad_nombre ?? 'servicio'}-${s.fecha}.pdf`.replace(/\s+/g, '_')

  async function compartir() {
    setGenerando(true)
    try {
      if (editable && !(await guardarTexto())) return
      const compartido = await compartirOdescargarPdf(await generarPdf(servicioActual()), nombrePdf(servicio))
      if (!compartido) notify({ variant: 'info', title: 'PDF descargado', text: 'Adjúntalo en WhatsApp desde tus descargas.' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo generar el PDF', text: e instanceof Error ? e.message : '' })
    } finally { setGenerando(false) }
  }

  /**
   * Pregunta cómo notificar el informe y lo hace. `s` es el servicio ya finalizado (con
   * completado_en si ya se recargó; si no, se asume «ahora» para el texto de WhatsApp).
   */
  async function preguntarNotificar(s: ServicioHousekeeping) {
    const r = await openPromptDialog({
      title: '¿Notificar el informe?',
      description: `Servicio finalizado. Horas dedicadas: ${horasDedicadas({ iniciado_en: s.iniciado_en, completado_en: s.completado_en ?? new Date().toISOString() })}. El correo lleva el resumen (sin fotos) y solo sale si la empresa tiene Gmail conectado; el PDF con fotos se comparte desde este dispositivo.`,
      fields: [
        { name: 'correo', label: 'Correo a dueño y administradores del proyecto', control: 'checkbox', initialValue: 'true' },
        { name: 'whatsapp', label: 'WhatsApp (compartir el PDF desde este dispositivo)', control: 'checkbox', initialValue: '' },
        { name: 'otro', label: 'Otro destinatario (correo o teléfono con WhatsApp)', placeholder: 'correo@dominio.com o +502 5555 0001' },
      ],
      submitText: 'Notificar',
      cancelText: 'Ahora no',
      validate: (d) => {
        const otro = d.otro?.trim() ?? ''
        if (otro && !clasificarDestinatario(otro)) return 'El destinatario debe ser un correo o un teléfono.'
        if (!d.correo && !d.whatsapp && !otro) return 'Elige al menos una forma de notificar, o pulsa «Ahora no».'
        return null
      },
    })
    if (!r) return
    const otro = clasificarDestinatario(r.otro ?? '')
    const aAdministradores = r.correo === 'true'
    const emailExtra = otro?.kind === 'email' ? otro.valor : null
    if (aAdministradores || emailExtra) {
      const { data, error } = await notificarInformeHousekeeping(s.id, { aAdministradores, emailExtra })
      if (error) notify({ variant: 'error', title: 'No se envió el correo', text: mensajeErrorFlujo(error) })
      else {
        notify({ variant: 'success', title: 'Informe encolado por correo', text: `Destinatarios: ${data?.destinatarios.join(', ') || '—'}. Sale cuando la empresa tiene Gmail conectado.` })
        onRefresh()
      }
    }
    const telefono = otro?.kind === 'telefono' ? otro.valor : null
    if (r.whatsapp === 'true' || telefono) {
      setGenerando(true)
      try {
        const compartido = await compartirOdescargarPdf(await generarPdf(s), nombrePdf(s))
        if (!compartido) {
          const texto = resumenTextoInforme(s, { unidad: s.unidad_nombre, responsable: responsableNombre ?? nombre(s.responsable_user_id), tipoEtiqueta: tipoLabel })
          window.open(construirEnlaceWhatsApp(telefono ?? (s.reserva_str_resumen?.huesped_telefono ?? null), texto), '_blank', 'noopener')
          notify({ variant: 'info', title: 'PDF descargado', text: 'Se abrió WhatsApp con el resumen; adjunta el PDF desde tus descargas.' })
        }
      } catch (e) {
        notify({ variant: 'error', title: 'No se pudo generar el PDF', text: e instanceof Error ? e.message : '' })
      } finally { setGenerando(false) }
    }
  }

  async function finalizar() {
    if (!enProceso) return
    setFinalizando(true)
    try {
      if (!(await guardarTexto())) return
      const { error } = await updateCondominioRowAfectando('servicios_housekeeping', servicio.id, { estado: 'completado' })
      if (error) {
        return notify({ variant: 'error', title: 'No se finalizó el servicio', text: error.code === 'SIN_FILAS' ? 'El servicio ya no existe o no tienes acceso.' : mensajeErrorFlujo(error.message) })
      }
      onRefresh()
      await preguntarNotificar({ ...servicioActual(), estado: 'completado', completado_en: servicio.completado_en ?? new Date().toISOString() })
      onClose()
    } finally { setFinalizando(false) }
  }

  const fecha = (iso?: string | null) => iso ? new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : null
  const pasos: { n: PasoHK; label: string }[] = [{ n: 1, label: '1 · Ingreso' }, { n: 2, label: '2 · Resultado' }]
  const hecho = (n: PasoHK) => (n === 1 && (paso === 2 || cerrado)) || (n === 2 && servicio.estado === 'completado')

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-label="Servicio de housekeeping" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 16 }}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: 'var(--at-surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 760, margin: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{cerrado ? '📋 Evidencia' : '🧹 Servicio'} · {tipoLabel}</h3>
              <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4, lineHeight: 1.6 }}>
                {servicio.unidad_nombre ?? 'Sin unidad específica'} · {servicio.fecha}{servicio.hora_inicio ? ` · ingreso tentativo ${servicio.hora_inicio.slice(0, 5)}` : ''} · {estadoLabel}<br />
                <ResponsableLinea estado={responsableEstado} />
                {servicio.reserva_str_resumen && <>🔖 Reserva {servicio.reserva_str_resumen.codigo_confirmacion ?? ''} · {servicio.reserva_str_resumen.huesped_nombre ?? ''} ({servicio.reserva_str_resumen.fecha_entrada ?? '?'} → {servicio.reserva_str_resumen.fecha_salida ?? '?'})<br /></>}
                {servicio.iniciado_por && <>Iniciado por <b>{nombre(servicio.iniciado_por)}</b> ({fecha(servicio.iniciado_en)})<br /></>}
                {servicio.completado_por && <>Completado por <b>{nombre(servicio.completado_por)}</b> ({fecha(servicio.completado_en)}) · ⏱ {horasDedicadas(servicio)}</>}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" style={{ ...btn, alignSelf: 'flex-start' }}>✕</button>
          </div>

          {/* Indicador de pasos */}
          <div role="tablist" aria-label="Pasos" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 4px' }}>
            {pasos.map((p, i) => {
              const activo = paso === p.n
              return (
                <div key={p.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" role="tab" aria-selected={activo} aria-label={p.label} onClick={() => setPaso(p.n)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
                    <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                      background: hecho(p.n) ? 'var(--at-success)' : activo ? 'var(--at-primary)' : 'var(--at-chip)',
                      color: hecho(p.n) || activo ? 'white' : 'var(--at-ink-3)' }}>{hecho(p.n) ? '✓' : p.n}</span>
                    <span style={{ fontSize: 12, fontWeight: activo ? 700 : 500, color: activo ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>{p.label}</span>
                  </button>
                  {i < pasos.length - 1 && <div style={{ width: 24, height: 1, background: 'var(--at-line)' }} />}
                </div>
              )
            })}
          </div>

          {paso === 1 && (
            <div role="tabpanel" aria-label="Paso 1 · Ingreso">
              <h4 style={{ margin: '14px 0 4px', fontSize: 13 }}>Estado en que se encontró la unidad</h4>
              <textarea style={area} value={hallazgos} readOnly={!editable} onChange={e => setHallazgos(e.target.value)} aria-label="Estado al ingresar"
                placeholder="Ej.: vaso roto en cocina, mancha en sofá, aire acondicionado sin control…" />
              <HousekeepingFaseFotos titulo="Fotos al ingresar" ayuda="de 15 a 20 recomendadas" fase="ingreso" fotos={fotos} canEdit={editable}
                subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />

              {!mostrarInconvenientes ? (
                (editable || !!inconvenientes) && (
                  <button type="button" onClick={() => setMostrarInconvenientes(true)} style={{ ...btn, marginTop: 14, color: 'var(--at-warning-strong)' }}>⚠️ Inconvenientes encontrados</button>
                )
              ) : (
                <div style={{ marginTop: 14, padding: 12, border: '1.5px solid var(--at-warning-border, var(--at-line))', borderRadius: 10, background: 'var(--at-warning-tint)' }}>
                  <h4 style={{ margin: '0 0 4px', fontSize: 13 }}>⚠️ Inconvenientes encontrados</h4>
                  <textarea style={area} value={inconvenientes} readOnly={!editable} onChange={e => setInconvenientes(e.target.value)} aria-label="Inconvenientes encontrados"
                    placeholder="Daños, faltantes, averías o situaciones que hay que reportar…" />
                  <HousekeepingFaseFotos titulo="Fotos de los inconvenientes" ayuda="las que hagan falta" fase="inconvenientes" fotos={fotos} canEdit={editable}
                    subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                {editable && (
                  <button type="button" onClick={guardarTexto} disabled={guardando || !sucio} style={{ ...btnPrimario, opacity: guardando || !sucio ? 0.6 : 1 }}>
                    {guardando ? 'Guardando…' : 'Guardar'}
                  </button>
                )}
                {editable && enProceso && (
                  <button type="button" onClick={async () => { if (await guardarTexto()) setPaso(2) }} style={btn}>🏁 Finalizar limpieza →</button>
                )}
              </div>
            </div>
          )}

          {paso === 2 && (
            <div role="tabpanel" aria-label="Paso 2 · Resultado">
              <h4 style={{ margin: '14px 0 4px', fontSize: 13 }}>Resultado de la limpieza</h4>
              <textarea style={area} value={cierre} readOnly={!editable} onChange={e => setCierre(e.target.value)} aria-label="Resultado de la limpieza"
                placeholder="Cómo quedó la unidad, pendientes, faltantes…" />
              <HousekeepingFaseFotos titulo="Fotos al terminar" ayuda="de 15 a 20 recomendadas" fase="cierre" fotos={fotos} canEdit={editable}
                subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setPaso(1)} style={btn}>← Ingreso</button>
                {editable && (
                  <button type="button" onClick={guardarTexto} disabled={guardando || !sucio} style={{ ...btn, opacity: guardando || !sucio ? 0.6 : 1 }}>
                    {guardando ? 'Guardando…' : 'Guardar'}
                  </button>
                )}
                {editable && enProceso && (
                  <button type="button" onClick={finalizar} disabled={finalizando || subiendo !== null} style={{ ...btnPrimario, background: 'var(--at-success)', opacity: finalizando ? 0.7 : 1 }}>
                    {finalizando ? 'Finalizando…' : '✅ Guardar y dar por finalizado'}
                  </button>
                )}
                {editable && servicio.estado === 'pendiente' && (
                  <span style={{ fontSize: 11, color: 'var(--at-ink-3)', alignSelf: 'center' }}>Para finalizar, primero «Iniciar servicio» desde la tarjeta.</span>
                )}
              </div>
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--at-ink-3)', margin: '14px 0 0' }}>
            Las fotos se eliminan automáticamente a los 90 días para no saturar el servidor; las observaciones y quién realizó el servicio se conservan.
            {servicio.informe_enviado_en && <> · 📨 Informe enviado por correo el {fecha(servicio.informe_enviado_en)}.</>}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" style={btn} onClick={compartir} disabled={generando}>
              {generando ? 'Generando PDF…' : '📄 PDF / WhatsApp'}
            </button>
            {canEdit && servicio.estado === 'completado' && (
              <button type="button" style={btn} onClick={() => void preguntarNotificar(servicio)} disabled={generando}>📨 Notificar informe</button>
            )}
          </div>
        </div>
      </div>

      {visor && (
        <div role="dialog" aria-modal="true" aria-label="Foto" onClick={() => setVisor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
          <SecureImage src={visor} bucket={BUCKET_HOUSEKEEPING} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      )}
    </ModalPortal>
  )
}

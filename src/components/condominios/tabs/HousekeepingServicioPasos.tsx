// Flujo guiado de un servicio de housekeeping: un MENÚ con tres botones grandes y una
// pantalla por cada uno. Sustituye al indicador numerado «1 · Ingreso — 2 · Resultado»,
// que el personal de limpieza no entendía.
//
//   Menú                      tras «Iniciar servicio» (o desde la tarjeta): muestra qué hay
//                             registrado en cada parte y ofrece:
//   · Estado al ingresar      cómo se encontró la unidad + fotos `ingreso`.
//   · Reportar inconvenientes daños, faltantes o averías + fotos `inconvenientes`.
//   · Resultado del servicio  cómo quedó + fotos `cierre`; «Guardar y dar por finalizado»
//                             mueve el servicio a completado: la base sella completado_en
//                             (la hora REAL de finalización) y las horas dedicadas salen de
//                             iniciado_en → completado_en. Después pregunta si notificar el
//                             informe: correo a dueño/administradores (RPC hk_notificar_informe),
//                             WhatsApp (PDF compartido desde el dispositivo o enlace wa.me)
//                             y/o un destinatario tecleado.
//
// Cada pantalla tiene «Guardar y regresar»: guarda los textos y vuelve al menú (las fotos se
// suben al momento). Cerrar la ventana (✕, «Cerrar», Escape o el fondo) guarda antes lo que
// haya escrito sin guardar: nada de lo digitado se pierde.
//
// Las fotos se depuran a los 90 días; los textos no (ver docs/PURGA_FOTOS_SCHEDULE.md).
// Un servicio completado o cancelado se abre en solo lectura (mismo menú), con el PDF y la
// opción de volver a notificar el informe.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ModalPortal } from '../../shared/ModalPortal'
import { SecureImage } from '../../shared/SecureImage'
import { notify, confirm } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { useUsuariosMap } from '../../../domain/usuarios/queries'
import { updateCondominioRow, updateCondominioRowAfectando } from '../../../domain/condominios/tabMutations'
import { BUCKET_HOUSEKEEPING } from '../../../domain/shared/buckets'
import {
  MAX_FOTOS_POR_FASE, cupoDisponible, eliminarFotoServicio, listarFotosServicio, subirFotoServicio,
} from '../../../domain/condominios/housekeepingEvidencias'
import {
  clasificarDestinatario, construirEnlaceWhatsApp, fechaHoraReal, horaReal, horasDedicadas, mensajeErrorFlujo, resumenParte,
  resumenTextoInforme,
} from '../../../domain/condominios/housekeepingFlujo'
import { notificarInformeHousekeeping } from '../../../domain/condominios/housekeepingReservas'
import { compartirOdescargarPdf, generarInformeHousekeepingPdf } from './housekeepingPdf'
import { lineaResponsablePdf, type EstadoResponsable } from '../../../domain/condominios/housekeepingResponsable'
import { ResponsableLinea } from './ResponsableSelector'
import { HousekeepingFaseFotos } from './HousekeepingFaseFotos'
import type { FaseFotoHousekeeping, FotoHousekeeping, ServicioHousekeeping } from '../../../types'

/** Pantalla del flujo guiado: el menú o una de sus tres partes. */
export type VistaHK = 'menu' | 'ingreso' | 'inconvenientes' | 'resultado'
type ParteHK = Exclude<VistaHK, 'menu'>

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
  vistaInicial?: VistaHK
  onClose: () => void
  onRefresh: () => void
}

/** Las tres partes del menú, en el orden en que se hacen. */
const PARTES: { vista: ParteHK; fase: FaseFotoHousekeeping; icon: string; titulo: string; vacio: string }[] = [
  { vista: 'ingreso',        fase: 'ingreso',        icon: '📝', titulo: 'Evidenciar estado al ingresar', vacio: 'Sin registrar' },
  { vista: 'inconvenientes', fase: 'inconvenientes', icon: '⚠️', titulo: 'Reportar inconvenientes',       vacio: 'Sin inconvenientes reportados' },
  { vista: 'resultado',      fase: 'cierre',         icon: '🏁', titulo: 'Resultado del servicio',        vacio: 'Sin registrar' },
]

const area: CSSProperties = { width: '100%', minHeight: 96, padding: '10px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }
const btn: CSSProperties = { padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink)', minHeight: 40 }
const btnPrimario: CSSProperties = { ...btn, background: 'var(--at-primary)', color: 'white', border: 'none' }
const btnFinalizar: CSSProperties = { ...btnPrimario, background: 'var(--at-success)' }
// Botón grande del menú: todo el ancho, texto a la izquierda, alto cómodo para el dedo.
const btnParte: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '14px 16px', minHeight: 72, border: '1.5px solid var(--at-line)', borderRadius: 12, background: 'var(--at-surface-2)', color: 'var(--at-ink)', cursor: 'pointer', fontFamily: 'inherit' }
const notaStyle: CSSProperties = { fontSize: 11, color: 'var(--at-ink-3)', margin: '14px 0 0' }

export function HousekeepingServicioPasos({ servicio, projectId, tipoLabel, estadoLabel, responsableEstado, responsableNombre, canEdit, vistaInicial = 'menu', onClose, onRefresh }: Props) {
  const { mapa } = useUsuariosMap()
  const [vista, setVista] = useState<VistaHK>(vistaInicial)
  const [fotos, setFotos] = useState<FotoHousekeeping[]>([])
  const [hallazgos, setHallazgos] = useState(servicio.hallazgos_ingreso ?? '')
  const [inconvenientes, setInconvenientes] = useState(servicio.inconvenientes ?? '')
  const [cierre, setCierre] = useState(servicio.observaciones_cierre ?? '')
  const [guardando, setGuardando] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [subiendo, setSubiendo] = useState<FaseFotoHousekeeping | null>(null)
  const [generando, setGenerando] = useState(false)
  const [visor, setVisor] = useState<string | null>(null)
  // Lo último que se guardó (o lo que traía el servicio): contra esto se decide si hay
  // cambios pendientes, sin esperar a que el padre recargue.
  const guardado = useRef({ hallazgos: servicio.hallazgos_ingreso ?? '', inconvenientes: servicio.inconvenientes ?? '', cierre: servicio.observaciones_cierre ?? '' })
  const cerrando = useRef(false)

  // Un servicio completado o cancelado no se edita desde aquí (reabrir es cosa de dueño/admin
  // desde la tarjeta); se mira, se comparte y se vuelve a notificar.
  const cerrado = servicio.estado === 'completado' || servicio.estado === 'cancelado'
  const editable = canEdit && !cerrado
  const enProceso = servicio.estado === 'en_proceso'

  const cargar = useCallback(async () => {
    const { data, error } = await listarFotosServicio(servicio.id)
    if (error) notify({ variant: 'error', title: 'No se pudieron cargar las fotos', text: error })
    else setFotos(data)
  }, [servicio.id])
  useEffect(() => { void cargar() }, [cargar])

  const nombre = (id?: string | null) => (id ? (mapa.get(id)?.full_name?.trim() || `Usuario ${id.slice(0, 8)}`) : undefined)
  const sucio = hallazgos.trim() !== guardado.current.hallazgos.trim()
    || inconvenientes.trim() !== guardado.current.inconvenientes.trim()
    || cierre.trim() !== guardado.current.cierre.trim()

  async function guardarTexto(): Promise<boolean> {
    if (!editable || !sucio) return true
    setGuardando(true)
    const { error } = await updateCondominioRow('servicios_housekeeping', servicio.id, {
      hallazgos_ingreso: hallazgos.trim() || null, inconvenientes: inconvenientes.trim() || null, observaciones_cierre: cierre.trim() || null,
    })
    setGuardando(false)
    if (error) { notify({ variant: 'error', title: 'Error al guardar', text: error.message }); return false }
    guardado.current = { hallazgos, inconvenientes, cierre }
    onRefresh()
    return true
  }

  /** «Guardar y regresar»: guarda los textos y vuelve al menú (en solo lectura, solo vuelve). */
  async function volverAlMenu() {
    if (await guardarTexto()) setVista('menu')
  }

  /**
   * Cerrar la ventana guarda primero lo escrito sin guardar. Si no se pudo guardar, se
   * pregunta antes de perderlo.
   */
  async function cerrar() {
    if (cerrando.current) return
    cerrando.current = true
    try {
      if (!(await guardarTexto())) {
        const r = await confirm({ title: 'No se guardaron las observaciones', text: '¿Cerrar de todos modos? Se perderá lo escrito sin guardar.', icon: 'warning', variant: 'danger', confirmText: 'Cerrar sin guardar', cancelText: 'Seguir editando' })
        if (!r.isConfirmed) return
      }
      onClose()
    } finally { cerrando.current = false }
  }
  const cerrarRef = useRef(cerrar)
  cerrarRef.current = cerrar

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (visor) setVisor(null); else void cerrarRef.current() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visor])

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
      if (!(await guardarTexto())) return
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
    const completadoEn = s.completado_en ?? new Date().toISOString()
    const r = await openPromptDialog({
      title: '¿Notificar el informe?',
      description: `Servicio finalizado a las ${horaReal(completadoEn)} (hora de finalización registrada). Horas dedicadas: ${horasDedicadas({ iniciado_en: s.iniciado_en, completado_en: completadoEn })}. El correo lleva el resumen (sin fotos) y solo sale si la empresa tiene Gmail conectado; el PDF con fotos se comparte desde este dispositivo.`,
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

  /** «Guardar y dar por finalizado»: textos → completado (la base sella la hora de fin). */
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

  const textoDe: Record<ParteHK, string> = { ingreso: hallazgos, inconvenientes, resultado: cierre }
  const nFotos = (fase: FaseFotoHousekeeping) => fotos.filter(f => f.fase === fase).length
  const parteActual = PARTES.find(p => p.vista === vista) ?? null
  const ocupado = guardando || finalizando || subiendo !== null

  const botonVolver = (estilo: CSSProperties) => (
    <button type="button" onClick={() => void volverAlMenu()} disabled={ocupado} style={{ ...estilo, opacity: ocupado ? 0.6 : 1 }}>
      {guardando ? 'Guardando…' : editable ? '💾 Guardar y regresar' : '← Regresar'}
    </button>
  )

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-label="Servicio de housekeeping" onClick={() => void cerrar()}
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
                {servicio.iniciado_por && <>▶️ Inició <b>{nombre(servicio.iniciado_por)}</b> · {fechaHoraReal(servicio.iniciado_en) ?? '—'}<br /></>}
                {servicio.completado_por && <>✅ Finalizó <b>{nombre(servicio.completado_por)}</b> · {fechaHoraReal(servicio.completado_en) ?? '—'} · ⏱ {horasDedicadas(servicio)}</>}
              </div>
            </div>
            <button type="button" onClick={() => void cerrar()} aria-label="Cerrar" style={{ ...btn, alignSelf: 'flex-start' }}>✕</button>
          </div>

          {vista === 'menu' && (
            <nav aria-label="Partes del servicio" style={{ marginTop: 12 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 13 }}>{editable ? '¿Qué deseas registrar?' : 'Evidencia del servicio'}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {PARTES.map(p => {
                  const resumen = resumenParte(textoDe[p.vista], nFotos(p.fase))
                  const descripcion = p.vista === 'ingreso' ? 'Cómo encontraste la unidad y fotos al ingresar'
                    : p.vista === 'inconvenientes' ? 'Daños, faltantes o averías que hay que reportar, con sus fotos'
                    : editable && enProceso ? 'Cómo quedó la unidad, fotos al terminar y dar por finalizado' : 'Cómo quedó la unidad y fotos al terminar'
                  return (
                    <button key={p.vista} type="button" onClick={() => setVista(p.vista)} aria-label={p.titulo} style={btnParte}>
                      <span aria-hidden="true" style={{ fontSize: 26, lineHeight: 1 }}>{p.icon}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{p.titulo}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>{descripcion}</span>
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 4, color: resumen ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>
                          {resumen ? `✓ ${resumen}` : p.vacio}
                        </span>
                      </span>
                      <span aria-hidden="true" style={{ fontSize: 22, color: 'var(--at-ink-3)' }}>›</span>
                    </button>
                  )
                })}
              </div>
              {editable && enProceso && (
                <p style={{ ...notaStyle, fontSize: 12 }}>Para dar por finalizado el servicio entra a <b>Resultado del servicio</b>: ahí se registra la hora de finalización.</p>
              )}
              {editable && servicio.estado === 'pendiente' && (
                <p style={{ ...notaStyle, fontSize: 12 }}>Para finalizar, primero «Iniciar servicio» desde la tarjeta.</p>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void cerrar()} disabled={ocupado} style={{ ...btn, opacity: ocupado ? 0.6 : 1 }}>
                  {guardando ? 'Guardando…' : 'Cerrar'}
                </button>
              </div>
            </nav>
          )}

          {parteActual && (
            <section aria-label={parteActual.titulo} style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void volverAlMenu()} disabled={ocupado} aria-label="Regresar al menú" style={{ ...btn, padding: '6px 10px', minHeight: 32, fontSize: 12 }}>← Regresar</button>
                <h4 style={{ margin: 0, fontSize: 14 }}>{parteActual.icon} {parteActual.titulo}</h4>
              </div>

              {vista === 'ingreso' && (
                <>
                  <h5 style={{ margin: '14px 0 4px', fontSize: 13, fontWeight: 600 }}>Estado en que se encontró la unidad</h5>
                  <textarea style={area} value={hallazgos} readOnly={!editable} onChange={e => setHallazgos(e.target.value)} aria-label="Estado al ingresar"
                    placeholder="Ej.: vaso roto en cocina, mancha en sofá, aire acondicionado sin control…" />
                  <HousekeepingFaseFotos titulo="Fotos al ingresar" ayuda="de 15 a 20 recomendadas" fase="ingreso" fotos={fotos} canEdit={editable}
                    subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />
                </>
              )}

              {vista === 'inconvenientes' && (
                <div style={{ marginTop: 14, padding: 12, border: '1.5px solid var(--at-warning-border, var(--at-line))', borderRadius: 10, background: 'var(--at-warning-tint)' }}>
                  <h5 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Inconvenientes encontrados</h5>
                  <textarea style={area} value={inconvenientes} readOnly={!editable} onChange={e => setInconvenientes(e.target.value)} aria-label="Inconvenientes encontrados"
                    placeholder="Daños, faltantes, averías o situaciones que hay que reportar…" />
                  <HousekeepingFaseFotos titulo="Fotos de los inconvenientes" ayuda="las que hagan falta" fase="inconvenientes" fotos={fotos} canEdit={editable}
                    subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />
                </div>
              )}

              {vista === 'resultado' && (
                <>
                  <h5 style={{ margin: '14px 0 4px', fontSize: 13, fontWeight: 600 }}>Cómo quedó la unidad</h5>
                  <textarea style={area} value={cierre} readOnly={!editable} onChange={e => setCierre(e.target.value)} aria-label="Cómo quedó la unidad"
                    placeholder="Cómo quedó la unidad, pendientes, faltantes…" />
                  <HousekeepingFaseFotos titulo="Fotos al terminar" ayuda="de 15 a 20 recomendadas" fase="cierre" fotos={fotos} canEdit={editable}
                    subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />
                  {editable && enProceso && (
                    <p style={{ ...notaStyle, fontSize: 12 }}>Al dar por finalizado se registra la hora de finalización y se calculan las horas dedicadas.</p>
                  )}
                  {editable && servicio.estado === 'pendiente' && (
                    <p style={{ ...notaStyle, fontSize: 12 }}>Para finalizar, primero «Iniciar servicio» desde la tarjeta.</p>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                {botonVolver(vista === 'resultado' && editable && enProceso ? btn : btnPrimario)}
                {vista === 'resultado' && editable && enProceso && (
                  <button type="button" onClick={finalizar} disabled={ocupado} style={{ ...btnFinalizar, opacity: ocupado ? 0.7 : 1 }}>
                    {finalizando ? 'Finalizando…' : '✅ Guardar y dar por finalizado'}
                  </button>
                )}
              </div>
            </section>
          )}

          <p style={notaStyle}>
            Las fotos se eliminan automáticamente a los 90 días para no saturar el servidor; las observaciones y quién realizó el servicio se conservan.
            {servicio.informe_enviado_en && <> · 📨 Informe enviado por correo el {fechaHoraReal(servicio.informe_enviado_en)}.</>}
          </p>
          {vista === 'menu' && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" style={btn} onClick={compartir} disabled={generando}>
                {generando ? 'Generando PDF…' : '📄 PDF / WhatsApp'}
              </button>
              {canEdit && servicio.estado === 'completado' && (
                <button type="button" style={btn} onClick={() => void preguntarNotificar(servicio)} disabled={generando}>📨 Notificar informe</button>
              )}
            </div>
          )}
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

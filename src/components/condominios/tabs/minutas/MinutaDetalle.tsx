// Detalle de una minuta en ventana: participantes, puntos con sus acuerdos y
// compromisos (que se marcan cumplidos desde aquí), fotos y documentos, las
// firmas (firma aquí quien no firmó al guardarla), avance y acciones (editar,
// fijar, cerrar/reabrir, imprimir, eliminar).
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { ImageGallery } from '../../../shared/ImageGallery'
import { ListaAdjuntos } from '../../../shared/FileUploader'
import { Button } from '../../../shared/Button'
import { confirm, notify } from '../../../shared/Dialog'
import { deleteCondominioRowAfectando, updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import { removeMedia, uploadCondominiosMedia } from '../../../../domain/shared/storage'
import { BUCKET_MEDIA } from '../../../../domain/shared/buckets'
import {
  PASOS_MINUTA, TIPO_ACUERDO_INFO, documentosDe, estadoFirma, fechaDeMinuta, firmasDe, fotosDe, gestorDe, marcarCumplido, minutaEnCurso, participantesDe, pasoBorradorDe,
  plazoCompromiso, plazoSeguimiento, puntosDe, registrarFirmaMinuta, resumenCompromisos, resumenFirmas, rutasDelProyecto, situacionCompromiso, versionAcuerdos,
} from '../../../../domain/condominios/minutas'
import { buildUploadPath } from '../../../../lib/fileValidation'
import { diasHastaFechaCalendario, formatFechaCalendario } from '../../../../lib/format'
import type { AcuerdoMinuta, NotaAdmin, ParticipanteMinuta } from '../../../../types'
import { tint } from '../../../shared/statusTone'
import { BarraAvance, FilaFirma, ParticipanteCard, categoriaInfo, prioridadInfo } from './comun'
import { FirmarMinutaModal } from './FirmarMinutaModal'
import { imprimirMinuta } from './imprimirMinuta'
import './minutas.css'

interface Props {
  nota: NotaAdmin
  canEdit: boolean
  canDelete: boolean
  onClose: () => void
  onEditar: () => void
  onRefresh: () => void
}

const chip = (bg: string, color: string): CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: bg, color, whiteSpace: 'nowrap' })
const bloque: CSSProperties = { border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, background: 'var(--at-surface)' }
const tituloBloque: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }

export function MinutaDetalle({ nota, canEdit, canDelete, onClose, onEditar, onRefresh }: Props) {
  const participantes = participantesDe(nota)
  const gestor = gestorDe(participantes)
  const fotos = fotosDe(nota)
  const documentos = documentosDe(nota)
  const firmas = firmasDe(nota)
  // Copia local de los puntos: marcar un compromiso se ve al instante y la
  // sección recarga detrás; cuando llega la fila fresca, se vuelve a tomar.
  const [puntos, setPuntos] = useState(() => puntosDe(nota))
  useEffect(() => { setPuntos(puntosDe(nota)) }, [nota])
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cat = categoriaInfo(nota.categoria)
  const prio = prioridadInfo(nota.prioridad)
  // Guardada a medias: en qué paso del asistente se retoma.
  const pasoEnCurso = minutaEnCurso(nota) ? pasoBorradorDe(nota) : null
  const resumen = resumenCompromisos(puntos)
  const diasSeguimiento = diasHastaFechaCalendario(nota.fecha_recordatorio)
  // Marcar un compromiso cumplido no cambia la huella: sólo cuenta lo acordado.
  const version = versionAcuerdos(puntos, participantes)
  const resumenF = resumenFirmas(participantes, firmas, version)
  const [firmando, setFirmando] = useState<ParticipanteMinuta | null>(null)
  const [guardandoFirma, setGuardandoFirma] = useState(false)
  // Ref y no estado: dos toques seguidos en «Firmar y aceptar» llegan con el mismo render.
  const firmandoRef = useRef(false)
  const tituloFirmasRef = useRef<HTMLHeadingElement>(null)
  // Tras firmar, el botón «Firmar» de esa fila desaparece con la recarga: el
  // foco va al título de la sección y no cae a <body>. En un efecto, para que
  // corra después de que la ventana de firma devuelva el foco a su disparador.
  const enfocarFirmasRef = useRef(false)
  useEffect(() => {
    if (firmando || !enfocarFirmasRef.current) return
    enfocarFirmasRef.current = false
    tituloFirmasRef.current?.focus()
  }, [firmando])
  const nombreDe = (id: string | null | undefined) => participantes.find(p => p.id === id)?.nombre ?? null

  async function cambiar(campos: Record<string, unknown>, clave: string, exito?: string) {
    if (ocupado) return
    setOcupado(clave)
    const { error } = await updateCondominioRow('notas_admin', nota.id, campos)
    setOcupado(null)
    if (error) { notify({ variant: 'error', title: 'No se pudo actualizar', text: error.message }); return false }
    if (exito) notify({ variant: 'success', title: exito })
    onRefresh()
    return true
  }

  async function marcar(a: AcuerdoMinuta, cumplido: boolean) {
    const nuevos = marcarCumplido(puntos, a.id, cumplido, new Date().toISOString())
    setPuntos(nuevos)
    const ok = await cambiar({ puntos: nuevos }, `acuerdo:${a.id}`)
    if (!ok) setPuntos(puntos)
  }

  async function cerrarMinuta() {
    const pendientes = resumen.total - resumen.cumplidos
    const faltan = [
      pasoEnCurso !== null && `la captura a medias (se quedó en el paso ${pasoEnCurso} de ${PASOS_MINUTA.length})`,
      pendientes > 0 && `${pendientes} compromiso${pendientes === 1 ? '' : 's'} sin cumplir`,
      resumenF.pendientes > 0 && `${resumenF.pendientes} firma${resumenF.pendientes === 1 ? '' : 's'} pendiente${resumenF.pendientes === 1 ? '' : 's'}`,
    ].filter(Boolean)
    const res = await confirm({
      title: 'Cerrar minuta',
      text: faltan.length > 0 ? `Quedan ${faltan.join(' y ')}. ¿Cerrar de todos modos?` : '¿Dar la minuta por cerrada?',
      icon: 'question', confirmText: 'Cerrar minuta',
    })
    if (!res.isConfirmed) return
    await cambiar({ resuelta: true, fijada: false }, 'cerrar', 'Minuta cerrada')
  }

  async function eliminar() {
    if (!canDelete) return
    const res = await confirm({ title: 'Eliminar minuta', text: `¿Eliminar «${nota.titulo}»? No se puede deshacer.`, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!res.isConfirmed) return
    // Afectando: si la política de filas no la borra, los archivos no se tocan.
    const { error } = await deleteCondominioRowAfectando('notas_admin', nota.id)
    if (error) { notify({ variant: 'error', title: 'No se pudo eliminar', text: error.message }); return }
    // Ninguna otra fila apunta a estas rutas; si el borrado falla, sólo quedan huérfanas.
    const archivos = rutasDelProyecto([...fotos, ...documentos, ...firmas.map(f => f.path)], nota.project_id)
    if (archivos.length > 0) void removeMedia(BUCKET_MEDIA, archivos)
    onClose()
    onRefresh()
  }

  /** Firma de quien no firmó al guardar (o firmó una versión anterior). Se guarda en el acto. */
  async function firmar(archivo: File) {
    const p = firmando
    if (!p || firmandoRef.current) return
    firmandoRef.current = true
    setGuardandoFirma(true)
    try {
      const path = buildUploadPath(`${nota.project_id}/minutas-firmas`, 'firma.png', 'png')
      const { error: upErr } = await uploadCondominiosMedia(path, archivo, { contentType: 'image/png', upsert: false })
      if (upErr) { notify({ variant: 'error', title: 'No se pudo guardar la firma', text: upErr }); return }
      const { error, reemplazada } = await registrarFirmaMinuta(nota.id, { participante_id: p.id, nombre: p.nombre.trim(), path, firmado_at: new Date().toISOString(), version })
      // Sin fila que la cite, la imagen recién subida sobra; la que reemplazó, también.
      if (error) { void removeMedia(BUCKET_MEDIA, [path]); notify({ variant: 'error', title: 'No se pudo guardar la firma', text: error }); return }
      const vieja = reemplazada ? rutasDelProyecto([reemplazada], nota.project_id) : []
      if (vieja.length > 0) void removeMedia(BUCKET_MEDIA, vieja)
      notify({ variant: 'success', title: `Firma de ${p.nombre} registrada` })
      enfocarFirmasRef.current = true
      setFirmando(null)
      onRefresh()
    } finally {
      firmandoRef.current = false
      setGuardandoFirma(false)
    }
  }

  const editable = canEdit && !nota.resuelta

  return (
    <EditModal
      title={nota.titulo}
      subtitle={<>
        📅 {formatFechaCalendario(fechaDeMinuta(nota), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        {gestor && <> · ★ Gestiona <strong>{gestor.nombre}</strong></>}
        {nota.autor && nota.autor !== gestor?.nombre && <> · Registró {nota.autor}</>}
      </>}
      size="lg"
      fullScreenOnMobile
      onClose={onClose}
      footer={
        <div className="minuta-acciones minuta-acciones--detalle">
          {canDelete && <Button className="minuta-eliminar" variant="outline-danger" size="sm" onClick={() => void eliminar()}>🗑 Eliminar</Button>}
          <Button variant="secondary" size="sm" onClick={() => void imprimirMinuta(nota)}>🖨 Imprimir</Button>
          {canEdit && !nota.resuelta && (
            <Button variant="secondary" size="sm" onClick={() => void cambiar({ fijada: !nota.fijada }, 'fijar')} loading={ocupado === 'fijar'}>
              {nota.fijada ? '📌 Desfijar' : '📌 Fijar'}
            </Button>
          )}
          {canEdit && (nota.resuelta
            ? <Button variant="secondary" size="sm" onClick={() => void cambiar({ resuelta: false }, 'reabrir', 'Minuta reabierta')} loading={ocupado === 'reabrir'}>↺ Reabrir</Button>
            : <Button variant="success" size="sm" onClick={() => void cerrarMinuta()} loading={ocupado === 'cerrar'}>✓ Cerrar minuta</Button>)}
          {editable && <Button variant="primary" size="sm" onClick={onEditar}>{pasoEnCurso !== null ? '▶ Continuar' : '✏️ Editar'}</Button>}
        </div>
      }
    >
      <div className="minuta-detalle-cuerpo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={chip(tint(cat.color, 14), cat.color)}>{cat.icon} {cat.label}</span>
          {prio.value !== 'normal' && <span style={chip(prio.bg, prio.color)}>Prioridad {prio.label.toLowerCase()}</span>}
          {nota.fijada && <span style={chip('var(--at-warning-tint)', 'var(--at-warning-strong)')}>📌 Fijada</span>}
          <span style={chip(nota.resuelta ? 'var(--at-success-tint)' : 'var(--at-info-tint)', nota.resuelta ? 'var(--at-success-strong)' : 'var(--at-info-strong)')}>{nota.resuelta ? '✓ Cerrada' : '● Abierta'}</span>
          {pasoEnCurso !== null && <span style={chip('var(--at-warning-tint)', 'var(--at-warning-strong)')}>✎ En curso · paso {pasoEnCurso} de {PASOS_MINUTA.length}</span>}
        </div>

        {pasoEnCurso !== null && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)' }}>
            <span aria-hidden="true" style={{ fontSize: 18 }}>✎</span>
            <div style={{ fontSize: 13 }}>
              <strong>Minuta en curso.</strong> Se guardó el avance en el paso {pasoEnCurso} ({PASOS_MINUTA[pasoEnCurso - 1].label.toLowerCase()}).
              {editable ? ' Retómala desde ahí con «Continuar».' : ''}
            </div>
          </div>
        )}

        {diasSeguimiento !== null && !nota.resuelta && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10,
            background: diasSeguimiento < 0 ? 'var(--at-danger-tint)' : diasSeguimiento === 0 ? 'var(--at-warning-tint)' : 'var(--at-info-tint)',
            border: `1px solid ${diasSeguimiento < 0 ? 'var(--at-danger-border)' : diasSeguimiento === 0 ? 'var(--at-warning-border)' : 'var(--at-info-border)'}` }}>
            <span aria-hidden="true" style={{ fontSize: 18 }}>⏰</span>
            <div style={{ fontSize: 13 }}>
              <strong>Próximo seguimiento</strong> {formatFechaCalendario(nota.fecha_recordatorio)} · {plazoSeguimiento(diasSeguimiento)}
            </div>
          </div>
        )}

        {nota.contenido?.trim() && (
          <div style={bloque}>
            <h3 style={tituloBloque}>Objetivo</h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>{nota.contenido}</div>
          </div>
        )}

        {fotos.length > 0 && (
          <div style={bloque} className="minuta-galeria">
            <h3 style={tituloBloque}>Fotos ({fotos.length})</h3>
            <ImageGallery urls={fotos} maxVisible={6} />
          </div>
        )}

        {documentos.length > 0 && (
          <div style={bloque} className="minuta-documentos">
            <h3 style={tituloBloque}>Documentos ({documentos.length})</h3>
            <ListaAdjuntos paths={documentos} />
          </div>
        )}

        <div style={bloque}>
          <h3 style={tituloBloque}>Participantes ({participantes.length})</h3>
          {participantes.length === 0
            ? <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-3)', fontStyle: 'italic' }}>Sin participantes registrados.</p>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 8 }}>
                {participantes.map(p => <ParticipanteCard key={p.id} p={p} />)}
              </div>}
        </div>

        <div style={bloque}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={tituloBloque}>Puntos abordados ({puntos.length})</h3>
            {resumen.total > 0 && (
              <span style={{ fontSize: 12, color: resumen.vencidos > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: 600 }}>
                {resumen.cumplidos} de {resumen.total} compromisos cumplidos{resumen.vencidos > 0 ? ` · ${resumen.vencidos} vencido${resumen.vencidos === 1 ? '' : 's'}` : ''}
              </span>
            )}
          </div>
          {resumen.total > 0 && <div style={{ margin: '0 0 12px' }}><BarraAvance cumplidos={resumen.cumplidos} total={resumen.total} alto={8} /></div>}
          {puntos.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-3)', fontStyle: 'italic' }}>Sin puntos registrados.</p>}
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {puntos.map((p, i) => (
              <li key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>{p.titulo}</div>
                  {p.descripcion && <div style={{ fontSize: 13, color: 'var(--at-ink-2)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.descripcion}</div>}
                  {p.acuerdos.length > 0 && (
                    <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                      {p.acuerdos.map(a => {
                        const esCompromiso = a.tipo === 'compromiso'
                        const situacion = esCompromiso ? situacionCompromiso(a) : null
                        const dias = esCompromiso ? diasHastaFechaCalendario(a.fecha_limite) : null
                        const responsable = esCompromiso ? nombreDe(a.responsable_id) : null
                        const colorPlazo = situacion === 'vencido' ? 'var(--at-danger)' : situacion === 'hoy' ? 'var(--at-warning-strong)' : 'var(--at-ink-3)'
                        return (
                          <li key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8,
                            background: a.cumplido ? 'var(--at-success-tint)' : 'var(--at-surface-2)', borderLeft: `3px solid ${esCompromiso ? (a.cumplido ? 'var(--at-success)' : situacion === 'vencido' ? 'var(--at-danger)' : 'var(--at-accent)') : 'var(--at-primary-mint)'}` }}>
                            {esCompromiso && (
                              <label className="minuta-check-hit" style={{ marginTop: -2 }}>
                                <input type="checkbox" className="minuta-check" checked={a.cumplido} disabled={!canEdit || nota.resuelta || ocupado !== null}
                                  aria-label={`${a.cumplido ? 'Desmarcar' : 'Marcar'} cumplido: ${a.texto}`}
                                  onChange={e => void marcar(a, e.target.checked)} />
                              </label>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, color: 'var(--at-ink)', textDecoration: a.cumplido ? 'line-through' : 'none', opacity: a.cumplido ? 0.75 : 1 }}>
                                <span aria-hidden="true">{TIPO_ACUERDO_INFO[a.tipo].icon} </span>{a.texto}
                              </div>
                              {esCompromiso && (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, marginTop: 3 }}>
                                  <span style={{ color: 'var(--at-ink-3)' }}>{responsable ? `👤 ${responsable}` : '👤 Sin responsable'}</span>
                                  {a.fecha_limite && (
                                    <span style={{ color: a.cumplido ? 'var(--at-ink-3)' : colorPlazo, fontWeight: !a.cumplido && situacion !== 'pendiente' ? 700 : 500 }}>
                                      📅 {formatFechaCalendario(a.fecha_limite)}{!a.cumplido && dias !== null ? ` · ${plazoCompromiso(dias)}` : ''}
                                    </span>
                                  )}
                                  {a.cumplido && <span style={{ color: 'var(--at-success-strong)', fontWeight: 600 }}>✓ Cumplido</span>}
                                </div>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {participantes.length > 0 && (
          <div style={bloque} className="minuta-firmas">
            <h3 ref={tituloFirmasRef} tabIndex={-1} style={{ ...tituloBloque, outline: 'none' }}>Firmas ({resumenF.vigentes} de {resumenF.total})</h3>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--at-ink-3)' }}>
              Con su firma, cada participante acepta los acuerdos y compromisos de esta minuta.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
              {participantes.map(p => {
                const firma = firmas.find(f => f.participante_id === p.id)
                const puedeFirmar = editable && (!firma || estadoFirma(firma, version) === 'anterior')
                return (
                  <FilaFirma key={p.id} p={p} firma={firma} version={version} acciones={puedeFirmar ? (
                    <Button size="sm" className="minuta-touch" variant="primary" onClick={() => setFirmando(p)} aria-label={`${firma ? 'Firmar de nuevo' : 'Firmar'}: ${p.nombre}`}>
                      {firma ? '✍ Firmar de nuevo' : '✍ Firmar'}
                    </Button>
                  ) : undefined} />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {firmando && (
        <FirmarMinutaModal participante={firmando} tituloMinuta={nota.titulo} puntos={puntos} participantes={participantes}
          guardando={guardandoFirma} onFirmar={archivo => void firmar(archivo)} onClose={() => setFirmando(null)} />
      )}
    </EditModal>
  )
}

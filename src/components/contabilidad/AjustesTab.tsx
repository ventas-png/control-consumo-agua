// Contabilidad › Solicitudes de ajuste (20261011000000).
//
// Las anulaciones y reversos (y las aplicaciones de saldo a favor que piden
// los residentes desde el portal) se SOLICITAN con motivo y los ejecuta la
// aprobación de OTRA persona. Aquí se aprueban, rechazan o reintentan; quien
// solicitó puede cancelar la suya mientras esté pendiente. El dueño de la
// empresa puede aprobar la propia sólo confirmándolo (queda marcada).
//
// La pantalla sólo muestra botones según permiso; el servidor vuelve a decidir
// todo (cuatro ojos, permiso, documento, período y saldo).
//
// RESPALDO (20261012000000): quien pidió la solicitud (o quien crea en
// Contabilidad) adjunta documentos mientras está pendiente; quien aprueba los
// abre (enlace firmado de pocos minutos) y declara cuáles revisó. Si llegó
// otro archivo después, el servidor no aprueba. El motivo y la bitácora no son
// respaldo.
import { useMemo, useRef, useState } from 'react'
import { useSession } from '../shared/SessionContext'
import { notify, confirm } from '../shared/Dialog'
import { openTextPrompt } from '../shared/PromptDialog'
import {
  ETIQUETA_ESTADO_AJUSTE,
  ETIQUETA_INCIDENCIA,
  ETIQUETA_TIPO_AJUSTE,
  ETIQUETA_COMPONENTE_REBAJA,
  accionesSolicitud,
  urlRespaldo,
  useAdjuntarRespaldoMutation,
  useAprobarAjusteMutation,
  useCancelarAjusteMutation,
  useIncidenciasConciliacionQuery,
  useRechazarAjusteMutation,
  useReintentarAjusteMutation,
  useResolverIncidenciaMutation,
  useRespaldosAjusteQuery,
  useSolicitudesAjusteQuery,
  type EstadoAjuste,
  type RespaldoAjuste,
  type SolicitudAjuste,
} from '../../domain/contabilidad/ajustes'
import { btnLink, btnSecundario, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  projectId: string | null
}

const FILTROS: { id: 'abiertas' | EstadoAjuste | 'todas'; label: string }[] = [
  { id: 'abiertas', label: 'Por resolver' },
  { id: 'ejecutada', label: 'Ejecutadas' },
  { id: 'rechazada', label: 'Rechazadas' },
  { id: 'cancelada', label: 'Canceladas' },
  { id: 'todas', label: 'Todas' },
]

function fecha(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString('es') : '—'
}

function errorTexto(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function AjustesTab({ companyId, projectId }: Props) {
  const sesion = useSession()
  const { puedeAutorizar, puedeCambiarEstado, puedeCrear } = usePermisosContabilidad()
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['id']>('abiertas')
  const solicitudes = useSolicitudesAjusteQuery(companyId, projectId)
  const incidencias = useIncidenciasConciliacionQuery(companyId, true)
  const aprobar = useAprobarAjusteMutation(companyId)
  const rechazar = useRechazarAjusteMutation(companyId)
  const reintentar = useReintentarAjusteMutation(companyId)
  const cancelar = useCancelarAjusteMutation(companyId)
  const resolver = useResolverIncidenciaMutation(companyId)
  const respaldos = useRespaldosAjusteQuery(companyId)
  const adjuntar = useAdjuntarRespaldoMutation(companyId)
  const archivoRef = useRef<HTMLInputElement>(null)
  const [adjuntandoA, setAdjuntandoA] = useState<string | null>(null)

  const respaldosPorSolicitud = useMemo(() => {
    const m = new Map<string, RespaldoAjuste[]>()
    for (const r of respaldos.data ?? []) {
      const l = m.get(r.solicitud_id) ?? []
      l.push(r)
      m.set(r.solicitud_id, l)
    }
    return m
  }, [respaldos.data])

  const filas = useMemo(() => {
    const todas = solicitudes.data ?? []
    if (filtro === 'todas') return todas
    if (filtro === 'abiertas') return todas.filter((s) => s.estado === 'pendiente' || s.estado === 'fallida')
    return todas.filter((s) => s.estado === filtro)
  }, [solicitudes.data, filtro])

  const ses = { userId: sesion.user_id ?? null, rol: sesion.role ?? null, puedeAprobar: puedeAutorizar }

  async function onAprobar(s: SolicitudAjuste, auto: boolean) {
    // Lo que se aprueba es lo que se revisó: se declara la lista de respaldos
    // que la pantalla mostró; si el servidor tiene otra, no aprueba.
    const vistos = respaldosPorSolicitud.get(s.id) ?? []
    if (vistos.length > 0) {
      const ok = await confirm({
        title: 'Respaldo revisado',
        text: `Confirmo que revisé ${vistos.length === 1 ? 'el respaldo' : `los ${vistos.length} respaldos`}: ${vistos.map((r) => r.nombre_archivo).join(', ')}.`,
        icon: 'question', confirmText: 'Sí, los revisé',
      })
      if (!ok.isConfirmed) return
    }
    if (auto) {
      const ok = await confirm({
        title: 'Aprobar tu propia solicitud',
        text: 'Vas a aprobar una solicitud que hiciste tú. Como dueño de la empresa puedes hacerlo, y quedará registrada como AUTOAPROBACIÓN. ¿Confirmas?',
        icon: 'warning', variant: 'danger', confirmText: 'Sí, autoaprobar',
      })
      if (!ok.isConfirmed) return
    }
    try {
      const r = await aprobar.mutateAsync({
        id: s.id, confirmarAutoaprobacion: auto, respaldosRevisados: vistos.map((x) => x.id),
      })
      if (r.estado === 'ejecutada') {
        notify({ variant: 'success', title: r.repetida ? 'Ya estaba ejecutada' : 'Aprobada y ejecutada', text: ETIQUETA_TIPO_AJUSTE[s.tipo] })
      } else {
        notify({ variant: 'warning', title: 'Aprobada, pero la ejecución falló', text: `${r.error_ejecucion ?? ''} No quedó nada a medias: corrige la causa y usa «Reintentar», o recházala.` })
      }
    } catch (e) {
      notify({ variant: 'error', title: 'No se aprobó', text: errorTexto(e) })
    }
  }

  async function onRechazar(s: SolicitudAjuste) {
    const motivo = await openTextPrompt({
      title: 'Rechazar solicitud', label: 'Motivo del rechazo', required: true,
      description: 'El documento no cambia. Quien la pidió verá el motivo.',
      validate: (v) => (v.trim().length < 5 ? 'Indica el motivo (al menos 5 caracteres).' : null),
    })
    if (!motivo) return
    try {
      await rechazar.mutateAsync({ id: s.id, motivo: motivo.trim() })
      notify({ variant: 'success', title: 'Solicitud rechazada', text: 'No cambió ningún documento.' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se rechazó', text: errorTexto(e) })
    }
  }

  async function onReintentar(s: SolicitudAjuste) {
    try {
      const r = await reintentar.mutateAsync(s.id)
      notify(r.estado === 'ejecutada'
        ? { variant: 'success', title: 'Ejecutada', text: ETIQUETA_TIPO_AJUSTE[s.tipo] }
        : { variant: 'warning', title: 'Volvió a fallar', text: r.error_ejecucion ?? '' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se reintentó', text: errorTexto(e) })
    }
  }

  async function onCancelar(s: SolicitudAjuste) {
    const ok = await confirm({ title: 'Cancelar solicitud', text: '¿Cancelar tu solicitud? El documento no cambia.', icon: 'warning', confirmText: 'Cancelar solicitud' })
    if (!ok.isConfirmed) return
    try {
      await cancelar.mutateAsync({ id: s.id })
      notify({ variant: 'success', title: 'Solicitud cancelada', text: '' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se canceló', text: errorTexto(e) })
    }
  }

  async function onVerRespaldo(r: RespaldoAjuste) {
    try {
      window.open(await urlRespaldo(r.storage_path), '_blank', 'noopener')
    } catch (e) {
      notify({ variant: 'error', title: 'No se abrió el respaldo', text: errorTexto(e) })
    }
  }

  function onElegirRespaldo(s: SolicitudAjuste) {
    setAdjuntandoA(s.id)
    archivoRef.current?.click()
  }

  async function onArchivoElegido(archivo: File | undefined) {
    const solicitudId = adjuntandoA
    setAdjuntandoA(null)
    if (archivoRef.current) archivoRef.current.value = ''
    if (!archivo || !solicitudId) return
    try {
      await adjuntar.mutateAsync({ clave: crypto.randomUUID(), companyId, solicitudId, archivo })
      notify({ variant: 'success', title: 'Respaldo adjuntado', text: archivo.name })
    } catch (e) {
      notify({ variant: 'error', title: 'No se adjuntó el respaldo', text: errorTexto(e) })
    }
  }

  async function onResolver(id: string) {
    const nota = await openTextPrompt({
      title: 'Resolver incidencia', label: 'Cómo se resolvió', required: true,
      validate: (v) => (v.trim().length < 5 ? 'Describe la resolución (al menos 5 caracteres).' : null),
    })
    if (!nota) return
    try {
      await resolver.mutateAsync({ id, nota: nota.trim() })
      notify({ variant: 'success', title: 'Incidencia resuelta', text: '' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se resolvió', text: errorTexto(e) })
    }
  }

  const ocupado = aprobar.isPending || rechazar.isPending || reintentar.isPending || cancelar.isPending || adjuntar.isPending

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input ref={archivoRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden
        data-testid="respaldo-input" onChange={(e) => void onArchivoElegido(e.target.files?.[0])} />
      {(incidencias.data?.length ?? 0) > 0 && (
        <section aria-labelledby="incidencias" style={{ border: '1px solid var(--at-warning-border)', background: 'var(--at-warning-tint)', borderRadius: 8, padding: 12 }}>
          <h3 id="incidencias" style={{ margin: '0 0 8px', fontSize: 15 }}>Incidencias de conciliación abiertas ({incidencias.data!.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {incidencias.data!.map((i) => (
              <li key={i.id} style={{ fontSize: 13 }}>
                <strong>{ETIQUETA_INCIDENCIA[i.tipo]}</strong>
                {i.monto != null && <> · {Number(i.monto).toFixed(2)}</>} · {fecha(i.creada_at)}
                <div style={{ color: 'var(--at-ink-2)' }}>{i.detalle}</div>
                {puedeCambiarEstado && (
                  <button type="button" style={btnLink} disabled={resolver.isPending} onClick={() => void onResolver(i.id)}>Marcar resuelta</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="solicitudes">
        <h3 id="solicitudes" style={{ margin: '0 0 8px', fontSize: 15 }}>Solicitudes de ajuste</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--at-ink-3)' }}>
          Anular cuotas, cargos o cobros, anular anticipos y revertir o aplicar saldos a favor se solicitan con motivo y los ejecuta la aprobación de otra persona.
          Lo que impide una anulación (cobros, saldo aplicado) se resuelve antes: nada se anula en cascada.
          Las solicitudes no vencen; el dueño de la empresa puede aprobar las propias confirmándolo.
        </p>
        <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {FILTROS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filtro === f.id}
              style={{ ...btnSecundario, fontWeight: filtro === f.id ? 700 : 400 }} onClick={() => setFiltro(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {solicitudes.isLoading && <p>Cargando…</p>}
        {solicitudes.error && <p role="alert">No se pudieron cargar las solicitudes: {errorTexto(solicitudes.error)}</p>}
        {!solicitudes.isLoading && filas.length === 0 && <p style={{ color: 'var(--at-ink-3)' }}>No hay solicitudes en esta vista.</p>}
        {filas.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--at-line)' }}>
                <th>Solicitud</th><th>Motivo</th><th>Respaldo</th><th>Estado</th><th>Solicitada</th><th />
              </tr>
            </thead>
            <tbody>
              {filas.map((s) => {
                const a = accionesSolicitud(s, ses)
                const foto = s.foto_documento as { concepto?: string; monto?: number }
                return (
                  <tr key={s.id} data-testid={`ajuste-${s.id}`} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                    <td>
                      <strong>{ETIQUETA_TIPO_AJUSTE[s.tipo]}</strong>
                      {s.canal === 'portal' && <span style={{ marginLeft: 6, fontSize: 11 }}>(portal)</span>}
                      <div style={{ color: 'var(--at-ink-3)' }}>
                        {foto.concepto ?? s.documento_tabla}
                        {s.importe != null && <> · {s.tipo === 'ajuste_importe' ? 'rebaja ' : ''}{Number(s.importe).toFixed(2)} {s.moneda ?? ''}</>}
                        {s.componente && <> ({ETIQUETA_COMPONENTE_REBAJA[s.componente]})</>}
                      </div>
                    </td>
                    <td>{s.motivo}{s.motivo_revision && <div style={{ color: 'var(--at-ink-3)' }}>Revisión: {s.motivo_revision}</div>}</td>
                    <td>
                      {(respaldosPorSolicitud.get(s.id) ?? []).map((r) => (
                        <div key={r.id}>
                          <button type="button" style={btnLink} onClick={() => void onVerRespaldo(r)} title={r.descripcion ?? undefined}>
                            📎 {r.nombre_archivo}
                          </button>
                        </div>
                      ))}
                      {Array.isArray(s.respaldos_revisados) && s.estado !== 'pendiente' && (
                        <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>
                          {s.respaldos_revisados.length === 0 ? 'Sin respaldo al revisar' : `Revisados al decidir: ${s.respaldos_revisados.length}`}
                        </div>
                      )}
                      {s.estado === 'pendiente' && (s.solicitado_por === ses.userId || puedeCrear) && (
                        <button type="button" style={btnLink} disabled={ocupado} onClick={() => onElegirRespaldo(s)}>Adjuntar…</button>
                      )}
                    </td>
                    <td>
                      {ETIQUETA_ESTADO_AJUSTE[s.estado]}
                      {s.autoaprobada && <div style={{ fontSize: 11, color: 'var(--at-warning-strong)' }}>Autoaprobada</div>}
                      {s.estado === 'fallida' && s.error_ejecucion && <div style={{ fontSize: 12, color: 'var(--at-danger)' }}>{s.error_ejecucion}</div>}
                    </td>
                    <td>{fecha(s.solicitado_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {a.aprobar && <button type="button" style={btnLink} disabled={ocupado} onClick={() => void onAprobar(s, false)}>Aprobar</button>}
                      {a.autoaprobar && <button type="button" style={btnLink} disabled={ocupado} onClick={() => void onAprobar(s, true)}>Autoaprobar…</button>}
                      {a.reintentar && <button type="button" style={btnLink} disabled={ocupado} onClick={() => void onReintentar(s)}>Reintentar</button>}
                      {a.rechazar && <button type="button" style={btnLink} disabled={ocupado} onClick={() => void onRechazar(s)}>Rechazar</button>}
                      {a.cancelar && <button type="button" style={btnLink} disabled={ocupado} onClick={() => void onCancelar(s)}>Cancelar</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

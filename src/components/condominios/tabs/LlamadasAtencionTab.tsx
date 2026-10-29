import { hoyLocalISO, formatDateTime } from '../../../lib/format'
import { useMemo, useState, type CSSProperties } from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { SignaturePad } from '../../shared/SignaturePad'
import { notify, confirm } from '../../shared/Dialog'
import { deleteCondominioRow } from '../../../domain/condominios/tabMutations'
import { etiquetaCargo } from '../../../domain/condominios/rrhhCatalogos'
import {
  ESTADO_LLAMADA, TIPO_LLAMADA, TIPOS_LLAMADA, anularLlamadaAtencion, emitirLlamadaAtencion,
  nombrePdfLlamada, subirFirmaLlamada, tipoLlamadaLabel,
} from '../../../domain/condominios/llamadasAtencion'
import { CartaLlamada } from './llamadasAtencion/CartaLlamada'
import { AcuseLlamadaModal } from './llamadasAtencion/AcuseLlamadaModal'
import { generarCartaLlamadaPdf } from './llamadasAtencion/llamadasAtencionPdf'
import { compartirOdescargarPdf } from './housekeepingPdf'
import type { CargoCatalogo, EstadoLlamadaAtencion, LlamadaAtencionPersonal, PersonalCondominio, TipoLlamadaAtencion } from '../../../types'

interface Props {
  llamadas: LlamadaAtencionPersonal[]
  /** Expediente del condominio: la carta se dirige a uno de los activos. */
  personal: PersonalCondominio[]
  cargos?: CargoCatalogo[]
  proyectoId: string
  companyId: string
  proyectoNombre?: string
  canCreate: boolean
  /** Registrar el acuse en persona (empleado sin cuenta). */
  canEdit: boolean
  /** Anular una carta. */
  canChangeStatus: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.llamadas_atencion.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const BLANK = {
  personal_id: '', tipo: 'llamada_atencion' as TipoLlamadaAtencion,
  fecha_hechos: hoyLocalISO(), motivo: '', descripcion: '', fundamento: '', dias_suspension: '',
}

const inp: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
const lbl: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

/**
 * Llamadas de atención y sanciones al personal. La carta se emite firmada por
 * quien la emite y queda pendiente hasta que el empleado firma de recibido:
 * desde su cuenta (Mi perfil, avisado por la campana) o en persona, en este
 * dispositivo, cuando no tiene cuenta. El PDF lleva la carta y las dos firmas.
 */
export default function LlamadasAtencionTab({ llamadas, personal, cargos = [], proyectoId, companyId, proyectoNombre, canCreate, canEdit, canChangeStatus, canDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [paso, setPaso] = useState<'datos' | 'firma'>('datos')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [acusePresencial, setAcusePresencial] = useState<LlamadaAtencionPersonal | null>(null)
  const [anulando, setAnulando] = useState<LlamadaAtencionPersonal | null>(null)
  const [motivoAnulacion, setMotivoAnulacion] = useState('')
  const [generando, setGenerando] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoLlamadaAtencion | ''>('')
  const [busqueda, setBusqueda] = useState('')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  // Mismo criterio que Capacitación: fuera sólo el inactivo.
  const personalActivo = useMemo(
    () => personal.filter(p => p.estado !== 'inactivo').sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [personal],
  )
  const empleadoElegido = personalActivo.find(p => p.id === form.personal_id)

  const lista = llamadas.filter(l =>
    (!filtroEstado || l.estado === filtroEstado) &&
    (!busqueda || l.empleado_nombre.toLowerCase().includes(busqueda.toLowerCase()) || l.motivo.toLowerCase().includes(busqueda.toLowerCase())),
  )
  const detail = selected ? llamadas.find(l => l.id === selected) ?? null : null

  const kpis = [
    { ...ESTADO_LLAMADA.pendiente, label: 'Por firmar', val: llamadas.filter(l => l.estado === 'pendiente').length },
    { ...ESTADO_LLAMADA.acusada, label: 'Firmadas de recibido', val: llamadas.filter(l => l.estado === 'acusada').length },
    { ...ESTADO_LLAMADA.anulada, label: 'Anuladas', val: llamadas.filter(l => l.estado === 'anulada').length },
    { label: 'Suspensiones', val: llamadas.filter(l => l.tipo === 'suspension' && l.estado !== 'anulada').length, bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  ]

  function datosCompletos(): boolean {
    if (!form.personal_id || !form.motivo.trim() || !form.descripcion.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Elegí al empleado y escribí el asunto y el detalle de la carta.' }); return false
    }
    if (form.tipo === 'suspension' && !(parseInt(form.dias_suspension, 10) > 0)) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Una suspensión lleva los días sin goce de salario.' }); return false
    }
    return true
  }

  /**
   * Emitir: la firma del emisor se sube ANTES de insertar (la fila la exige), bajo
   * `<project>/<carta>/` con un id que genera el cliente. Si el INSERT falla, la
   * firma queda huérfana y no prueba nada; la fila sin firma es lo que no puede pasar.
   */
  async function emitir(firma: File) {
    if (!datosCompletos() || !empleadoElegido) return
    setSaving(true)
    try {
      const id = crypto.randomUUID()
      const { path, error: upErr } = await subirFirmaLlamada(proyectoId, id, firma, 'emisor')
      if (!path) { notify({ variant: 'error', title: 'No se subió la firma', text: upErr ?? 'Intentá de nuevo.' }); return }
      const { error } = await emitirLlamadaAtencion({
        id, companyId, projectId: proyectoId, personalId: empleadoElegido.id,
        empleadoCargo: empleadoElegido.cargo ? etiquetaCargo(empleadoElegido.cargo, cargos) : '',
        tipo: form.tipo, fechaHechos: form.fecha_hechos, motivo: form.motivo, descripcion: form.descripcion,
        fundamento: form.fundamento, diasSuspension: form.tipo === 'suspension' ? parseInt(form.dias_suspension, 10) : null,
        firmaEmisorPath: path,
      })
      if (error) { notify({ variant: 'error', title: 'No se emitió la carta', text: error.message }); return }
      notify({
        variant: 'success', title: 'Carta emitida', duration: 3000,
        text: empleadoElegido.user_id
          ? `${empleadoElegido.nombre} recibe el aviso en su cuenta para leerla y firmar de recibido.`
          : `${empleadoElegido.nombre} no tiene cuenta: registrá el acuse en persona desde la carta.`,
      })
      setShowForm(false); setForm({ ...BLANK }); setPaso('datos'); onRefresh()
    } finally { setSaving(false) }
  }

  async function anular() {
    if (!anulando) return
    if (!motivoAnulacion.trim()) { notify({ variant: 'warning', title: 'Falta el motivo', text: 'Escribí por qué se anula la carta.' }); return }
    setSaving(true)
    try {
      const { error } = await anularLlamadaAtencion(anulando.id, motivoAnulacion)
      if (error) { notify({ variant: 'error', title: 'No se anuló', text: error.message }); return }
      setAnulando(null); setMotivoAnulacion(''); setSelected(null); onRefresh()
    } finally { setSaving(false) }
  }

  async function eliminar(l: LlamadaAtencionPersonal) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const { isConfirmed } = await confirm({ title: '¿Eliminar la carta?', text: 'Se borra del historial. Si sólo querés dejarla sin efecto, anulala.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!isConfirmed) return
    const { error } = await deleteCondominioRow('llamadas_atencion_personal', l.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setSelected(null); onRefresh()
  }

  async function descargarPdf(l: LlamadaAtencionPersonal) {
    setGenerando(l.id)
    try {
      const blob = await generarCartaLlamadaPdf({ carta: l, proyectoNombre })
      const compartido = await compartirOdescargarPdf(blob, nombrePdfLlamada(l))
      if (!compartido) notify({ variant: 'info', title: 'PDF descargado', text: 'Quedó en tus descargas.', duration: 2000 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se generó el PDF', text: e instanceof Error ? e.message : String(e) })
    } finally { setGenerando(null) }
  }

  function cerrarForm() { if (saving) return; setShowForm(false); setPaso('datos') }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {kpis.map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar empleado o asunto…" aria-label="Buscar empleado o asunto"
            style={{ ...inp, width: 'auto', minWidth: 200 }} />
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoLlamadaAtencion | '')} aria-label="Filtrar por estado" style={{ ...inp, width: 'auto' }}>
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADO_LLAMADA) as EstadoLlamadaAtencion[]).map(e => <option key={e} value={e}>{ESTADO_LLAMADA[e].label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={() => { setForm({ ...BLANK }); setPaso('datos'); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva llamada de atención
          </button>
        )}
      </div>

      {/* Emitir: datos → firma del emisor */}
      {showForm && (
        <EditModal
          title={paso === 'datos' ? 'Nueva llamada de atención' : 'Firmar y emitir'}
          subtitle={paso === 'datos'
            ? 'La carta se emite con tu firma y queda pendiente hasta que el empleado firme de recibido.'
            : 'Revisá la carta. Al firmar se emite y, si el empleado tiene cuenta, recibe el aviso para firmar de recibido.'}
          maxWidth="720px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={paso === 'datos' ? <>
            <Button variant="secondary" onClick={cerrarForm}>Cancelar</Button>
            <Button onClick={() => { if (datosCompletos()) setPaso('firma') }}>Continuar a la firma</Button>
          </> : <>
            <Button variant="secondary" onClick={() => setPaso('datos')} disabled={saving}>Volver a los datos</Button>
          </>}
        >
          {paso === 'datos' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="lla-empleado" style={lbl}>Empleado *</label>
                <select id="lla-empleado" style={inp} value={form.personal_id} onChange={e => setF('personal_id', e.target.value)} autoFocus>
                  <option value="">{personalActivo.length ? 'Elegí un empleado…' : 'Sin empleados activos — agregalos en Personal'}</option>
                  {personalActivo.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}{p.cargo ? ` — ${etiquetaCargo(p.cargo, cargos)}` : ''}{p.user_id ? '' : ' (sin cuenta)'}</option>
                  ))}
                </select>
                {empleadoElegido && !empleadoElegido.user_id && (
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                    Sin cuenta: no recibirá el aviso; registrá el acuse en persona cuando la lea.
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="lla-tipo" style={lbl}>Tipo *</label>
                <select id="lla-tipo" style={inp} value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoLlamadaAtencion)}>
                  {TIPOS_LLAMADA.map(t => <option key={t} value={t}>{TIPO_LLAMADA[t].label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="lla-fecha" style={lbl}>Fecha de los hechos *</label>
                <input id="lla-fecha" type="date" style={inp} value={form.fecha_hechos} onChange={e => setF('fecha_hechos', e.target.value)} />
              </div>
              {form.tipo === 'suspension' && (
                <div>
                  <label htmlFor="lla-dias" style={lbl}>Días sin goce de salario *</label>
                  <input id="lla-dias" type="number" min={1} step={1} style={inp} value={form.dias_suspension} onChange={e => setF('dias_suspension', e.target.value)} />
                </div>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="lla-motivo" style={lbl}>Asunto *</label>
                <input id="lla-motivo" style={inp} value={form.motivo} onChange={e => setF('motivo', e.target.value)} placeholder="Ej. Llegada tarde reiterada" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="lla-descripcion" style={lbl}>Detalle de la carta *</label>
                <textarea id="lla-descripcion" style={{ ...inp, minHeight: '110px', resize: 'vertical' }} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)}
                  placeholder="Qué pasó, cuándo, y qué se espera en adelante…" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="lla-fundamento" style={lbl}>Fundamento (reglamento interno, Código de Trabajo…)</label>
                <input id="lla-fundamento" style={inp} value={form.fundamento} onChange={e => setF('fundamento', e.target.value)} placeholder="Opcional" />
              </div>
            </div>
          ) : (
            <>
              <CartaLlamada sinFirmas proyectoNombre={proyectoNombre} carta={{
                tipo: form.tipo, fecha_hechos: form.fecha_hechos, motivo: form.motivo.trim(), descripcion: form.descripcion.trim(),
                fundamento: form.fundamento.trim() || null, dias_suspension: form.tipo === 'suspension' ? parseInt(form.dias_suspension, 10) : null,
                estado: 'pendiente', empleado_nombre: empleadoElegido?.nombre ?? '',
                empleado_cargo: empleadoElegido?.cargo ? etiquetaCargo(empleadoElegido.cargo, cargos) : null,
                emitido_por_nombre: '', emitido_en: new Date().toISOString(), firma_emisor_path: '',
              }} />
              <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '6px' }}>Tu firma como emisor *</div>
              <SignaturePad onSave={emitir} saving={saving} saveLabel={saving ? 'Emitiendo…' : 'Firmar y emitir'} />
            </>
          )}
        </EditModal>
      )}

      {/* Lista */}
      {lista.length === 0 ? (
        <EmptyState icon="⚠️" title="Sin llamadas de atención" description={llamadas.length ? 'Ninguna coincide con el filtro.' : 'Las cartas que emitas quedan aquí con su acuse de recibido.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {lista.map(l => {
            const estado = ESTADO_LLAMADA[l.estado]
            return (
              <div key={l.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
                <button type="button" className="cond-row-main" onClick={() => setSelected(l.id)} aria-label={`Ver carta de ${l.empleado_nombre}: ${l.motivo}`}
                  style={{ flex: '1 1 260px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '16px' }}>{TIPO_LLAMADA[l.tipo]?.icon ?? '📋'}</span>
                    <span style={{ fontWeight: 700, fontSize: '13px' }}>{l.empleado_nombre}</span>
                    <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{tipoLlamadaLabel(l.tipo)}{l.tipo === 'suspension' && l.dias_suspension ? ` · ${l.dias_suspension} día${l.dias_suspension === 1 ? '' : 's'}` : ''}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '1px 7px', borderRadius: '10px', background: estado.bg, color: estado.color }}>{estado.label}</span>
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)' }}>{l.motivo}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    Emitida {formatDateTime(l.emitido_en, 'es')}{l.emitido_por_nombre ? ` por ${l.emitido_por_nombre}` : ''}
                    {l.acuse_en ? ` · Recibida ${formatDateTime(l.acuse_en, 'es')}` : ''}
                  </div>
                </button>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                  {canEdit && l.estado === 'pendiente' && (
                    <button onClick={() => setAcusePresencial(l)} aria-label={`Registrar acuse en persona de ${l.empleado_nombre}`}
                      style={{ padding: '3px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Acuse en persona</button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => descargarPdf(l)} loading={generando === l.id} loadingText="PDF…" aria-label={`PDF de ${l.motivo}`}>PDF</Button>
                  {canDelete && (
                    <button onClick={() => eliminar(l)} aria-label={`Eliminar ${l.motivo}`} title="Eliminar"
                      style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detalle */}
      {detail && (
        <EditModal
          title={`${tipoLlamadaLabel(detail.tipo)} — ${detail.empleado_nombre}`}
          subtitle={detail.motivo}
          maxWidth="720px"
          fullScreenOnMobile
          onClose={() => setSelected(null)}
          footer={<>
            {canEdit && detail.estado === 'pendiente' && <Button onClick={() => { setAcusePresencial(detail); setSelected(null) }}>Registrar acuse en persona</Button>}
            {canChangeStatus && detail.estado !== 'anulada' && <Button variant="secondary" onClick={() => { setMotivoAnulacion(''); setAnulando(detail) }}>Anular</Button>}
            <Button variant="secondary" onClick={() => descargarPdf(detail)} loading={generando === detail.id} loadingText="Generando…">Descargar PDF</Button>
            <Button variant="secondary" onClick={() => setSelected(null)}>Cerrar</Button>
          </>}
        >
          <CartaLlamada carta={detail} proyectoNombre={proyectoNombre} />
          {detail.estado === 'pendiente' && (
            <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
              {detail.notificado_en
                ? `El empleado recibió el aviso en su cuenta el ${formatDateTime(detail.notificado_en, 'es')}; puede firmar desde Mi perfil.`
                : 'El empleado no tiene cuenta vinculada: registrá el acuse en persona cuando lea la carta.'}
            </div>
          )}
        </EditModal>
      )}

      {anulando && (
        <EditModal title="Anular la carta" subtitle="La carta y su acuse quedan en el historial como anulados; no se borran." maxWidth="480px"
          closeOnBackdropClick={!saving} closeOnEscape={!saving} onClose={() => { if (!saving) setAnulando(null) }}
          footer={<>
            <Button variant="secondary" onClick={() => setAnulando(null)} disabled={saving}>Cancelar</Button>
            <Button variant="danger" onClick={anular} loading={saving} loadingText="Anulando…">Anular</Button>
          </>}>
          <label htmlFor="lla-motivo-anulacion" style={lbl}>Motivo de la anulación *</label>
          <textarea id="lla-motivo-anulacion" style={{ ...inp, minHeight: '80px', resize: 'vertical' }} value={motivoAnulacion} onChange={e => setMotivoAnulacion(e.target.value)} autoFocus />
        </EditModal>
      )}

      {acusePresencial && (
        <AcuseLlamadaModal carta={acusePresencial} proyectoNombre={proyectoNombre} modo="presencial"
          onClose={() => setAcusePresencial(null)}
          onAcusado={() => { setAcusePresencial(null); onRefresh() }} />
      )}
    </div>
  )
}

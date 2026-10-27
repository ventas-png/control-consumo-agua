import { hoyLocalISO, esFechaCalendarioVencida, diasHastaFechaCalendario, formatNumber } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { tint } from '../../shared/statusTone'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { useProveedoresQuery } from '../../../domain/cxp/queries'
import { useAsignacionesQuery } from '../../../domain/proveedores/queries'
import type { ProveedorCatalogo } from '../../../types/proveedores'
import { ProveedorSelector } from '../../proveedores/ProveedorSelector'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { ImageGallery } from '../../shared/ImageGallery'
import { OperacionesLegadoPanel } from '../../proveedores/OperacionesLegadoPanel'
import { nombreAreaDe, normalizarNombreArea } from '../../../domain/condominios/areas'
import { AreaCondominio, ControlSistemaIncendio, TipoSistemaIncendio, TipoInspeccionIncendio, ResultadoInspeccionIncendio } from '../../../types'

interface Props {
  registros: ControlSistemaIncendio[]
  /** Catálogo compartido: la ubicación del equipo se ELIGE de aquí (tab Áreas), no se escribe. */
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  /** Visibilidad del tab Áreas: decide si se ofrece el atajo para configurarlas. */
  puedeConfigurarAreas: boolean
  onIrATab: (tabId: 'areas_config') => void
  onRefresh: () => void
}

const TIPOS_SISTEMA: { value: TipoSistemaIncendio; label: string; icon: string; color: string }[] = [
  { value: 'extintor',      label: 'Extintor',        icon: '🧯', color: 'var(--at-danger)' },
  { value: 'rociador',      label: 'Rociador',        icon: '🚿', color: 'var(--at-accent-2)' },
  { value: 'alarma',        label: 'Alarma',          icon: '🔔', color: 'var(--at-warning)' },
  { value: 'hidrant',       label: 'Hidrante',        icon: '🚒', color: 'var(--at-danger)' },
  { value: 'detector_humo', label: 'Detector humo',   icon: '💨', color: 'var(--at-accent)' },
  { value: 'gabinete',      label: 'Gabinete',        icon: '🗄️', color: 'var(--at-accent)' },
  { value: 'otro',          label: 'Otro',            icon: '📋', color: 'var(--at-ink-3)' },
]

const TIPOS_INSPECCION: { value: TipoInspeccionIncendio; label: string }[] = [
  { value: 'revision_visual',  label: 'Revisión visual' },
  { value: 'prueba_funcional', label: 'Prueba funcional' },
  { value: 'recarga',          label: 'Recarga' },
  { value: 'reemplazo',        label: 'Reemplazo' },
  { value: 'inspeccion_legal', label: 'Inspección legal' },
]

const RESULTADOS: { value: ResultadoInspeccionIncendio; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'aprobado',              label: 'Aprobado',             color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'observacion',           label: 'Observación',          color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '⚠️' },
  { value: 'requiere_mantenimiento',label: 'Req. mantenimiento',   color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '🔧' },
  { value: 'fuera_servicio',        label: 'Fuera de servicio',    color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '🚫' },
]

const tipoDe = (t: TipoSistemaIncendio) => TIPOS_SISTEMA.find(x => x.value === t)
const inspeccionDe = (t: TipoInspeccionIncendio) => TIPOS_INSPECCION.find(x => x.value === t)
const resultadoDe = (r: ResultadoInspeccionIncendio) => RESULTADOS.find(x => x.value === r)
const conProblema = (r: ControlSistemaIncendio) => r.resultado === 'fuera_servicio' || r.resultado === 'requiere_mantenimiento'

/** Un equipo es su tipo más su identificador (EXT-001, ALM-05…). */
const claveEquipo = (r: Pick<ControlSistemaIncendio, 'tipo_sistema' | 'identificador'>) => `${r.tipo_sistema}|${r.identificador.trim()}`

/** El más reciente: por fecha y, el mismo día, por hora de captura. */
const masReciente = (a: ControlSistemaIncendio, b: ControlSistemaIncendio) =>
  b.fecha.localeCompare(a.fecha) || (b.created_at ?? '').localeCompare(a.created_at ?? '')

function ResultadoBadge({ resultado }: { resultado: ResultadoInspeccionIncendio }) {
  const res = resultadoDe(resultado)
  return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: res?.bg, color: res?.color, whiteSpace: 'nowrap' }}>{res?.icon} {res?.label ?? resultado}</span>
}

export default function ControlSistemaIncendioTab({ registros, areas, proyectoId, companyId, moneda, canCreate, canEdit, puedeConfigurarAreas, onIrATab, onRefresh }: Props) {
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoSistemaIncendio | ''>('')
  const [filtroResultado, setFiltroResultado] = useState<ResultadoInspeccionIncendio | ''>('')

  const [form, setForm] = useState({
    fecha: hoyLocalISO(),
    tipo_sistema: 'extintor' as TipoSistemaIncendio,
    identificador: '', area_id: '',
    tipo_inspeccion: 'revision_visual' as TipoInspeccionIncendio,
    resultado: 'aprobado' as ResultadoInspeccionIncendio,
    fecha_vencimiento: '', proveedor_id: '', empresa_servicio: '', tecnico: '',
    costo: '', proxima_inspeccion: '', observaciones: '',
    fotos: [] as string[],
  })

  const lista = registros.filter(r =>
    (filtroTipo === '' || r.tipo_sistema === filtroTipo) &&
    (filtroResultado === '' || r.resultado === filtroResultado)
  )

  // Estado vigente de cada equipo: su inspección más reciente. Antes los
  // vencimientos y los problemas se contaban sobre todos los registros, así
  // que un extintor ya recargado seguía «vencido» por su registro viejo y una
  // falla ya corregida seguía contando.
  const vigentes = Object.values(registros.reduce<Record<string, ControlSistemaIncendio>>((acc, r) => {
    const k = claveEquipo(r)
    if (!acc[k] || masReciente(r, acc[k]) < 0) acc[k] = r
    return acc
  }, {}))
  const esVigente = (r: ControlSistemaIncendio) => vigentes.some(v => v.id === r.id)

  const vencidos = vigentes.filter(r => esFechaCalendarioVencida(r.fecha_vencimiento))
    .sort((a, b) => a.fecha_vencimiento!.localeCompare(b.fecha_vencimiento!))
  const proximosVencer = vigentes.filter(r => {
    const diff = diasHastaFechaCalendario(r.fecha_vencimiento)
    return diff !== null && diff >= 0 && diff <= 30
  }).sort((a, b) => a.fecha_vencimiento!.localeCompare(b.fecha_vencimiento!))

  const resumenPorTipo = TIPOS_SISTEMA.map(t => ({
    ...t,
    total: vigentes.filter(r => r.tipo_sistema === t.value).length,
    problemas: vigentes.filter(r => r.tipo_sistema === t.value && conProblema(r)).length,
  })).filter(t => t.total > 0)

  const identificadores = [...new Set(registros.map(r => r.identificador.trim()))].sort()

  // La ubicación es un área del catálogo (tab Áreas). Solo las activas se
  // ofrecen al registrar; las inactivas siguen nombrando lo ya registrado.
  const areasActivas = [...areas]
    .filter(a => a.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const ubicacionDe = (r: ControlSistemaIncendio) => nombreAreaDe(r.area_id, areas, r.ubicacion)

  /**
   * Área activa donde quedó el equipo en su inspección anterior. Lo histórico
   * sin vincular se reconoce por su texto si coincide con UNA sola área.
   */
  function areaDelEquipo(previo: ControlSistemaIncendio): string {
    if (previo.area_id) return areasActivas.some(a => a.id === previo.area_id) ? previo.area_id : ''
    const norm = normalizarNombreArea(previo.ubicacion)
    const coinciden = norm ? areasActivas.filter(a => normalizarNombreArea(a.nombre) === norm) : []
    return coinciden.length === 1 ? coinciden[0].id : ''
  }

  // Al escribir un equipo ya registrado se proponen su tipo y su área, si el
  // área aún no se eligió.
  function elegirIdentificador(valor: string) {
    const previo = registros.filter(r => r.identificador.trim() === valor.trim()).sort(masReciente)[0]
    setForm(p => ({
      ...p,
      identificador: valor,
      ...(previo && !p.area_id ? { area_id: areaDelEquipo(previo), tipo_sistema: previo.tipo_sistema } : {}),
    }))
  }

  function abrirForm() {
    setForm(p => ({ ...p, fecha: hoyLocalISO() }))
    setDetalleId(null)
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  // La empresa de servicio sale del CATÁLOGO COMPARTIDO por id (el mismo de
  // Contabilidad y Operaciones), no de texto libre: así el registro sabe si el
  // proveedor sigue autorizado en este proyecto y el servidor lo valida al guardar.
  const { data: catalogo = [] } = useProveedoresQuery(companyId)
  const { data: asignaciones = [] } = useAsignacionesQuery(companyId, proyectoId)

  async function guardar() {
    if (saving) return
    const area = areas.find(a => a.id === form.area_id)
    if (!form.identificador.trim() || !area) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Identificador y ubicación (área) son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('control_sistema_incendio', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, tipo_sistema: form.tipo_sistema,
      // `ubicacion` es el snapshot del nombre del área al registrar.
      identificador: form.identificador.trim(), area_id: area.id, ubicacion: area.nombre.trim(),
      tipo_inspeccion: form.tipo_inspeccion, resultado: form.resultado,
      fecha_vencimiento: form.fecha_vencimiento || null,
      proveedor_id: form.proveedor_id || null,
      empresa_servicio: form.empresa_servicio.trim() || null,
      tecnico: form.tecnico.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      proxima_inspeccion: form.proxima_inspeccion || null,
      observaciones: form.observaciones.trim() || null,
      fotos: form.fotos,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, identificador: '', area_id: '', fecha_vencimiento: '', costo: '', proxima_inspeccion: '', observaciones: '', fotos: [] }))
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const filaAviso: CSSProperties = { width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 6, padding: '3px 6px', font: 'inherit', fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }

  const dinero = (v: number) => `${moneda}\u00a0${formatNumber(v, 2)}`

  // Se lee el registro vigente, no una copia.
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null
  const historialDetalle = detalle
    ? registros.filter(r => claveEquipo(r) === claveEquipo(detalle)).sort(masReciente)
    : []

  return (
    <div style={{ padding: 16 }}>
      {/* Atención: equipos cuya inspección vigente venció o vence en 30 días */}
      {(vencidos.length > 0 || proximosVencer.length > 0) && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-danger)', marginBottom: 4 }}>🚨 Atención requerida</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 1 }}>
            {vencidos.map(r => (
              <li key={r.id}>
                <button type="button" className="cond-barra-fila" style={filaAviso} onClick={() => setDetalleId(r.id)}>
                  ⚠ <strong>{r.identificador}</strong> · {ubicacionDe(r)} — <span style={{ color: 'var(--at-danger)', fontWeight: 600 }}>vencido ({r.fecha_vencimiento})</span>
                </button>
              </li>
            ))}
            {proximosVencer.map(r => (
              <li key={r.id}>
                <button type="button" className="cond-barra-fila" style={filaAviso} onClick={() => setDetalleId(r.id)}>
                  ⏰ <strong>{r.identificador}</strong> · {ubicacionDe(r)} — vence pronto ({r.fecha_vencimiento})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resumen por tipo: equipos y cuántos tienen problema; tocar filtra */}
      {resumenPorTipo.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))', gap: 8, marginBottom: 16 }}>
          {resumenPorTipo.map(t => {
            const activo = filtroTipo === t.value
            return (
              <button key={t.value} type="button" aria-pressed={activo} onClick={() => setFiltroTipo(activo ? '' : t.value)}
                style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${activo ? t.color : 'var(--at-line)'}`, background: activo ? tint(t.color, 9) : 'var(--at-surface)', font: 'inherit', color: 'var(--at-ink)', cursor: 'pointer', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.icon} {t.label}</div>
                <div style={{ fontSize: 11, color: t.problemas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: t.problemas > 0 ? 600 : 400 }}>
                  {t.total} equipo{t.total === 1 ? '' : 's'}{t.problemas > 0 ? ` · ${t.problemas} con problema` : ''}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 260px' }}>
          <select aria-label="Filtrar por sistema" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoSistemaIncendio | '')}>
            <option value="">Todos los sistemas</option>
            {TIPOS_SISTEMA.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <select aria-label="Filtrar por resultado" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroResultado} onChange={e => setFiltroResultado(e.target.value as ResultadoInspeccionIncendio | '')}>
            <option value="">Todos los resultados</option>
            {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <Button variant="danger" onClick={abrirForm}>+ Nueva inspección</Button>
        )}
      </div>

      {/* Nueva inspección en ventana (antes, en un panel al lado de una lista
          de 300px fijos: en el teléfono no cabían los dos). */}
      {mostrarForm && (
        <EditModal
          title="🧯 Nueva inspección contra incendios"
          maxWidth="640px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="incendio-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="incendio-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="incendio-identificador" style={lbl}>Identificador *</label>
              <input id="incendio-identificador" list="incendio-identificadores" style={inp} placeholder="EXT-001, ALM-05…" value={form.identificador} onChange={e => elegirIdentificador(e.target.value)} />
              <datalist id="incendio-identificadores">
                {identificadores.map(i => <option key={i} value={i} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="incendio-tipo" style={lbl}>Tipo de sistema</label>
              <select id="incendio-tipo" style={inp} value={form.tipo_sistema} onChange={e => setForm(p => ({ ...p, tipo_sistema: e.target.value as TipoSistemaIncendio }))}>
                {TIPOS_SISTEMA.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="incendio-ubicacion" style={lbl}>Ubicación *</label>
              <select id="incendio-ubicacion" style={inp} value={form.area_id} onChange={e => setForm(p => ({ ...p, area_id: e.target.value }))}>
                <option value="">— Selecciona un área —</option>
                {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
              </select>
              {areasActivas.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 4 }}>
                  Sin áreas activas.{' '}
                  {puedeConfigurarAreas
                    ? (
                      <button type="button" onClick={() => onIrATab('areas_config')}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--at-accent)', fontWeight: 600, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                        Crearlas en el tab Áreas
                      </button>
                    )
                    : 'Se dan de alta en el tab Áreas.'}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="incendio-fecha" style={lbl}>Fecha de inspección</label>
              <input id="incendio-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="incendio-inspeccion" style={lbl}>Tipo de inspección</label>
              <select id="incendio-inspeccion" style={inp} value={form.tipo_inspeccion} onChange={e => setForm(p => ({ ...p, tipo_inspeccion: e.target.value as TipoInspeccionIncendio }))}>
                {TIPOS_INSPECCION.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="incendio-resultado" style={lbl}>Resultado</label>
              <select id="incendio-resultado" style={inp} value={form.resultado} onChange={e => setForm(p => ({ ...p, resultado: e.target.value as ResultadoInspeccionIncendio }))}>
                {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="incendio-vencimiento" style={lbl}>Fecha de vencimiento</label>
              <input id="incendio-vencimiento" type="date" style={inp} value={form.fecha_vencimiento} onChange={e => setForm(p => ({ ...p, fecha_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="incendio-proxima" style={lbl}>Próxima inspección</label>
              <input id="incendio-proxima" type="date" min={form.fecha || undefined} style={inp} value={form.proxima_inspeccion} onChange={e => setForm(p => ({ ...p, proxima_inspeccion: e.target.value }))} />
            </div>
            <div>
              <ProveedorSelector
                proveedores={catalogo as ProveedorCatalogo[]} asignaciones={asignaciones} projectId={proyectoId}
                value={form.proveedor_id || null} soloHabilitados label="Empresa de servicio"
                onChange={(id, pr) => setForm(p => ({ ...p, proveedor_id: id ?? '', empresa_servicio: pr?.nombre ?? '' }))}
              />
            </div>
            <div>
              <label htmlFor="incendio-tecnico" style={lbl}>Técnico</label>
              <input id="incendio-tecnico" style={inp} value={form.tecnico} onChange={e => setForm(p => ({ ...p, tecnico: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="incendio-costo" style={lbl}>Costo ({moneda})</label>
              <input id="incendio-costo" type="number" inputMode="decimal" min="0" step="0.01" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="incendio-observaciones" style={lbl}>Observaciones</label>
              <textarea id="incendio-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
            {/* Etiqueta de recarga, manómetro, sello, el daño encontrado… */}
            <div style={{ gridColumn: '1 / -1' }}>
              <MultiImageUploader values={form.fotos} onChange={fotos => setForm(p => ({ ...p, fotos }))} folder="incendio" label="Imágenes" maxFiles={10} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle de la inspección en ventana, con el historial del equipo */}
      {detalle && (() => {
        const tipo = tipoDe(detalle.tipo_sistema)
        return (
          <EditModal
            title={`${tipo?.icon ?? '🧯'} ${detalle.identificador}`}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{tipo?.label ?? detalle.tipo_sistema} · 📍 {ubicacionDe(detalle)}</span>
                <ResultadoBadge resultado={detalle.resultado} />
              </span>
            }
            maxWidth="520px"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={<Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>}
          >
            <InspeccionDetalle registro={detalle} vigente={esVigente(detalle)} dinero={dinero} />
            {historialDetalle.length > 1 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: 4 }}>Historial del equipo ({historialDetalle.length})</div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {historialDetalle.map(h => (
                    <li key={h.id}>
                      <button type="button" className="cond-barra-fila" onClick={() => setDetalleId(h.id)} aria-current={h.id === detalle.id ? 'true' : undefined}
                        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', textAlign: 'left', background: h.id === detalle.id ? 'var(--at-surface-2)' : 'none', border: 'none', borderRadius: 6, padding: '6px 8px', font: 'inherit', fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                        <span>{h.fecha} · {inspeccionDe(h.tipo_inspeccion)?.label ?? h.tipo_inspeccion}</span>
                        <ResultadoBadge resultado={h.resultado} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </EditModal>
        )
      })()}

      {/* Historial: en el teléfono cada inspección es una tarjeta; tocarla
          abre su detalle y «Ver» es el camino de teclado. */}
      <DataTable<ControlSistemaIncendio>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '🧯', title: 'Sin registros' }}
        rowStyle={(r) => esVigente(r) && esFechaCalendarioVencida(r.fecha_vencimiento) ? { background: 'var(--at-danger-tint)' } : {}}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'identificador', header: 'Equipo', sortable: true,
            render: (r) => <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{tipoDe(r.tipo_sistema)?.icon} {r.identificador}</span> },
          { key: 'ubicacion', header: 'Ubicación', sortable: true,
            accessor: (r) => ubicacionDe(r),
            render: (r) => <span style={{ color: 'var(--at-ink-2)' }}>{ubicacionDe(r)}</span> },
          { key: 'fecha', header: 'Fecha', sortable: true,
            accessor: (r) => `${r.fecha} ${r.created_at ?? ''}`,
            render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.fecha}</span> },
          { key: 'tipo_inspeccion', header: 'Inspección', sortable: true, hideOnMobile: true,
            accessor: (r) => inspeccionDe(r.tipo_inspeccion)?.label ?? r.tipo_inspeccion,
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{inspeccionDe(r.tipo_inspeccion)?.label ?? r.tipo_inspeccion}</span> },
          { key: 'fecha_vencimiento', header: 'Vence', sortable: true,
            accessor: (r) => r.fecha_vencimiento ?? '',
            render: (r) => {
              if (!r.fecha_vencimiento) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
              const vencido = esVigente(r) && esFechaCalendarioVencida(r.fecha_vencimiento)
              return <span style={{ whiteSpace: 'nowrap', color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: vencido ? 600 : 400 }}>{r.fecha_vencimiento}{vencido ? ' · vencido' : ''}</span>
            } },
          { key: 'resultado', header: 'Resultado', sortable: true,
            accessor: (r) => resultadoDe(r.resultado)?.label ?? r.resultado,
            render: (r) => <ResultadoBadge resultado={r.resultado} /> },
          { key: 'ver', header: '', align: 'right',
            render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                {r.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                {(r.fotos?.length ?? 0) > 0 && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📷</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver inspección de ${r.identificador} del ${r.fecha}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<ControlSistemaIncendio>[]}
      />
      <OperacionesLegadoPanel companyId={companyId} tabla="control_sistema_incendio" projectId={proyectoId} canEdit={canEdit} />
    </div>
  )
}

/** Detalle de solo lectura de una inspección. */
function InspeccionDetalle({ registro: r, vigente, dinero }: { registro: ControlSistemaIncendio; vigente: boolean; dinero: (v: number) => string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  // Sólo la inspección vigente del equipo cuenta como vencida.
  const vencido = vigente && esFechaCalendarioVencida(r.fecha_vencimiento)
  return (
    <div>
      {!vigente && (
        <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--at-ink-3)' }}>
          Hay una inspección más reciente de este equipo (ver historial abajo).
        </div>
      )}
      {fila('Fecha', r.fecha)}
      {fila('Tipo de inspección', inspeccionDe(r.tipo_inspeccion)?.label ?? r.tipo_inspeccion)}
      {fila('Vencimiento', r.fecha_vencimiento
        ? <strong style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-ink-2)' }}>{r.fecha_vencimiento}{vencido ? ' · vencido' : ''}</strong>
        : '—')}
      {fila('Próxima inspección', r.proxima_inspeccion ? <strong style={{ color: 'var(--at-accent)' }}>{r.proxima_inspeccion}</strong> : '—')}
      {fila('Empresa de servicio', r.empresa_servicio ? <>{r.empresa_servicio}{!r.proveedor_id && <span style={{ color: 'var(--at-ink-3)' }}> (sin vincular al catálogo)</span>}</> : '—')}
      {fila('Técnico', r.tecnico || '—')}
      {fila('Costo', r.costo != null ? <strong style={{ color: 'var(--at-success)' }}>{dinero(r.costo)}</strong> : '—')}
      {r.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.observaciones}</p>
        </div>
      )}
      {r.fotos && r.fotos.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Imágenes ({r.fotos.length})</div>
          <ImageGallery urls={r.fotos} maxVisible={6} />
        </div>
      )}
    </div>
  )
}

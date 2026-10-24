import { hoyLocalISO, diasHastaFechaCalendario, formatNumber } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { situacionPoliza, vencidaSinMarcar, plazoPoliza, DIAS_AVISO_POLIZA, type SituacionPoliza } from '../../../domain/condominios/polizas'
import type { PolizaSeguro, TipoPoliza, EstadoPoliza } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { FileUploader } from '../../shared/FileUploader'
import { SecureFileLink } from '../../shared/SecureFileLink'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  polizas: PolizaSeguro[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.polizas.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoPoliza; label: string; icon: string }[] = [
  { value: 'incendio',             label: 'Incendio',              icon: '🔥' },
  { value: 'responsabilidad_civil',label: 'Resp. Civil',           icon: '⚖️' },
  { value: 'terremoto',            label: 'Terremoto',             icon: '🌍' },
  { value: 'inundacion',           label: 'Inundación',            icon: '🌊' },
  { value: 'robo',                 label: 'Robo',                  icon: '🔒' },
  { value: 'vida',                 label: 'Vida',                  icon: '❤️' },
  { value: 'otro',                 label: 'Otro',                  icon: '📋' },
]

/** Estado que se guarda (lo elige el usuario). */
const ESTADO_CONFIG: Record<EstadoPoliza, { label: string }> = {
  vigente:   { label: 'Vigente' },
  vencida:   { label: 'Vencida' },
  cancelada: { label: 'Cancelada' },
}

/** Situación de hoy (estado + fecha): lo que se muestra y por lo que se filtra. */
const SITUACION: Record<SituacionPoliza, { label: string; color: string; bg: string }> = {
  vigente:    { label: 'Vigente',    color: 'var(--at-success)',        bg: 'var(--at-success-tint)' },
  por_vencer: { label: 'Por vencer', color: 'var(--at-warning-strong)', bg: 'var(--at-warning-tint)' },
  vencida:    { label: 'Vencida',    color: 'var(--at-danger)',         bg: 'var(--at-danger-tint)' },
  cancelada:  { label: 'Cancelada',  color: 'var(--at-ink-3)',          bg: 'var(--at-chip)' },
}

type Filtro = 'todas' | 'vigentes' | 'por_vencer' | 'vencida' | 'cancelada'
const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'vigentes',   label: 'Vigentes' },
  { value: 'por_vencer', label: 'Por vencer' },
  { value: 'vencida',    label: 'Vencidas' },
  { value: 'cancelada',  label: 'Canceladas' },
  { value: 'todas',      label: 'Todas' },
]

const tipoInfo = (t: TipoPoliza) => TIPOS.find(x => x.value === t) ?? TIPOS[TIPOS.length - 1]

const blank = (): Partial<PolizaSeguro> => ({
  numero_poliza: '', aseguradora: '', tipo: 'incendio', descripcion: '',
  suma_asegurada: undefined, prima_anual: undefined,
  fecha_inicio: hoyLocalISO(),
  fecha_vencimiento: '', estado: 'vigente',
  agente_nombre: '', agente_telefono: '', agente_email: '', documento_url: '', notas: '',
})

const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box', minWidth: 0 }
const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

function Chip({ situacion }: { situacion: SituacionPoliza }) {
  const s = SITUACION[situacion]
  return <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</span>
}

/** Fila «rótulo — valor» del detalle. */
function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 13.5 }}>
      <span style={{ color: 'var(--at-ink-3)', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--at-ink)', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{children}</span>
    </div>
  )
}

export function PolizasTab({ polizas, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('vigentes')
  const [form, setForm] = useState<Partial<PolizaSeguro>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  // Un cambio de estado a la vez: un segundo toque no lo repite.
  const [cambiandoEstado, setCambiandoEstado] = useState(false)

  const situacion = (p: PolizaSeguro) => situacionPoliza(p)
  const cuenta = (s: SituacionPoliza) => polizas.filter(p => situacion(p) === s).length
  const vigentes = polizas.filter(p => ['vigente', 'por_vencer'].includes(situacion(p)))
  const porVencer = cuenta('por_vencer')
  const vencidas = cuenta('vencida')
  const sinMarcar = polizas.filter(p => vencidaSinMarcar(p)).length
  // Sólo lo que sigue cubierto hoy (antes sumaba también las vencidas sin marcar).
  const primaTotal = vigentes.reduce((s, p) => s + (p.prima_anual ?? 0), 0)

  const pasaFiltro = (p: PolizaSeguro, f: Filtro) => {
    const s = situacion(p)
    return f === 'todas' || (f === 'vigentes' ? s === 'vigente' || s === 'por_vencer' : s === f)
  }
  const filtered = polizas.filter(p => pasaFiltro(p, filtro))

  // Montos con el formato regional de la app (antes, el del navegador).
  const dinero = (v: number) => `${moneda}\u00a0${formatNumber(v, 2)}`

  // Se lee el registro vigente, no una copia.
  const detalle = detalleId ? polizas.find(p => p.id === detalleId) ?? null : null

  function startEdit(p: PolizaSeguro) {
    setForm({
      numero_poliza: p.numero_poliza, aseguradora: p.aseguradora, tipo: p.tipo,
      descripcion: p.descripcion ?? '', suma_asegurada: p.suma_asegurada ?? undefined,
      prima_anual: p.prima_anual ?? undefined, fecha_inicio: p.fecha_inicio,
      fecha_vencimiento: p.fecha_vencimiento, estado: p.estado,
      agente_nombre: p.agente_nombre ?? '', agente_telefono: p.agente_telefono ?? '',
      agente_email: p.agente_email ?? '', documento_url: p.documento_url ?? '', notas: p.notas ?? '',
    })
    setEditId(p.id)
    setDetalleId(null)
    setShowForm(true)
  }

  function abrirNueva() {
    // Una edición cancelada no se cuela en la póliza nueva.
    if (editId) { setEditId(null); setForm(blank()) }
    setDetalleId(null)
    setShowForm(true)
  }

  // Cancelar cierra sin borrar lo escrito; no se cierra a mitad del guardado.
  function cerrarForm() { if (!saving) setShowForm(false) }

  async function handleSave() {
    if (saving) return
    if (!form.numero_poliza?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el número de póliza.' })
    if (!form.aseguradora?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la aseguradora.' })
    // Inicio también es obligatorio en la base: antes, al borrarlo, el error llegaba de la base.
    if (!form.fecha_inicio) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha de inicio.' })
    if (!form.fecha_vencimiento) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha de vencimiento.' })
    if (form.fecha_vencimiento < form.fecha_inicio) return notify({ variant: 'warning', title: 'Fechas', text: 'El vencimiento no puede ser anterior al inicio.' })
    if ((form.suma_asegurada ?? 0) < 0 || (form.prima_anual ?? 0) < 0) return notify({ variant: 'warning', title: 'Montos', text: 'La suma asegurada y la prima no pueden ser negativas.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      numero_poliza: form.numero_poliza!.trim(), aseguradora: form.aseguradora!.trim(),
      tipo: form.tipo ?? 'incendio', descripcion: form.descripcion || null,
      suma_asegurada: form.suma_asegurada ?? null, prima_anual: form.prima_anual ?? null,
      fecha_inicio: form.fecha_inicio, fecha_vencimiento: form.fecha_vencimiento,
      estado: form.estado ?? 'vigente',
      agente_nombre: form.agente_nombre || null, agente_telefono: form.agente_telefono || null,
      agente_email: form.agente_email || null, documento_url: form.documento_url || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('polizas_seguro', editId, payload)
      : await createCondominioRow('polizas_seguro', payload)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setShowForm(false); setEditId(null); setForm(blank()); onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar póliza?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('polizas_seguro', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setDetalleId(null)
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoPoliza) {
    if (cambiandoEstado) return
    setCambiandoEstado(true)
    const { error } = await updateCondominioRow('polizas_seguro', id, { estado })
    setCambiandoEstado(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  function compartirWhatsApp(p: PolizaSeguro) {
    const dias = diasHastaFechaCalendario(p.fecha_vencimiento)
    const msg = `🛡️ Póliza ${p.numero_poliza}\nAseguradora: ${p.aseguradora}\nTipo: ${tipoInfo(p.tipo).label}\nVencimiento: ${p.fecha_vencimiento}${dias !== null ? ` (${plazoPoliza(dias)})` : ''}\nEstado: ${SITUACION[situacion(p)].label}${p.prima_anual ? `\nPrima anual: ${moneda} ${formatNumber(p.prima_anual, 2)}` : ''}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Pólizas de Seguro',
      proyectoNombre,
      headers: ['Póliza', 'Aseguradora', 'Tipo', 'Suma Asegurada', 'Prima Anual', 'Inicio', 'Vencimiento', 'Estado'],
      rows: filtered.map(p => {
        const dias = diasHastaFechaCalendario(p.fecha_vencimiento)
        const s = situacion(p)
        return [p.numero_poliza, p.aseguradora, tipoInfo(p.tipo).label, p.suma_asegurada != null ? `${moneda} ${formatNumber(p.suma_asegurada, 2)}` : '—', p.prima_anual != null ? `${moneda} ${formatNumber(p.prima_anual, 2)}` : '—', p.fecha_inicio, p.fecha_vencimiento, `${SITUACION[s].label}${dias !== null && s !== 'cancelada' ? ` (${plazoPoliza(dias)})` : ''}`]
      }),
      rightAlignCols: [3, 4],
      filename: `polizas-${hoyLocalISO()}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`polizas-${hoyLocalISO()}`, [{
      name: 'Pólizas',
      headers: ['Póliza', 'Aseguradora', 'Tipo', 'Suma Asegurada', 'Prima Anual', 'Inicio', 'Vencimiento', 'Estado', 'Agente', 'Teléfono Agente'],
      rows: polizas.map(p => [p.numero_poliza, p.aseguradora, tipoInfo(p.tipo).label, p.suma_asegurada ?? '', p.prima_anual ?? '', p.fecha_inicio, p.fecha_vencimiento, SITUACION[situacion(p)].label, p.agente_nombre ?? '', p.agente_telefono ?? '']),
    }])
  }

  const kpi = (filtroKpi: Filtro | null, icono: string, label: string, valor: string, color: string, aria?: string) => {
    const contenido = (
      <>
        <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', fontWeight: 600 }}>{icono} {label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 2, overflowWrap: 'anywhere' }}>{valor}</div>
      </>
    )
    const estilo: CSSProperties = { background: 'var(--at-surface)', border: `1.5px solid ${filtroKpi && filtro === filtroKpi ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: 12, padding: '10px 14px', textAlign: 'left', font: 'inherit', color: 'inherit', minWidth: 0 }
    return filtroKpi
      ? <button type="button" className="cond-kpi-link" onClick={() => setFiltro(filtroKpi)} aria-pressed={filtro === filtroKpi} aria-label={aria} style={{ ...estilo, cursor: 'pointer' }}>{contenido}</button>
      : <div style={estilo}>{contenido}</div>
  }

  return (
    <div style={{ padding: 'clamp(14px, 4vw, 24px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--at-ink)' }}>🛡️ Pólizas de Seguro</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={exportarPDF} disabled={polizas.length === 0}>📄 PDF</Button>
          <Button size="sm" variant="secondary" onClick={exportarXlsx} disabled={polizas.length === 0}>📊 Excel</Button>
          {canCreate && <Button size="sm" onClick={abrirNueva}>+ Nueva póliza</Button>}
        </div>
      </div>

      {/* Resumen: cada cifra filtra la lista */}
      {polizas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 10, marginBottom: 14 }}>
          {kpi('vigentes', '🛡️', 'Vigentes', String(vigentes.length), 'var(--at-success)', `Vigentes: ${vigentes.length}`)}
          {kpi('por_vencer', '⏰', `Vencen en ${DIAS_AVISO_POLIZA} días`, String(porVencer), porVencer > 0 ? 'var(--at-warning-strong)' : 'var(--at-ink-3)', `Por vencer: ${porVencer}`)}
          {kpi('vencida', '⚠️', 'Vencidas', String(vencidas), vencidas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', `Vencidas: ${vencidas}`)}
          {kpi(null, '💰', 'Prima anual vigente', dinero(primaTotal), 'var(--at-primary)')}
        </div>
      )}

      {sinMarcar > 0 && (
        <div role="status" style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: '6px 10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--at-danger)', fontWeight: 600, flex: '1 1 220px' }}>
            ⚠️ {sinMarcar} póliza{sinMarcar > 1 ? 's' : ''} ya venci{sinMarcar > 1 ? 'eron' : 'ó'} y sigue{sinMarcar > 1 ? 'n' : ''} marcada{sinMarcar > 1 ? 's' : ''} como vigente{sinMarcar > 1 ? 's' : ''}: renuévela{sinMarcar > 1 ? 's' : ''} o márquela{sinMarcar > 1 ? 's' : ''} como vencida{sinMarcar > 1 ? 's' : ''}.
          </span>
          {filtro !== 'vencida' && <Button size="sm" variant="secondary" onClick={() => setFiltro('vencida')}>Ver vencidas</Button>}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {FILTROS.map(f => {
          const n = polizas.filter(p => pasaFiltro(p, f.value)).length
          return (
            <button key={f.value} type="button" onClick={() => setFiltro(f.value)} aria-pressed={filtro === f.value}
              style={{ padding: '5px 12px', borderRadius: 20, border: '1.5px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                borderColor: filtro === f.value ? 'var(--at-primary)' : 'var(--at-line)',
                background: filtro === f.value ? 'var(--at-primary-soft)' : 'var(--at-surface)',
                color: filtro === f.value ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
              {f.label} ({n})
            </button>
          )
        })}
      </div>

      {/* Nueva / editar en ventana (antes, un formulario encima de la lista que
          en el teléfono la empujaba hacia abajo). */}
      {showForm && (
        <EditModal
          title={editId ? `✏️ Editar póliza ${form.numero_poliza ?? ''}`.trim() : '🛡️ Nueva póliza'}
          maxWidth="680px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button type="submit" form="poliza-form" loading={saving} loadingText="Guardando…">{editId ? 'Guardar cambios' : 'Crear póliza'}</Button>
          </>}
        >
          <form id="poliza-form" onSubmit={e => { e.preventDefault(); void handleSave() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 195px), 1fr))', gap: 12, alignItems: 'start' }}>
            <div>
              <label htmlFor="poliza-numero" style={labelStyle}>No. de póliza *</label>
              <input id="poliza-numero" style={inputStyle} value={form.numero_poliza ?? ''} onChange={e => setForm(f => ({ ...f, numero_poliza: e.target.value }))} placeholder="POL-0001" autoFocus />
            </div>
            <div>
              <label htmlFor="poliza-aseguradora" style={labelStyle}>Aseguradora *</label>
              <input id="poliza-aseguradora" style={inputStyle} value={form.aseguradora ?? ''} onChange={e => setForm(f => ({ ...f, aseguradora: e.target.value }))} placeholder="Nombre de la aseguradora" />
            </div>
            <div>
              <label htmlFor="poliza-tipo" style={labelStyle}>Tipo</label>
              <select id="poliza-tipo" style={inputStyle} value={form.tipo ?? 'incendio'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoPoliza }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="poliza-estado" style={labelStyle}>Estado</label>
              <select id="poliza-estado" style={inputStyle} value={form.estado ?? 'vigente'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoPoliza }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="poliza-suma" style={labelStyle}>Suma asegurada ({moneda})</label>
              <input id="poliza-suma" style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" value={form.suma_asegurada ?? ''} onChange={e => setForm(f => ({ ...f, suma_asegurada: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label htmlFor="poliza-prima" style={labelStyle}>Prima anual ({moneda})</label>
              <input id="poliza-prima" style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" value={form.prima_anual ?? ''} onChange={e => setForm(f => ({ ...f, prima_anual: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label htmlFor="poliza-inicio" style={labelStyle}>Fecha inicio *</label>
              <input id="poliza-inicio" style={inputStyle} type="date" value={form.fecha_inicio ?? ''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="poliza-vencimiento" style={labelStyle}>Fecha vencimiento *</label>
              <input id="poliza-vencimiento" style={inputStyle} type="date" min={form.fecha_inicio || undefined} value={form.fecha_vencimiento ?? ''} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="poliza-agente" style={labelStyle}>Agente</label>
              <input id="poliza-agente" style={inputStyle} value={form.agente_nombre ?? ''} onChange={e => setForm(f => ({ ...f, agente_nombre: e.target.value }))} placeholder="Nombre del agente" />
            </div>
            <div>
              <label htmlFor="poliza-agente-tel" style={labelStyle}>Tel. agente</label>
              <input id="poliza-agente-tel" style={inputStyle} type="tel" inputMode="tel" value={form.agente_telefono ?? ''} onChange={e => setForm(f => ({ ...f, agente_telefono: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="poliza-agente-email" style={labelStyle}>Email agente</label>
              <input id="poliza-agente-email" style={inputStyle} type="email" inputMode="email" value={form.agente_email ?? ''} onChange={e => setForm(f => ({ ...f, agente_email: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FileUploader
                value={form.documento_url ?? null}
                onChange={url => setForm(f => ({ ...f, documento_url: url ?? '' }))}
                folder="polizas"
                label="Documento de póliza (PDF)"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="poliza-descripcion" style={labelStyle}>Descripción / notas</label>
              <textarea id="poliza-descripcion" style={{ ...inputStyle, resize: 'vertical', minHeight: '56px', fontFamily: 'inherit' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Lista: en el teléfono cada póliza es una tarjeta; tocarla abre su
          detalle y «Ver» es el camino de teclado. Lo que vence primero, arriba. */}
      <DataTable<PolizaSeguro>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'fecha_vencimiento', direction: 'asc' }}
        onRowClick={(p) => setDetalleId(p.id)}
        emptyState={{ icon: '🛡️', title: polizas.length === 0 ? 'No hay pólizas registradas' : 'Ninguna póliza en este filtro' }}
        columns={[
          { key: 'numero_poliza', header: 'Póliza', sortable: true,
            render: (p) => (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>{tipoInfo(p.tipo).icon} {p.numero_poliza}</div>
                <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{p.aseguradora}</div>
              </div>
            ) },
          { key: 'tipo', header: 'Tipo', sortable: true, hideOnMobile: true,
            accessor: (p) => tipoInfo(p.tipo).label,
            render: (p) => <span style={{ fontSize: 12.5, color: 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>{tipoInfo(p.tipo).label}</span> },
          { key: 'suma_asegurada', header: 'Suma asegurada', align: 'right', sortable: true, hideOnMobile: true,
            accessor: (p) => p.suma_asegurada ?? 0,
            render: (p) => <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.suma_asegurada != null ? dinero(p.suma_asegurada) : '—'}</span> },
          { key: 'prima_anual', header: 'Prima anual', align: 'right', sortable: true,
            accessor: (p) => p.prima_anual ?? 0,
            render: (p) => <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.prima_anual != null ? dinero(p.prima_anual) : '—'}</span> },
          { key: 'fecha_vencimiento', header: 'Vence', sortable: true,
            accessor: (p) => p.fecha_vencimiento,
            render: (p) => {
              const dias = diasHastaFechaCalendario(p.fecha_vencimiento)
              const s = situacion(p)
              return (
                <div style={{ fontSize: 12.5 }}>
                  <div style={{ whiteSpace: 'nowrap' }}>{p.fecha_vencimiento}</div>
                  {dias !== null && s !== 'cancelada' && (
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: SITUACION[s].color }}>{plazoPoliza(dias)}</div>
                  )}
                </div>
              )
            } },
          { key: 'estado', header: 'Estado', sortable: true,
            accessor: (p) => SITUACION[situacion(p)].label,
            render: (p) => <Chip situacion={situacion(p)} /> },
          { key: 'ver', header: '', align: 'right',
            render: (p) => (
              <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(p.id)} aria-label={`Ver póliza ${p.numero_poliza}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<PolizaSeguro>[]}
      />

      {/* Detalle en ventana: datos, agente, documento y acciones (antes eran
          cuatro íconos y un selector en cada fila). */}
      {detalle && (() => {
        const s = situacion(detalle)
        const ti = tipoInfo(detalle.tipo)
        const dias = diasHastaFechaCalendario(detalle.fecha_vencimiento)
        return (
          <EditModal
            title={`${ti.icon} Póliza ${detalle.numero_poliza}`}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{detalle.aseguradora}</span>
                <Chip situacion={s} />
              </span>
            }
            maxWidth="560px"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={<>
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
              {canEdit && <Button onClick={() => startEdit(detalle)}>✏️ Editar</Button>}
            </>}
          >
            {vencidaSinMarcar(detalle) && (
              <div style={{ background: 'var(--at-danger-tint)', color: 'var(--at-danger)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
                Venció el {detalle.fecha_vencimiento} y sigue marcada como vigente: renuévela o márquela como vencida.
              </div>
            )}
            <Dato label="Tipo">{ti.icon} {ti.label}</Dato>
            <Dato label="Aseguradora">{detalle.aseguradora}</Dato>
            <Dato label="Suma asegurada">{detalle.suma_asegurada != null ? dinero(detalle.suma_asegurada) : '—'}</Dato>
            <Dato label="Prima anual">{detalle.prima_anual != null ? dinero(detalle.prima_anual) : '—'}</Dato>
            <Dato label="Inicio">{detalle.fecha_inicio}</Dato>
            <Dato label="Vencimiento">
              {detalle.fecha_vencimiento}
              {dias !== null && s !== 'cancelada' && <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: SITUACION[s].color }}>{plazoPoliza(dias)}</span>}
            </Dato>
            <Dato label="Agente">{detalle.agente_nombre || '—'}</Dato>
            {detalle.agente_telefono && <Dato label="Teléfono"><a href={`tel:${detalle.agente_telefono}`} style={{ color: 'var(--at-primary)' }}>{detalle.agente_telefono}</a></Dato>}
            {detalle.agente_email && <Dato label="Email"><a href={`mailto:${detalle.agente_email}`} style={{ color: 'var(--at-primary)' }}>{detalle.agente_email}</a></Dato>}
            <Dato label="Documento">
              {detalle.documento_url
                ? <SecureFileLink src={detalle.documento_url} style={{ color: 'var(--at-primary)', fontWeight: 600 }}>📄 Ver póliza</SecureFileLink>
                : '—'}
            </Dato>
            {detalle.descripcion && (
              <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--at-surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>{detalle.descripcion}</div>
            )}

            {canEdit && (
              <fieldset style={{ border: 'none', margin: '16px 0 0', padding: 0, minWidth: 0 }}>
                <legend style={{ ...labelStyle, padding: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 11 }}>Estado guardado</legend>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(Object.keys(ESTADO_CONFIG) as EstadoPoliza[]).map(e => {
                    const activo = detalle.estado === e
                    return (
                      <button key={e} type="button" aria-pressed={activo} disabled={cambiandoEstado}
                        onClick={() => { if (!activo) void handleEstado(detalle.id, e) }}
                        style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: cambiandoEstado ? 'default' : 'pointer', border: '1.5px solid',
                          borderColor: activo ? 'var(--at-primary)' : 'var(--at-line)', background: activo ? 'var(--at-primary-soft)' : 'var(--at-surface)', color: activo ? 'var(--at-primary)' : 'var(--at-ink-2)' }}>
                        {activo ? '✓ ' : ''}{ESTADO_CONFIG[e].label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--at-line)' }}>
              {detalle.estado !== 'cancelada' && <Button size="sm" variant="secondary" onClick={() => compartirWhatsApp(detalle)}>💬 Compartir por WhatsApp</Button>}
              {canDelete && <Button size="sm" variant="outline-danger" onClick={() => void handleDelete(detalle.id)} aria-label={`Eliminar ${detalle.numero_poliza}`}>🗑 Eliminar</Button>}
            </div>
          </EditModal>
        )
      })()}
    </div>
  )
}

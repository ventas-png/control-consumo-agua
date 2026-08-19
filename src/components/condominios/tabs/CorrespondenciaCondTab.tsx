import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties } from 'react'
import { createCondominioRowReturning, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { uploadCondominiosMedia } from '../../../domain/shared/storage'
import { buildUploadPath } from '../../../lib/fileValidation'
import { notificarPieza } from '../../../lib/paquetesNotify'
import { diasEnCustodia, diasParaVencer, SUBTIPOS } from '../../../domain/condominios/recepcion'
import { exportarExcel, exportarPDFTabla } from '../exportUtils'
import type { CategoriaCorrespondencia, EstadoCorrespondencia, PiezaRecepcion, Unidad } from '../../../types'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'
import { EditModal } from '../../shared/EditModal'
import { SignaturePad } from '../../shared/SignaturePad'
import { RecepcionBuscador } from './RecepcionBuscador'

interface Props {
  /** Piezas de clase 'correspondencia' (el loader ya filtra por clase). */
  correspondencia: PiezaRecepcion[]
  /** Piezas de clase 'paquete', solo para la bandeja unificada. */
  paquetes: PiezaRecepcion[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  puedeVerPaqueteria: boolean
  onIrATab?: (tab: 'paqueteria' | 'correspondencia') => void
  onRefresh: () => void
}

// Motor único (20260829000000): la correspondencia vive en `paquetes_recibidos`
// con clase='correspondencia'. La categoría documental es la columna `tipo`, el
// asunto es `descripcion`, la observación es `notas` y entrada/salida es
// `direccion`. La UI mantiene el vocabulario que entiende la administradora.
const TABLA = 'paquetes_recibidos'
const CAT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(SUBTIPOS.correspondencia).map(([k, v]) => [k, v.label]),
)
const ESTADO_STYLE: Record<string, { bg: string; color: string }> = {
  pendiente: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  atendido:  { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  archivado: { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
  devuelto:  { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

/** Días en custodia a partir de los cuales una pieza pendiente se considera estancada. */
const DIAS_CUSTODIA_ALERTA = 30

const BLANK = {
  direccion: 'entrante' as 'entrante' | 'saliente',
  categoria: 'carta' as CategoriaCorrespondencia,
  asunto: '', remitente: '', destinatario: '',
  fecha: hoyLocalISO(), numero_guia: '', empresa_mensajeria: '', prioridad: 'normal',
  observaciones: '', unidad_id: '', fecha_limite: '',
}

const EXPORT_HEADERS = [
  'Tipo', 'Categoría', 'Asunto', 'Unidad', 'Remitente', 'Destinatario', 'Mensajería',
  'Guía', 'Prioridad', 'Fecha', 'Plazo', 'Estado', 'Entregado a', 'Con firma',
]

function fechaCorta(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
}

/** Fecha del documento; cae a la de registro en filas sin fecha propia. */
function fechaDocumento(c: PiezaRecepcion): string {
  return c.fecha_pieza ?? c.hora_recepcion.slice(0, 10)
}

export function CorrespondenciaCondTab({
  correspondencia, paquetes, unidades, proyectoId, companyId, userId,
  canCreate, canEdit, puedeVerPaqueteria, onIrATab, onRefresh,
}: Props) {
  const [vista, setVista] = useState<'correspondencia' | 'recepcion'>('correspondencia')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [fotos, setFotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entrada' | 'salida'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoCorrespondencia>('todos')
  const [selected, setSelected] = useState<string | null>(null)
  const [firmando, setFirmando] = useState<PiezaRecepcion | null>(null)
  const [firmaNombre, setFirmaNombre] = useState('')
  const [firmaSaving, setFirmaSaving] = useState(false)

  const hoy = hoyLocalISO()

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function resetForm() {
    setForm({ ...BLANK }); setFotos([]); setShowForm(false)
  }

  async function handleSave() {
    if (!form.asunto.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El asunto es obligatorio.' })
    setSaving(true)
    const { data, error } = await createCondominioRowReturning(TABLA, {
      company_id: companyId, project_id: proyectoId,
      clase: 'correspondencia',
      // Sin unidad, la pieza va dirigida a la administración del condominio
      // (citaciones, facturas de proveedor): el motor lo exige explícito.
      unidad_id: form.unidad_id || null,
      destinatario_tipo: form.unidad_id ? 'unidad' : 'administracion',
      direccion: form.direccion,
      tipo: form.categoria,
      descripcion: form.asunto.trim(),
      remitente: form.remitente || null, destinatario: form.destinatario || null,
      fecha_pieza: form.fecha, num_guia: form.numero_guia || null,
      empresa_mensajeria: form.empresa_mensajeria.trim() || null,
      prioridad: form.prioridad, notas: form.observaciones || null,
      estado: 'pendiente',
      fecha_limite: form.fecha_limite || null,
      fotos: fotos.length ? fotos : null,
      // Trazabilidad: quién recibió la pieza en recepción. Sin esto, una
      // notificación legal no tiene cadena de custodia.
      recibido_por: userId,
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    // Aviso al residente, igual que paquetería. Solo cuando la pieza va a una
    // unidad: la dirigida a la administración no tiene a quién avisarle, y su
    // plazo ya lo vigila la alerta del Panel General.
    if (form.unidad_id && data?.id) {
      try { await notificarPieza(data.id as string) } catch { /* best-effort: el registro ya quedó */ }
    }
    notify({
      variant: 'success', title: 'Correspondencia registrada', duration: 1600,
      text: form.unidad_id ? 'Se avisó al residente.' : 'Dirigida a la administración.',
    })
    resetForm(); onRefresh()
  }

  /** Cierra la pieza dejando la marca de quién la sacó de custodia y cuándo. */
  async function cambiarEstado(id: string, estado: EstadoCorrespondencia) {
    const patch: Record<string, unknown> = { estado }
    // 'atendido' y 'devuelto' son salidas de custodia y sellan quién y cuándo.
    // 'archivado' no: archivar no es entregar ni devolver.
    if (estado === 'atendido' || estado === 'devuelto') {
      patch.hora_entrega = new Date().toISOString()
      patch.entregado_por = userId
      patch.entregado_via = 'porteria'
    }
    const { error } = await updateCondominioRow(TABLA, id, patch)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleFirmaEntrega(file: File) {
    if (!firmando) return
    setFirmaSaving(true)
    try {
      const path = buildUploadPath(`${proyectoId}/correspondencia-firmas`, 'firma.png', 'png')
      const { error: upErr } = await uploadCondominiosMedia(path, file, { contentType: 'image/png', upsert: false })
      if (upErr) { notify({ variant: 'error', title: 'Error', text: upErr }); return }
      const { error } = await updateCondominioRow(TABLA, firmando.id, {
        estado: 'atendido', hora_entrega: new Date().toISOString(), entregado_por: userId,
        firma_path: path, entregado_a_nombre: firmaNombre.trim() || null, entregado_via: 'porteria',
      })
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
      setFirmando(null); setFirmaNombre(''); onRefresh()
    } finally {
      setFirmaSaving(false)
    }
  }

  const esEntrada = (c: PiezaRecepcion) => c.direccion !== 'saliente' && c.direccion !== 'saliente_tercero'

  const filtered = correspondencia
    .filter(c => filtroTipo === 'todos' || (filtroTipo === 'entrada') === esEntrada(c))
    .filter(c => filtroEstado === 'todos' || c.estado === filtroEstado)

  const entrada    = correspondencia.filter(esEntrada).length
  const salida     = correspondencia.length - entrada
  const pendientes = correspondencia.filter(c => c.estado === 'pendiente').length
  const urgentes   = correspondencia.filter(c => c.prioridad === 'urgente' && c.estado === 'pendiente').length
  const vencidos   = correspondencia.filter(c =>
    c.estado === 'pendiente' && c.fecha_limite && diasParaVencer(c.fecha_limite, hoy) < 0).length
  // Piezas que llevan demasiado en custodia sin que nadie las reclame: el
  // candidato natural a devolver al remitente.
  const estancados = correspondencia.filter(c =>
    c.estado === 'pendiente' && diasEnCustodia(c, hoy) >= DIAS_CUSTODIA_ALERTA).length

  const detail = selected ? correspondencia.find(c => c.id === selected) : null

  function buildExportRows(): (string | number)[][] {
    return filtered.map(c => [
      esEntrada(c) ? 'Entrada' : 'Salida',
      CAT_LABELS[c.tipo] ?? c.tipo,
      c.descripcion,
      c.unidad_nombre ?? '',
      c.remitente ?? '',
      c.destinatario ?? '',
      c.empresa_mensajeria ?? '',
      c.num_guia ?? '',
      c.prioridad,
      fechaDocumento(c),
      c.fecha_limite ?? '',
      c.estado,
      c.entregado_a_nombre ?? '',
      c.firma_path ? 'Sí' : '',
    ])
  }

  function exportarExcelLista() {
    if (filtered.length === 0) { notify({ variant: 'info', title: 'Sin datos', text: 'No hay correspondencia para exportar con el filtro actual.' }); return }
    exportarExcel('correspondencia', [{ name: 'Correspondencia', headers: EXPORT_HEADERS, rows: buildExportRows() }])
  }
  function exportarPDFLista() {
    if (filtered.length === 0) { notify({ variant: 'info', title: 'Sin datos', text: 'No hay correspondencia para exportar con el filtro actual.' }); return }
    exportarPDFTabla({
      titulo: 'Correspondencia',
      subtitulo: `${filtered.length} registros · ${pendientes} pendientes${vencidos ? ` · ${vencidos} con plazo vencido` : ''}`,
      headers: EXPORT_HEADERS, rows: buildExportRows(),
      filename: 'correspondencia', landscape: true,
    })
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

  const SegBtn = ({ id, label }: { id: 'correspondencia' | 'recepcion'; label: string }) => (
    <button onClick={() => setVista(id)}
      style={{ padding: '8px 16px', borderRadius: '9px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
        border: '1.5px solid', borderColor: vista === id ? 'var(--at-primary)' : 'var(--at-line)',
        background: vista === id ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: vista === id ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
      {label}
    </button>
  )

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Correspondencia</h2>
        {canCreate && vista === 'correspondencia' && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar
          </button>
        )}
      </div>

      {/* Segmento: la pieza se administra aquí, pero se busca junto con paquetería */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <SegBtn id="correspondencia" label="📬 Correspondencia" />
        <SegBtn id="recepcion" label="🔎 Recepción (buscar todo)" />
      </div>

      {vista === 'recepcion' ? (
        <RecepcionBuscador
          piezas={[...correspondencia, ...paquetes]}
          puedeVerPaqueteria={puedeVerPaqueteria}
          puedeVerCorrespondencia
          origenActual="correspondencia"
          onIrATab={onIrATab}
        />
      ) : (
      <>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Entrada',   value: String(entrada),    color: 'var(--at-primary)' },
          { label: 'Salida',    value: String(salida),     color: 'var(--at-accent)' },
          { label: 'Pendiente', value: String(pendientes), color: 'var(--at-warning)' },
          { label: 'Urgente',   value: String(urgentes),   color: 'var(--at-danger)' },
          { label: 'Plazo vencido', value: String(vencidos), color: 'var(--at-danger)' },
          { label: `+${DIAS_CUSTODIA_ALERTA}d en custodia`, value: String(estancados), color: 'var(--at-warning-strong)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Registrar Correspondencia</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '10px' }}>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.direccion} onChange={e => setF('direccion', e.target.value as 'entrante' | 'saliente')}>
                <option value="entrante">📥 Entrada</option>
                <option value="saliente">📤 Salida</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Categoría</label>
              <select style={inputStyle} value={form.categoria} onChange={e => setF('categoria', e.target.value as CategoriaCorrespondencia)}>
                {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Prioridad</label>
              <select style={inputStyle} value={form.prioridad} onChange={e => setF('prioridad', e.target.value)}>
                <option value="normal">Normal</option>
                <option value="urgente">🔴 Urgente</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Asunto *</label>
              <input style={inputStyle} value={form.asunto} onChange={e => setF('asunto', e.target.value)} placeholder="Descripción del documento" autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Remitente</label>
              <input style={inputStyle} value={form.remitente} onChange={e => setF('remitente', e.target.value)} placeholder="Quién envía" />
            </div>
            <div>
              <label style={labelStyle}>Destinatario</label>
              <input style={inputStyle} value={form.destinatario} onChange={e => setF('destinatario', e.target.value)} placeholder="A quién va dirigido" />
            </div>
            <div>
              <label style={labelStyle}>N° guía / referencia</label>
              <input style={inputStyle} value={form.numero_guia} onChange={e => setF('numero_guia', e.target.value)} placeholder="Número de tracking" />
            </div>
            <div>
              <label style={labelStyle}>Empresa mensajería</label>
              <input style={inputStyle} value={form.empresa_mensajeria} onChange={e => setF('empresa_mensajeria', e.target.value)} placeholder="DHL, Correos, courier..." />
            </div>
            <div>
              <label style={labelStyle}>Unidad relacionada</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Administración —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha límite (plazo)</label>
              <input style={inputStyle} type="date" value={form.fecha_limite} onChange={e => setF('fecha_limite', e.target.value)} />
              <div style={{ fontSize: '10.5px', color: 'var(--at-ink-3)', marginTop: '3px' }}>Para notificaciones con plazo de respuesta.</div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <MultiImageUploader values={fotos} onChange={setFotos} folder="correspondencia" label="Fotos del documento / sobre" maxFiles={4} capture />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={resetForm}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['todos', 'entrada', 'salida'] as const).map(f => (
            <button key={f} onClick={() => setFiltroTipo(f)}
              style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                borderColor: filtroTipo === f ? 'var(--at-primary)' : 'var(--at-line)', background: filtroTipo === f ? 'var(--at-primary-soft)' : 'var(--at-surface)', color: filtroTipo === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)', fontWeight: filtroTipo === f ? 700 : 500 }}>
              {f === 'todos' ? 'Todos' : f === 'entrada' ? '📥 Entrada' : '📤 Salida'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['todos', 'pendiente', 'atendido', 'archivado', 'devuelto'] as const).map(f => (
            <button key={f} onClick={() => setFiltroEstado(f)}
              style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                borderColor: filtroEstado === f ? 'var(--at-accent)' : 'var(--at-line)', background: filtroEstado === f ? 'var(--at-accent-tint)' : 'var(--at-surface)', color: filtroEstado === f ? 'var(--at-accent-hover)' : 'var(--at-ink-3)', fontWeight: filtroEstado === f ? 700 : 500 }}>
              {f === 'todos' ? 'Todos estados' : f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
          <button onClick={exportarExcelLista} title="Exportar a Excel"
            style={{ padding: '5px 11px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink-2)' }}>⬇ Excel</button>
          <button onClick={exportarPDFLista} title="Exportar a PDF"
            style={{ padding: '5px 11px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink-2)' }}>⬇ PDF</button>
        </div>
      </div>

      {/* Split view */}
      <div style={{ display: 'grid', gridTemplateColumns: detail ? '1fr 340px' : '1fr', gap: '16px' }}>
        {/* List — F3.9: migrado a <DataTable> shared */}
        <div>
          <DataTable<PiezaRecepcion>
            data={filtered}
            rowKey="id"
            searchableKeys={['descripcion']}
            searchPlaceholder="Buscar asunto..."
            emptyState={{ icon: '📨', title: 'No hay correspondencia' }}
            defaultSort={{ key: 'fecha_pieza', direction: 'desc' }}
            onRowClick={(c) => setSelected(selected === c.id ? null : c.id)}
            rowStyle={(c) => selected === c.id ? { background: 'var(--at-primary-tint)' } : {}}
            columns={[
              {
                key: 'direccion',
                header: 'Tipo',
                sortable: true,
                render: (c) => (
                  <>
                    <span style={{ fontSize: '13px' }}>{esEntrada(c) ? '📥' : '📤'}</span>
                    {c.prioridad === 'urgente' && <span style={{ fontSize: '10px', marginLeft: '4px', color: 'var(--at-danger)', fontWeight: 700 }}>URG</span>}
                  </>
                ),
              },
              {
                key: 'descripcion',
                header: 'Asunto',
                sortable: true,
                render: (c) => (
                  <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>
                    {c.descripcion}
                    {(c.fotos?.length ?? 0) > 0 && <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginLeft: '6px' }}>📷 {c.fotos?.length}</span>}
                    {c.firma_path && <span style={{ fontSize: '11px', color: 'var(--at-success)', marginLeft: '6px' }}>✍</span>}
                  </span>
                ),
              },
              {
                key: 'tipo',
                header: 'Categoría',
                hideOnMobile: true,
                render: (c) => CAT_LABELS[c.tipo] ?? c.tipo,
              },
              { key: 'fecha_pieza', header: 'Fecha', sortable: true, render: (c) => fechaDocumento(c) },
              {
                key: 'hora_recepcion',
                header: 'En custodia',
                sortable: true,
                hideOnMobile: true,
                render: (c) => {
                  if (c.estado !== 'pendiente') return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
                  const dias = diasEnCustodia(c, hoy)
                  const alerta = dias >= DIAS_CUSTODIA_ALERTA
                  return (
                    <span style={{ fontSize: '11px', fontWeight: alerta ? 700 : 500, color: alerta ? 'var(--at-warning-strong)' : 'var(--at-ink-3)' }}>
                      {dias}d
                    </span>
                  )
                },
              },
              {
                key: 'fecha_limite',
                header: 'Plazo',
                sortable: true,
                hideOnMobile: true,
                render: (c) => <Plazo fechaLimite={c.fecha_limite} estado={c.estado} hoy={hoy} />,
              },
              {
                key: 'estado',
                header: 'Estado',
                sortable: true,
                render: (c) => {
                  const es = ESTADO_STYLE[c.estado]
                  return (
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es?.bg, color: es?.color }}>
                      {c.estado}
                    </span>
                  )
                },
              },
              {
                key: '__actions',
                header: '',
                render: (c) => (
                  canEdit && c.estado === 'pendiente' ? (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <button onClick={(e) => { e.stopPropagation(); setFirmando(c); setFirmaNombre(c.destinatario ?? '') }}
                        style={{ padding: '2px 7px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                        ✍ Entregar c/ firma
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); cambiarEstado(c.id, 'atendido') }}
                        style={{ padding: '2px 7px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                        Atender
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); cambiarEstado(c.id, 'devuelto') }}
                        title="La pieza vuelve al remitente sin haberse entregado"
                        style={{ padding: '2px 7px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                        ↩ Devolver
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); cambiarEstado(c.id, 'archivado') }}
                        style={{ padding: '2px 7px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                        Archivar
                      </button>
                    </div>
                  ) : null
                ),
              },
            ] satisfies DataTableColumn<PiezaRecepcion>[]}
          />
        </div>

        {/* Detail */}
        {detail && (
          <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', alignSelf: 'flex-start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>{esEntrada(detail) ? '📥' : '📤'}</span>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '16px' }}>✕</button>
            </div>
            <h3 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>{detail.descripcion}</h3>
            {([
              ['Categoría', CAT_LABELS[detail.tipo] ?? detail.tipo],
              ['Dirigida a', detail.unidad_nombre ?? (detail.destinatario_tipo === 'unidad' ? '—' : 'Administración')],
              ['Fecha', fechaDocumento(detail)],
              ['Plazo', detail.fecha_limite ?? '—'],
              ['Remitente', detail.remitente ?? '—'],
              ['Destinatario', detail.destinatario ?? '—'],
              ['Mensajería', detail.empresa_mensajeria ?? '—'],
              ['N° guía', detail.num_guia ?? '—'],
              ['Prioridad', detail.prioridad],
              ['Registrada', fechaCorta(detail.hora_recepcion)],
              ['Entregada', detail.hora_entrega ? fechaCorta(detail.hora_entrega) : '—'],
              ['Recibió', detail.entregado_a_nombre ?? '—'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--at-chip)', fontSize: '12px' }}>
                <span style={{ color: 'var(--at-ink-3)', fontWeight: 600 }}>{k}</span>
                <span style={{ color: 'var(--at-ink)' }}>{v}</span>
              </div>
            ))}
            {detail.fotos && detail.fotos.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                {detail.fotos.map(f => (
                  <SecureImage key={f} src={f} alt="" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)' }} />
                ))}
              </div>
            )}
            {detail.firma_path && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Acuse de recibo</div>
                <SecureImage src={detail.firma_path} alt="firma" style={{ width: '100%', height: '80px', objectFit: 'contain', background: '#fff', borderRadius: '8px', border: '1px solid var(--at-line)' }} />
              </div>
            )}
            {detail.notas && (
              <div style={{ marginTop: '10px', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '6px', fontSize: '12px', color: 'var(--at-ink-2)' }}>
                {detail.notas}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Entrega con firma — prueba de entrega de la pieza */}
      {firmando && (
        <EditModal
          title={`Acuse de recibo · ${firmando.unidad_nombre ?? firmando.destinatario ?? ''}`}
          onClose={() => { if (!firmaSaving) { setFirmando(null); setFirmaNombre('') } }}
          maxWidth="460px"
        >
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)' }}>{firmando.descripcion}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              Capture la firma de quien recibe. Queda como prueba de entrega con fecha y hora.
            </div>
          </div>
          <label style={labelStyle}>Nombre de quien recibe</label>
          <input value={firmaNombre} onChange={e => setFirmaNombre(e.target.value)} placeholder="Nombre y apellido" style={{ ...inputStyle, marginBottom: '14px' }} />
          <SignaturePad onSave={handleFirmaEntrega} onCancel={() => { setFirmando(null); setFirmaNombre('') }} saving={firmaSaving} saveLabel="Confirmar entrega" />
        </EditModal>
      )}
      </>
      )}
    </div>
  )
}

/** Semáforo del plazo legal: vencido / vence pronto / al día. */
function Plazo({ fechaLimite, estado, hoy }: { fechaLimite?: string | null; estado: string; hoy: string }) {
  if (!fechaLimite) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
  const dias = diasParaVencer(fechaLimite, hoy)
  if (Number.isNaN(dias)) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
  if (estado !== 'pendiente') return <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{fechaLimite}</span>
  const color = dias < 0 ? 'var(--at-danger)' : dias <= 3 ? 'var(--at-warning-strong)' : 'var(--at-ink-3)'
  const texto = dias < 0 ? `Vencido (${-dias}d)` : dias === 0 ? 'Vence hoy' : `${dias}d`
  return <span style={{ fontSize: '11px', fontWeight: dias <= 3 ? 700 : 500, color }}>{texto}</span>
}

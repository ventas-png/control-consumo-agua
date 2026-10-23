import { esFechaCalendarioVencida } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { ControlCamaraSeguridad, TipoCamara, EstadoCamara } from '../../../types'

interface Props {
  camaras: ControlCamaraSeguridad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoCamara; label: string; icon: string }[] = [
  { value: 'domo',    label: 'Domo',    icon: '🔵' },
  { value: 'bullet',  label: 'Bullet',  icon: '🔷' },
  { value: 'ptz',     label: 'PTZ',     icon: '🔄' },
  { value: 'fisheye', label: 'Fisheye', icon: '👁️' },
  { value: 'otro',    label: 'Otro',    icon: '📷' },
]

const ESTADOS: { value: EstadoCamara; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'activa',        label: 'Activa',         color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'falla',         label: 'Falla',          color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '⚠️' },
  { value: 'mantenimiento', label: 'Mantenimiento',  color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '🔧' },
  { value: 'sin_señal',     label: 'Sin señal',      color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '📵' },
  { value: 'inactiva',      label: 'Inactiva',       color: 'var(--at-ink-3)', bg: 'var(--at-chip)', icon: '⭕' },
]

const formVacio = () => ({
  codigo: '', nombre: '', ubicacion: '',
  tipo: 'domo' as TipoCamara,
  resolucion: '1080p', ip_address: '',
  grabacion: true, dias_retencion: '30',
  estado: 'activa' as EstadoCamara,
  ultimo_mantenimiento: '', proximo_mantenimiento: '',
  observaciones: '',
})

const tipoDe = (t: TipoCamara) => TIPOS.find(x => x.value === t)
const estadoDe = (e: EstadoCamara) => ESTADOS.find(x => x.value === e)
const conFalla = (c: ControlCamaraSeguridad) => c.estado === 'falla' || c.estado === 'sin_señal'

function EstadoBadge({ estado }: { estado: EstadoCamara }) {
  const est = estadoDe(estado)
  return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color, whiteSpace: 'nowrap' }}>{est?.icon} {est?.label ?? estado}</span>
}

export default function ControlCamarasTab({ camaras, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  // Cámara en edición (null: alta nueva). Antes se editaba «la seleccionada»
  // y, al guardar, el panel seguía mostrando la copia vieja.
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [cambiando, setCambiando] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCamara | ''>('')
  const [soloActivas, setSoloActivas] = useState(true)

  const [form, setForm] = useState(formVacio)

  const lista = camaras.filter(c =>
    (!soloActivas || c.activo) &&
    (filtroEstado === '' || c.estado === filtroEstado)
  )

  // Los contadores son de las cámaras en uso: antes «Activas» y «Con fallas»
  // contaban también las desactivadas (una dada de baja con falla seguía
  // sumando), mientras el desglose por estado no las contaba.
  const enUso = camaras.filter(c => c.activo)
  const porEstado = ESTADOS.map(e => ({ ...e, count: enUso.filter(c => c.estado === e.value).length }))
  const totalActivas = enUso.filter(c => c.estado === 'activa').length
  const totalFallas = enUso.filter(conFalla).length

  // Código repetido: se avisa (no se bloquea) al dar de alta o al cambiarlo.
  const codigoRepetido = !!form.codigo.trim() && camaras.some(c => c.id !== editId && c.codigo.trim().toLowerCase() === form.codigo.trim().toLowerCase())

  function abrirAlta() {
    setForm(formVacio())
    setEditId(null)
    setDetalleId(null)
    setMostrarForm(true)
  }

  function iniciarEdicion(c: ControlCamaraSeguridad) {
    setForm({
      codigo: c.codigo, nombre: c.nombre, ubicacion: c.ubicacion,
      tipo: c.tipo, resolucion: c.resolucion ?? '', ip_address: c.ip_address ?? '',
      grabacion: c.grabacion, dias_retencion: c.dias_retencion?.toString() ?? '',
      estado: c.estado,
      ultimo_mantenimiento: c.ultimo_mantenimiento ?? '',
      proximo_mantenimiento: c.proximo_mantenimiento ?? '',
      observaciones: c.observaciones ?? '',
    })
    setEditId(c.id)
    setDetalleId(null)
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) { setMostrarForm(false); setEditId(null) } }

  async function guardar() {
    if (saving) return
    if (!form.codigo.trim() || !form.nombre.trim() || !form.ubicacion.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Código, nombre y ubicación son obligatorios' }); return
    }
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      codigo: form.codigo.trim(), nombre: form.nombre.trim(), ubicacion: form.ubicacion.trim(),
      tipo: form.tipo, resolucion: form.resolucion.trim() || null,
      ip_address: form.ip_address.trim() || null, grabacion: form.grabacion,
      dias_retencion: form.dias_retencion ? parseInt(form.dias_retencion) : null,
      estado: form.estado,
      ultimo_mantenimiento: form.ultimo_mantenimiento || null,
      proximo_mantenimiento: form.proximo_mantenimiento || null,
      observaciones: form.observaciones.trim() || null,
    }
    const { error } = editId
      ? await updateCondominioRow('control_camaras_seguridad', editId, payload)
      : await createCondominioRow('control_camaras_seguridad', payload)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    const editada = editId
    setForm(formVacio()); setMostrarForm(false); setEditId(null)
    // Tras editar se vuelve al detalle de esa cámara, ya con los datos nuevos.
    if (editada) setDetalleId(editada)
    onRefresh()
  }

  // Antes estos cambios ignoraban el error: el botón no hacía nada y no decía por qué.
  async function actualizar(c: ControlCamaraSeguridad, cambios: Partial<ControlCamaraSeguridad>) {
    if (cambiando) return
    setCambiando(true)
    const { error } = await updateCondominioRow('control_camaras_seguridad', c.id, cambios)
    setCambiando(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  // Se lee la cámara vigente, no una copia.
  const detalle = detalleId ? camaras.find(c => c.id === detalleId) ?? null : null

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs de las cámaras en uso */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 12, marginBottom: 12 }}>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--at-success)' }}>{totalActivas}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Activas</div>
        </div>
        <div style={{ background: totalFallas > 0 ? 'var(--at-danger-tint)' : 'var(--at-chip)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: totalFallas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{totalFallas}</div>
          <div style={{ fontSize: 11, color: totalFallas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>Con fallas</div>
        </div>
        <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--at-accent)' }}>{camaras.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>Total registradas</div>
        </div>
      </div>

      {/* Desglose por estado de las cámaras en uso */}
      {porEstado.some(e => e.count > 0) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }} aria-label="Cámaras en uso por estado">
          {porEstado.filter(e => e.count > 0).map(e => (
            <span key={e.value} style={{ fontSize: 12, padding: '3px 9px', borderRadius: 10, background: e.bg, color: e.color, fontWeight: 600 }}>
              {e.icon} {e.label}: {e.count}
            </span>
          ))}
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: '8px 12px', flexWrap: 'wrap', alignItems: 'center', flex: '1 1 260px' }}>
          <select aria-label="Filtrar por estado" style={{ ...inp, width: 'auto', flex: '1 1 170px', maxWidth: 280 }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoCamara | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloActivas} onChange={e => setSoloActivas(e.target.checked)} />
            Solo en uso
          </label>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} cámaras</span>
        </div>
        {canCreate && (
          <Button onClick={abrirAlta}>+ Nueva cámara</Button>
        )}
      </div>

      {/* Alta y edición en ventana (antes, en un panel al lado de una lista
          de 300px fijos: en el teléfono no cabían los dos). */}
      {mostrarForm && (
        <EditModal
          title={editId ? '✏️ Editar cámara' : '📷 Nueva cámara'}
          maxWidth="640px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="camara-form" variant="success" loading={saving} loadingText="Guardando…">✅ {editId ? 'Actualizar' : 'Registrar'}</Button>
            </>
          }
        >
          <form
            id="camara-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="camara-codigo" style={lbl}>Código *</label>
              <input id="camara-codigo" style={inp} placeholder="CAM-001" value={form.codigo} onChange={e => setForm(p => ({ ...p, codigo: e.target.value }))} />
              {codigoRepetido && (
                <div role="alert" style={{ fontSize: 11, color: 'var(--at-warning-strong, var(--at-warning))', background: 'var(--at-warning-tint)', borderRadius: 6, padding: '4px 8px', marginTop: 4 }}>
                  Ya hay otra cámara con este código.
                </div>
              )}
            </div>
            <div>
              <label htmlFor="camara-nombre" style={lbl}>Nombre *</label>
              <input id="camara-nombre" style={inp} placeholder="Entrada principal" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="camara-tipo" style={lbl}>Tipo</label>
              <select id="camara-tipo" style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoCamara }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="camara-ubicacion" style={lbl}>Ubicación *</label>
              <input id="camara-ubicacion" style={inp} placeholder="Lobby, Estacionamiento nivel 1…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="camara-estado" style={lbl}>Estado</label>
              <select id="camara-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoCamara }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="camara-resolucion" style={lbl}>Resolución</label>
              <input id="camara-resolucion" style={inp} placeholder="1080p, 4K…" value={form.resolucion} onChange={e => setForm(p => ({ ...p, resolucion: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="camara-ip" style={lbl}>Dirección IP</label>
              <input id="camara-ip" style={{ ...inp, fontFamily: 'monospace' }} inputMode="decimal" placeholder="192.168.1.10" value={form.ip_address} onChange={e => setForm(p => ({ ...p, ip_address: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="camara-retencion" style={lbl}>Retención (días)</label>
              <input id="camara-retencion" type="number" inputMode="numeric" min="0" step="1" style={inp} value={form.dias_retencion} onChange={e => setForm(p => ({ ...p, dias_retencion: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="camara-ultimo" style={lbl}>Último mantenimiento</label>
              <input id="camara-ultimo" type="date" style={inp} value={form.ultimo_mantenimiento} onChange={e => setForm(p => ({ ...p, ultimo_mantenimiento: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="camara-proximo" style={lbl}>Próximo mantenimiento</label>
              <input id="camara-proximo" type="date" min={form.ultimo_mantenimiento || undefined} style={inp} value={form.proximo_mantenimiento} onChange={e => setForm(p => ({ ...p, proximo_mantenimiento: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.grabacion} onChange={e => setForm(p => ({ ...p, grabacion: e.target.checked }))} />
                🔴 Grabación activa
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="camara-observaciones" style={lbl}>Observaciones</label>
              <textarea id="camara-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle de la cámara en ventana */}
      {detalle && (
        <EditModal
          title={`📷 ${detalle.nombre}`}
          subtitle={
            <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{tipoDe(detalle.tipo)?.icon} {tipoDe(detalle.tipo)?.label ?? detalle.tipo} · {detalle.codigo} · 📍 {detalle.ubicacion}</span>
              <EstadoBadge estado={detalle.estado} />
              {!detalle.activo && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>Fuera de uso</span>}
            </span>
          }
          maxWidth="520px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={
            // Envuelve: con cuatro botones no caben en una línea del teléfono.
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              {canEdit && (
                <>
                  <Button variant="secondary" onClick={() => iniciarEdicion(detalle)}>✏️ Editar</Button>
                  {detalle.estado !== 'activa'
                    ? <Button variant="success" loading={cambiando} onClick={() => void actualizar(detalle, { estado: 'activa' })}>✅ Marcar activa</Button>
                    : <Button variant="outline-danger" loading={cambiando} onClick={() => void actualizar(detalle, { estado: 'falla' })}>⚠️ Reportar falla</Button>}
                  <Button variant="secondary" disabled={cambiando} onClick={() => void actualizar(detalle, { activo: !detalle.activo })}>
                    {detalle.activo ? 'Poner fuera de uso' : 'Volver a poner en uso'}
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
            </div>
          }
        >
          <CamaraDetalle camara={detalle} />
        </EditModal>
      )}

      {/* Cámaras: en el teléfono cada una es una tarjeta; tocarla abre su
          detalle y «Ver» es el camino de teclado. */}
      <DataTable<ControlCamaraSeguridad>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'codigo', direction: 'asc' }}
        searchableKeys={['codigo', 'nombre', 'ubicacion']}
        searchPlaceholder="Buscar código, nombre o ubicación..."
        emptyState={{ icon: '📷', title: 'Sin cámaras' }}
        rowStyle={(c) => !c.activo ? { opacity: 0.6 } : conFalla(c) ? { background: 'var(--at-danger-tint)' } : {}}
        onRowClick={(c) => setDetalleId(c.id)}
        columns={[
          { key: 'codigo', header: 'Cámara', sortable: true,
            render: (c) => (
              <span>
                <span style={{ fontWeight: 600 }}>{tipoDe(c.tipo)?.icon} {c.codigo}</span>
                <span style={{ color: 'var(--at-ink-2)' }}> — {c.nombre}</span>
              </span>
            ) },
          { key: 'ubicacion', header: 'Ubicación', sortable: true,
            render: (c) => <span style={{ color: 'var(--at-ink-2)' }}>{c.ubicacion}</span> },
          { key: 'grabacion', header: 'Grabación', hideOnMobile: true,
            accessor: (c) => c.grabacion ? 1 : 0,
            render: (c) => <span style={{ fontSize: 12, color: c.grabacion ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
              {c.grabacion ? '🔴 Grabando' : '⭕ Sin grabación'}{c.dias_retencion ? ` · ${c.dias_retencion} d` : ''}
            </span> },
          { key: 'proximo_mantenimiento', header: 'Próx. manto.', sortable: true, hideOnMobile: true,
            accessor: (c) => c.proximo_mantenimiento ?? '',
            render: (c) => {
              if (!c.proximo_mantenimiento) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
              const vencido = c.activo && esFechaCalendarioVencida(c.proximo_mantenimiento)
              return <span style={{ whiteSpace: 'nowrap', color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: vencido ? 600 : 400 }}>{c.proximo_mantenimiento}{vencido ? ' · vencido' : ''}</span>
            } },
          { key: 'estado', header: 'Estado', sortable: true,
            accessor: (c) => estadoDe(c.estado)?.label ?? c.estado,
            render: (c) => (
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <EstadoBadge estado={c.estado} />
                {!c.activo && <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>· fuera de uso</span>}
              </span>
            ) },
          { key: 'ver', header: '', align: 'right',
            render: (c) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                {c.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(c.id)} aria-label={`Ver cámara ${c.codigo}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<ControlCamaraSeguridad>[]}
      />
    </div>
  )
}

/** Detalle de solo lectura de una cámara. */
function CamaraDetalle({ camara: c }: { camara: ControlCamaraSeguridad }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  const vencido = c.activo && !!c.proximo_mantenimiento && esFechaCalendarioVencida(c.proximo_mantenimiento)
  return (
    <div>
      {fila('Resolución', c.resolucion || '—')}
      {fila('Grabación', <span style={{ color: c.grabacion ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: 600 }}>{c.grabacion ? '🔴 Activa' : '⭕ Inactiva'}</span>)}
      {fila('Retención', c.dias_retencion ? `${c.dias_retencion} días` : '—')}
      {fila('Dirección IP', c.ip_address ? <span style={{ fontFamily: 'monospace' }}>{c.ip_address}</span> : '—')}
      {fila('Último mantenimiento', c.ultimo_mantenimiento || '—')}
      {fila('Próximo mantenimiento', c.proximo_mantenimiento
        ? <strong style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-accent)' }}>{c.proximo_mantenimiento}{vencido ? ' · vencido' : ''}</strong>
        : '—')}
      {c.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{c.observaciones}</p>
        </div>
      )}
    </div>
  )
}

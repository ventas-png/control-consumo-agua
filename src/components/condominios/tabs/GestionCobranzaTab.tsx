import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { notify, confirm } from '../../shared/Dialog'
import { GestionCobranza, EtapaCobranza, EstadoCobranza, TipoContactoCobranza, ContactoCobranza, Unidad } from '../../../types'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  cobranzas: GestionCobranza[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ETAPAS: { value: EtapaCobranza; label: string; color: string; bg: string }[] = [
  { value: 'aviso_amistoso',       label: 'Aviso amistoso',       color: 'var(--at-primary-2)', bg: 'var(--at-primary-soft)' },
  { value: 'recordatorio',         label: 'Recordatorio',         color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'carta_formal',         label: 'Carta formal',         color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'suspension_servicios', label: 'Susp. servicios',      color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  { value: 'cobro_juridico',       label: 'Cobro jurídico',       color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  { value: 'acuerdo_pago',         label: 'Acuerdo de pago',      color: 'var(--at-accent)', bg: 'var(--at-accent-tint-2)' },
  { value: 'resuelto',             label: 'Resuelto',             color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
]

const FLUJO_ETAPAS: EtapaCobranza[] = [
  'aviso_amistoso', 'recordatorio', 'carta_formal', 'suspension_servicios', 'cobro_juridico',
]

const TIPOS_CONTACTO: { value: TipoContactoCobranza; label: string }[] = [
  { value: 'llamada', label: '📞 Llamada' },
  { value: 'email',   label: '📧 Email' },
  { value: 'visita',  label: '🚪 Visita' },
  { value: 'mensaje', label: '💬 Mensaje' },
]

export default function GestionCobranzaTab({ cobranzas, unidades, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<GestionCobranza | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCobranza | ''>('activo')

  const [form, setForm] = useState({
    unidad_id: '', responsable: '', monto_adeudado: '',
    monto_pagado: '0', etapa: 'aviso_amistoso' as EtapaCobranza,
    fecha_inicio: new Date().toISOString().split('T')[0], observaciones: '',
  })

  const [contactoForm, setContactoForm] = useState({
    tipo: 'llamada' as TipoContactoCobranza, resultado: '', siguiente_accion: '',
  })

  const lista = cobranzas.filter(c => filtroEstado === '' || c.estado === filtroEstado)

  const totalAdeudado = lista.filter(c => c.estado === 'activo').reduce((s, c) => s + c.monto_adeudado, 0)
  const totalRecuperado = cobranzas.filter(c => c.estado === 'resuelto').reduce((s, c) => s + c.monto_adeudado, 0)

  async function guardar() {
    if (!form.responsable.trim() || !form.monto_adeudado) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Responsable y monto son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await supabase.from('gestion_cobranza').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      responsable: form.responsable.trim(),
      monto_adeudado: parseFloat(form.monto_adeudado),
      monto_pagado: parseFloat(form.monto_pagado) || 0,
      etapa: form.etapa, fecha_inicio: form.fecha_inicio,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ unidad_id: '', responsable: '', monto_adeudado: '', monto_pagado: '0', etapa: 'aviso_amistoso', fecha_inicio: new Date().toISOString().split('T')[0], observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function avanzarEtapa(c: GestionCobranza) {
    const idx = FLUJO_ETAPAS.indexOf(c.etapa)
    if (idx < 0 || idx >= FLUJO_ETAPAS.length - 1) return
    const siguiente = FLUJO_ETAPAS[idx + 1]
    const { error } = await supabase.from('gestion_cobranza').update({ etapa: siguiente }).eq('id', c.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (selected?.id === c.id) setSelected(prev => prev ? { ...prev, etapa: siguiente } : null)
    onRefresh()
  }

  async function marcarResuelto(c: GestionCobranza) {
    const res = await confirm({ title: 'Marcar como resuelto', text: '¿Confirmar resolución del cobro?', icon: 'question', confirmText: 'Resolver' })
    if (!res.isConfirmed) return
    const { error } = await supabase.from('gestion_cobranza').update({
      estado: 'resuelto' as EstadoCobranza, etapa: 'resuelto' as EtapaCobranza,
      fecha_resolucion: new Date().toISOString().split('T')[0],
    }).eq('id', c.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (selected?.id === c.id) setSelected(prev => prev ? { ...prev, estado: 'resuelto', etapa: 'resuelto', fecha_resolucion: new Date().toISOString().split('T')[0] } : null)
    onRefresh()
  }

  async function registrarContacto(c: GestionCobranza) {
    if (!contactoForm.resultado.trim()) return
    const nuevo: ContactoCobranza = {
      fecha: new Date().toISOString().split('T')[0],
      tipo: contactoForm.tipo,
      resultado: contactoForm.resultado.trim(),
      siguiente_accion: contactoForm.siguiente_accion.trim() || undefined,
    }
    const nuevos = [...c.contactos, nuevo]
    const { error } = await supabase.from('gestion_cobranza').update({ contactos: nuevos }).eq('id', c.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setSelected(prev => prev ? { ...prev, contactos: nuevos } : null)
    setContactoForm({ tipo: 'llamada', resultado: '', siguiente_accion: '' })
    onRefresh()
  }

  async function actualizarMontos(c: GestionCobranza) {
    const { value: vals } = await Swal.fire({
      title: 'Actualizar montos',
      html: `
        <div style="margin-bottom:10px"><label style="font-size:13px">Monto adeudado (${moneda}):</label>
        <input id="adeudado" class="swal2-input" type="number" value="${c.monto_adeudado}" style="margin-top:4px"></div>
        <div><label style="font-size:13px">Monto pagado (${moneda}):</label>
        <input id="pagado" class="swal2-input" type="number" value="${c.monto_pagado}" style="margin-top:4px"></div>
      `,
      showCancelButton: true, confirmButtonText: 'Actualizar',
      preConfirm: () => ({
        adeudado: parseFloat((document.getElementById('adeudado') as HTMLInputElement)?.value || '0'),
        pagado: parseFloat((document.getElementById('pagado') as HTMLInputElement)?.value || '0'),
      }),
    })
    if (!vals) return
    const { error } = await supabase.from('gestion_cobranza').update({ monto_adeudado: vals.adeudado, monto_pagado: vals.pagado }).eq('id', c.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (selected?.id === c.id) setSelected(prev => prev ? { ...prev, monto_adeudado: vals.adeudado, monto_pagado: vals.pagado } : null)
    onRefresh()
  }

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Gestión de Cobranza',
      proyectoNombre,
      headers: ['Responsable', 'Unidad', 'Adeudado', 'Pagado', 'Pendiente', 'Etapa', 'Estado', 'Inicio', 'Contactos'],
      rows: cobranzas.map(c => {
        const u = unidades.find(u => u.id === c.unidad_id)
        return [c.responsable, u?.nombre ?? '—', `${moneda} ${c.monto_adeudado.toLocaleString()}`, `${moneda} ${c.monto_pagado.toLocaleString()}`, `${moneda} ${(c.monto_adeudado - c.monto_pagado).toLocaleString()}`, ETAPAS.find(e => e.value === c.etapa)?.label ?? c.etapa, c.estado, c.fecha_inicio, c.contactos.length]
      }),
      rightAlignCols: [2, 3, 4, 8],
      filename: `cobranza-${new Date().toISOString().slice(0, 10)}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`cobranza-${new Date().toISOString().slice(0, 10)}`, [{
      name: 'Cobranza',
      headers: ['Responsable', 'Unidad', 'Adeudado', 'Pagado', 'Pendiente', 'Etapa', 'Estado', 'Inicio', 'Observaciones'],
      rows: cobranzas.map(c => {
        const u = unidades.find(u => u.id === c.unidad_id)
        return [c.responsable, u?.nombre ?? '', c.monto_adeudado, c.monto_pagado, c.monto_adeudado - c.monto_pagado, ETAPAS.find(e => e.value === c.etapa)?.label ?? c.etapa, c.estado, c.fecha_inicio, c.observaciones ?? '']
      }),
    }])
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 320, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Cobranza ({lista.length})</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={exportarPDF} disabled={cobranzas.length === 0} style={{ padding: '4px 8px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📄</button>
              <button onClick={exportarXlsx} disabled={cobranzas.length === 0} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📊</button>
              {canCreate && (
                <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                  style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                  + Nueva
                </button>
              )}
            </div>
          </div>
          {/* KPI montos */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <div style={{ background: 'var(--at-danger-tint)', borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontWeight: 700, color: 'var(--at-danger)', fontSize: 13 }}>{moneda} {totalAdeudado.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--at-danger)' }}>Adeudado activo</div>
            </div>
            <div style={{ background: 'var(--at-success-tint)', borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontWeight: 700, color: 'var(--at-success)', fontSize: 13 }}>{moneda} {totalRecuperado.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--at-success)' }}>Recuperado</div>
            </div>
          </div>
          <select style={inp} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoCobranza | '')}>
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="resuelto">Resueltos</option>
            <option value="cancelado">Cancelados</option>
          </select>
        </div>

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin registros</div>}

        {lista.map(c => {
          const unidad = unidades.find(u => u.id === c.unidad_id)
          const etapa = ETAPAS.find(e => e.value === c.etapa)
          const pendiente = c.monto_adeudado - c.monto_pagado
          return (
            <div key={c.id} onClick={() => { setSelected(c); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === c.id ? 'var(--at-accent-tint)' : 'var(--at-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.responsable}</span>
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, background: etapa?.bg, color: etapa?.color }}>{etapa?.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                {unidad && <span>{unidad.nombre} · </span>}
                Pendiente: <span style={{ color: 'var(--at-danger)', fontWeight: 600 }}>{moneda} {pendiente.toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 1 }}>{c.fecha_inicio} · {c.contactos.length} contactos</div>
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nueva gestión de cobranza</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Unidad</label>
                <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                  <option value="">— Sin unidad —</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Responsable / Deudor *</label>
                <input style={inp} placeholder="Nombre del residente" value={form.responsable} onChange={e => setForm(p => ({ ...p, responsable: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Monto adeudado ({moneda}) *</label>
                <input type="number" style={inp} value={form.monto_adeudado} onChange={e => setForm(p => ({ ...p, monto_adeudado: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Monto pagado ({moneda})</label>
                <input type="number" style={inp} value={form.monto_pagado} onChange={e => setForm(p => ({ ...p, monto_pagado: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Etapa inicial</label>
                <select style={inp} value={form.etapa} onChange={e => setForm(p => ({ ...p, etapa: e.target.value as EtapaCobranza }))}>
                  {ETAPAS.filter(e => e.value !== 'resuelto').map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Fecha inicio</label>
                <input type="date" style={inp} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Observaciones</label>
                <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Crear'}
              </button>
              <button onClick={() => setMostrarForm(false)}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const unidad = unidades.find(u => u.id === selected.unidad_id)
          const etapa = ETAPAS.find(e => e.value === selected.etapa)
          const pendiente = selected.monto_adeudado - selected.monto_pagado
          const idxEtapa = FLUJO_ETAPAS.indexOf(selected.etapa)
          const siguienteEtapa = idxEtapa >= 0 && idxEtapa < FLUJO_ETAPAS.length - 1 ? FLUJO_ETAPAS[idxEtapa + 1] : null
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.responsable}</div>
                  {unidad && <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginTop: 2 }}>Unidad: {unidad.nombre}</div>}
                  <div style={{ marginTop: 6 }}>
                    <span style={{ padding: '4px 12px', borderRadius: 10, background: etapa?.bg, color: etapa?.color, fontSize: 13, fontWeight: 600 }}>{etapa?.label}</span>
                  </div>
                </div>
                {canEdit && selected.estado === 'activo' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {siguienteEtapa && (
                      <button onClick={() => avanzarEtapa(selected)}
                        style={{ padding: '7px 12px', background: 'var(--at-warning)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                        ↑ {ETAPAS.find(e => e.value === siguienteEtapa)?.label}
                      </button>
                    )}
                    <button onClick={() => actualizarMontos(selected)}
                      style={{ padding: '7px 12px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      💰 Montos
                    </button>
                    <button onClick={() => marcarResuelto(selected)}
                      style={{ padding: '7px 12px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ✅ Resolver
                    </button>
                  </div>
                )}
              </div>

              {/* Montos */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                {[
                  { label: 'Adeudado', value: `${moneda} ${selected.monto_adeudado.toLocaleString()}`, color: 'var(--at-danger)' },
                  { label: 'Pagado', value: `${moneda} ${selected.monto_pagado.toLocaleString()}`, color: 'var(--at-success)' },
                  { label: 'Pendiente', value: `${moneda} ${pendiente.toLocaleString()}`, color: pendiente > 0 ? 'var(--at-warning)' : 'var(--at-success)' },
                ].map(k => (
                  <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Progreso etapa */}
              <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 8 }}>Progresión de etapas</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ETAPAS.map((e, i) => {
                    const etapasIdx = ETAPAS.findIndex(et => et.value === selected.etapa)
                    const activa = selected.etapa === e.value
                    const pasada = i < etapasIdx
                    return (
                      <span key={e.value} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 8, background: activa ? e.bg : pasada ? 'var(--at-chip)' : 'var(--at-surface)', color: activa ? e.color : pasada ? 'var(--at-ink-3)' : 'var(--at-line-strong)', border: `1px solid ${activa ? e.color : 'var(--at-line)'}`, fontWeight: activa ? 700 : 400 }}>
                        {e.label}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Contactos */}
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Historial de contactos ({selected.contactos.length})</div>
              {selected.contactos.length === 0 && <div style={{ color: 'var(--at-ink-3)', fontSize: 13, marginBottom: 12 }}>Sin contactos registrados</div>}
              {selected.contactos.map((c, i) => (
                <div key={i} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 6, display: 'flex', gap: 12 }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: 12 }}>{TIPOS_CONTACTO.find(t => t.value === c.tipo)?.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{c.fecha}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13 }}>{c.resultado}</div>
                    {c.siguiente_accion && <div style={{ fontSize: 11, color: 'var(--at-accent)', marginTop: 2 }}>→ {c.siguiente_accion}</div>}
                  </div>
                </div>
              ))}
              {canEdit && selected.estado === 'activo' && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: 12, marginTop: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Registrar contacto</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginBottom: 8 }}>
                    <select style={inp} value={contactoForm.tipo} onChange={e => setContactoForm(p => ({ ...p, tipo: e.target.value as TipoContactoCobranza }))}>
                      {TIPOS_CONTACTO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input style={inp} placeholder="Resultado del contacto…" value={contactoForm.resultado} onChange={e => setContactoForm(p => ({ ...p, resultado: e.target.value }))} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
                    <input style={inp} placeholder="Siguiente acción (opcional)" value={contactoForm.siguiente_accion} onChange={e => setContactoForm(p => ({ ...p, siguiente_accion: e.target.value }))} />
                    <button onClick={() => registrarContacto(selected)}
                      style={{ padding: '7px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      + Agregar
                    </button>
                  </div>
                </div>
              )}

              {selected.observaciones && (
                <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 8, padding: '10px 12px', marginTop: 12, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--at-warning-strong)', marginBottom: 3 }}>Observaciones</div>
                  {selected.observaciones}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona un expediente o crea uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}

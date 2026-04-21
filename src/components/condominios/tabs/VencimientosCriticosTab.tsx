import React, { useState, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import {
  VencimientoExtra, CategoriaVencimiento,
  PolizaSeguro, ContratoProveedor, InspeccionNormativa,
} from '../../../types'

interface Props {
  vencimientosExtra: VencimientoExtra[]
  polizas: PolizaSeguro[]
  contratosProveedores: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface ItemVenc {
  id: string
  titulo: string
  tipo: string
  entidad?: string
  fecha: string
  dias: number
  origen: 'poliza' | 'contrato' | 'inspeccion' | 'extra'
  renovado?: boolean
}

const CAT_CFG: Record<CategoriaVencimiento, { label: string; icon: string; color: string }> = {
  contrato:      { label: 'Contrato',      icon: '📄', color: '#2563eb' },
  permiso:       { label: 'Permiso',       icon: '🏛️', color: '#7c3aed' },
  certificacion: { label: 'Certificación', icon: '🎖️', color: '#0369a1' },
  seguro:        { label: 'Seguro',        icon: '🛡️', color: '#d97706' },
  otro:          { label: 'Otro',          icon: '📌', color: '#6b7280' },
}

function urgencia(dias: number): { color: string; bg: string; label: string } {
  if (dias < 0)  return { color: '#ef4444', bg: '#fef2f2', label: 'Vencido' }
  if (dias <= 15) return { color: '#dc2626', bg: '#fee2e2', label: `${dias}d` }
  if (dias <= 30) return { color: '#ea580c', bg: '#fff7ed', label: `${dias}d` }
  if (dias <= 60) return { color: '#d97706', bg: '#fef3c7', label: `${dias}d` }
  return { color: '#16a34a', bg: '#f0fdf4', label: `${dias}d` }
}

const BLANK = {
  titulo: '', categoria: 'otro' as CategoriaVencimiento,
  fecha_vencimiento: '', entidad: '', monto: '',
  alerta_dias: '30', notas: '',
}

export default function VencimientosCriticosTab({ vencimientosExtra, polizas, contratosProveedores, inspecciones, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroOrigen, setFiltroOrigen] = useState<'todos' | 'poliza' | 'contrato' | 'inspeccion' | 'extra'>('todos')
  const [filtroPlazo, setFiltroPlazo] = useState<'todos' | 'vencido' | '30' | '60' | '90'>('todos')
  const [form, setForm] = useState(BLANK)

  const hoy = new Date()
  const diffDias = (fechaStr: string) =>
    Math.floor((new Date(fechaStr).getTime() - hoy.getTime()) / 86400000)

  const items: ItemVenc[] = useMemo(() => {
    const list: ItemVenc[] = []

    polizas.filter(p => p.fecha_vencimiento).forEach(p => list.push({
      id: p.id, titulo: `${p.tipo} — ${p.aseguradora}`,
      tipo: 'Póliza', entidad: p.aseguradora,
      fecha: p.fecha_vencimiento, dias: diffDias(p.fecha_vencimiento),
      origen: 'poliza',
    }))

    contratosProveedores.filter(c => c.fecha_fin).forEach(c => list.push({
      id: c.id, titulo: `${c.servicio} — ${c.proveedor_nombre}`,
      tipo: 'Contrato proveedor', entidad: c.proveedor_nombre,
      fecha: c.fecha_fin!, dias: diffDias(c.fecha_fin!),
      origen: 'contrato',
    }))

    inspecciones.filter(i => i.fecha_proxima).forEach(i => list.push({
      id: i.id, titulo: `Inspección ${i.tipo}`,
      tipo: 'Inspección', entidad: i.entidad_inspectora ?? undefined,
      fecha: i.fecha_proxima!, dias: diffDias(i.fecha_proxima!),
      origen: 'inspeccion',
    }))

    vencimientosExtra.filter(v => !v.renovado).forEach(v => list.push({
      id: v.id, titulo: v.titulo,
      tipo: CAT_CFG[v.categoria].label, entidad: v.entidad ?? undefined,
      fecha: v.fecha_vencimiento, dias: diffDias(v.fecha_vencimiento),
      origen: 'extra', renovado: v.renovado,
    }))

    return list.sort((a, b) => a.dias - b.dias)
  }, [polizas, contratosProveedores, inspecciones, vencimientosExtra])

  const filtrados = items.filter(i => {
    if (filtroOrigen !== 'todos' && i.origen !== filtroOrigen) return false
    if (filtroPlazo === 'vencido' && i.dias >= 0) return false
    if (filtroPlazo === '30' && (i.dias < 0 || i.dias > 30)) return false
    if (filtroPlazo === '60' && (i.dias < 0 || i.dias > 60)) return false
    if (filtroPlazo === '90' && (i.dias < 0 || i.dias > 90)) return false
    return true
  })

  const vencidos = items.filter(i => i.dias < 0).length
  const proximos30 = items.filter(i => i.dias >= 0 && i.dias <= 30).length
  const proximos60 = items.filter(i => i.dias > 30 && i.dias <= 60).length

  async function guardar() {
    if (!form.titulo.trim() || !form.fecha_vencimiento) {
      Swal.fire('Error', 'Título y fecha son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('vencimientos_extra').insert({
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), categoria: form.categoria,
      fecha_vencimiento: form.fecha_vencimiento,
      entidad: form.entidad.trim() || null,
      monto: form.monto ? parseFloat(form.monto) : null,
      alerta_dias: parseInt(form.alerta_dias) || 30,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function marcarRenovado(id: string) {
    await supabase.from('vencimientos_extra').update({ renovado: true }).eq('id', id)
    onRefresh()
  }

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  const ORIGEN_LABEL = { todos: 'Todos', poliza: 'Pólizas', contrato: 'Contratos', inspeccion: 'Inspecciones', extra: 'Manuales' }
  const PLAZO_LABEL = { todos: 'Todos', vencido: 'Vencidos', '30': '≤ 30 días', '60': '≤ 60 días', '90': '≤ 90 días' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Vencidos', val: vencidos, bg: '#fef2f2', color: '#ef4444' },
          { label: 'Próximos 30d', val: proximos30, bg: '#fff7ed', color: '#ea580c' },
          { label: 'Próximos 60d', val: proximos60, bg: '#fef3c7', color: '#d97706' },
          { label: 'Total seguidos', val: items.length, bg: '#f9fafb', color: '#374151' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(Object.keys(ORIGEN_LABEL) as (keyof typeof ORIGEN_LABEL)[]).map(o => (
            <button key={o} onClick={() => setFiltroOrigen(o as typeof filtroOrigen)}
              style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroOrigen === o ? '#2563eb' : '#e2e8f0', background: filtroOrigen === o ? '#eff6ff' : '#fff', color: filtroOrigen === o ? '#2563eb' : '#64748b' }}>
              {ORIGEN_LABEL[o]}
            </button>
          ))}
          <span style={{ width: 1, background: '#e5e7eb', margin: '0 4px' }} />
          {(Object.keys(PLAZO_LABEL) as (keyof typeof PLAZO_LABEL)[]).map(p => (
            <button key={p} onClick={() => setFiltroPlazo(p as typeof filtroPlazo)}
              style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroPlazo === p ? '#ef4444' : '#e2e8f0', background: filtroPlazo === p ? '#fef2f2' : '#fff', color: filtroPlazo === p ? '#ef4444' : '#64748b' }}>
              {PLAZO_LABEL[p]}
            </button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Agregar vencimiento'}
          </button>
        )}
      </div>

      {/* Formulario manual */}
      {mostrarForm && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo vencimiento manual</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Título *</label>
              <input style={inp} value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} placeholder="Ej. Permiso municipal operación 2027" />
            </div>
            <div>
              <label style={lbl}>Categoría</label>
              <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaVencimiento }))}>
                {(Object.keys(CAT_CFG) as CategoriaVencimiento[]).map(c => <option key={c} value={c}>{CAT_CFG[c].icon} {CAT_CFG[c].label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Fecha de vencimiento *</label>
              <input type="date" style={inp} value={form.fecha_vencimiento} onChange={e => setForm(p => ({ ...p, fecha_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Entidad / proveedor</label>
              <input style={inp} value={form.entidad} onChange={e => setForm(p => ({ ...p, entidad: e.target.value }))} placeholder="Quién emitió / proveedor" />
            </div>
            <div>
              <label style={lbl}>Alerta anticipada (días)</label>
              <input type="number" min={1} style={inp} value={form.alerta_dias} onChange={e => setForm(p => ({ ...p, alerta_dias: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Monto ({moneda}) — opcional</label>
              <input type="number" step="0.01" style={inp} value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Agregar'}
          </button>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🗓️</div>
          {items.length === 0 ? 'Sin vencimientos — agrega uno manualmente o verifica pólizas, contratos e inspecciones' : 'Sin resultados para el filtro seleccionado'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtrados.map(item => {
            const u = urgencia(item.dias)
            const origenIcon = { poliza: '🛡️', contrato: '🤝', inspeccion: '🏛️', extra: '📌' }[item.origen]
            return (
              <div key={`${item.origen}-${item.id}`} style={{ background: '#fff', border: `1px solid ${item.dias < 0 ? '#fecaca' : item.dias <= 30 ? '#fed7aa' : '#e5e7eb'}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{origenIcon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{item.titulo}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {item.tipo}{item.entidad ? ` · ${item.entidad}` : ''}
                    {' · '}{new Date(item.fecha).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: u.bg, color: u.color }}>
                    {item.dias < 0 ? `Vencido hace ${Math.abs(item.dias)}d` : u.label === `${item.dias}d` ? `En ${item.dias}d` : u.label}
                  </div>
                  {item.origen === 'extra' && canEdit && !item.renovado && (
                    <button onClick={() => marcarRenovado(item.id)}
                      style={{ marginTop: 4, padding: '2px 8px', background: '#f0fdf4', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 10, color: '#16a34a' }}>
                      ✓ Renovado
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

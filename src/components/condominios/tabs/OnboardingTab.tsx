import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { OnboardingResidente, EstadoOnboarding, Unidad } from '../../../types'
import Swal from 'sweetalert2'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  onboardings: OnboardingResidente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CHECKLIST: { key: keyof OnboardingResidente; label: string; icon: string }[] = [
  { key: 'llaves_entregadas',    label: 'Llaves entregadas',      icon: '🔑' },
  { key: 'reglamento_firmado',   label: 'Reglamento firmado',     icon: '📜' },
  { key: 'deposito_pagado',      label: 'Depósito pagado',        icon: '💰' },
  { key: 'datos_registrados',    label: 'Datos registrados',      icon: '📋' },
  { key: 'accesos_configurados', label: 'Accesos configurados',   icon: '🚪' },
  { key: 'inspeccion_unidad',    label: 'Inspección de unidad',   icon: '🔍' },
  { key: 'bienvenida_enviada',   label: 'Bienvenida enviada',     icon: '👋' },
]

const ESTADO_CONFIG: Record<EstadoOnboarding, { label: string; color: string; bg: string }> = {
  en_proceso: { label: 'En Proceso', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  completado: { label: 'Completado', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelado:  { label: 'Cancelado',  color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}

const blank = (): Partial<OnboardingResidente> => ({
  nombre_residente: '', unidad_id: undefined, fecha_ingreso: new Date().toISOString().slice(0, 10),
  tipo: 'propietario', estado: 'en_proceso',
  llaves_entregadas: false, reglamento_firmado: false, deposito_pagado: false,
  datos_registrados: false, accesos_configurados: false, inspeccion_unidad: false,
  bienvenida_enviada: false, notas: '',
})

export function OnboardingTab({ onboardings, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoOnboarding | 'todos'>('en_proceso')
  const [form, setForm] = useState<Partial<OnboardingResidente>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = onboardings.filter(o => filtroEstado === 'todos' || o.estado === filtroEstado)
  const enProceso = onboardings.filter(o => o.estado === 'en_proceso').length

  function progreso(o: OnboardingResidente) {
    const items = CHECKLIST.map(c => o[c.key] as boolean)
    return Math.round((items.filter(Boolean).length / items.length) * 100)
  }

  function startEdit(o: OnboardingResidente) {
    setForm({
      nombre_residente: o.nombre_residente, unidad_id: o.unidad_id ?? undefined,
      fecha_ingreso: o.fecha_ingreso, tipo: o.tipo, estado: o.estado,
      llaves_entregadas: o.llaves_entregadas, reglamento_firmado: o.reglamento_firmado,
      deposito_pagado: o.deposito_pagado, datos_registrados: o.datos_registrados,
      accesos_configurados: o.accesos_configurados, inspeccion_unidad: o.inspeccion_unidad,
      bienvenida_enviada: o.bienvenida_enviada, notas: o.notas ?? '',
    })
    setEditId(o.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.nombre_residente?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el nombre del residente.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre_residente: form.nombre_residente!.trim(),
      unidad_id: form.unidad_id || null, fecha_ingreso: form.fecha_ingreso!,
      tipo: form.tipo ?? 'propietario', estado: form.estado ?? 'en_proceso',
      llaves_entregadas: form.llaves_entregadas ?? false,
      reglamento_firmado: form.reglamento_firmado ?? false,
      deposito_pagado: form.deposito_pagado ?? false,
      datos_registrados: form.datos_registrados ?? false,
      accesos_configurados: form.accesos_configurados ?? false,
      inspeccion_unidad: form.inspeccion_unidad ?? false,
      bienvenida_enviada: form.bienvenida_enviada ?? false,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('onboarding_residentes').update(payload).eq('id', editId)
      : await supabase.from('onboarding_residentes').insert(payload)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function toggleCheck(id: string, key: keyof OnboardingResidente, val: boolean) {
    const { error } = await supabase.from('onboarding_residentes').update({ [key]: !val }).eq('id', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function activarPortal(o: OnboardingResidente) {
    if (!o.unidad_id) { notify({ variant: 'warning', title: 'Sin unidad', text: 'Este onboarding no tiene una unidad asignada.' }); return }
    const token = crypto.randomUUID().replace(/-/g, '')
    const { error } = await supabase.from('unidades')
      .update({ portal_activo: true, token_portal: token }).eq('id', o.unidad_id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    const url = `${window.location.origin}/portal/${token}`
    await Swal.fire({
      icon: 'success', title: '¡Portal activado!',
      html: `<p style="font-size:13px;margin-bottom:8px">Comparte este enlace con el residente:</p>
             <code style="background:var(--at-chip);padding:6px 10px;border-radius:6px;font-size:12px;word-break:break-all">${url}</code>`,
      confirmButtonText: 'Copiar y cerrar',
    }).then(() => navigator.clipboard.writeText(url).catch(() => {}))
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar onboarding?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('onboarding_residentes').delete().eq('id', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {enProceso > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>👋</span>
          <span style={{ fontSize: '13px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {enProceso} proceso{enProceso > 1 ? 's' : ''} de onboarding en curso
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Onboarding de Residentes</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nuevo Ingreso</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Onboarding' : 'Nuevo Ingreso de Residente'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Residente *</label>
              <input style={inputStyle} value={form.nombre_residente ?? ''} onChange={e => setForm(f => ({ ...f, nombre_residente: e.target.value }))} placeholder="Nombre completo" />
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin unidad</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'propietario'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as 'propietario' | 'arrendatario' }))}>
                <option value="propietario">Propietario</option>
                <option value="arrendatario">Arrendatario</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha ingreso</label>
              <input style={inputStyle} type="date" value={form.fecha_ingreso ?? ''} onChange={e => setForm(f => ({ ...f, fecha_ingreso: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'en_proceso'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoOnboarding }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: '12px', padding: '12px', background: 'var(--at-surface)', borderRadius: '8px', border: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '10px' }}>CHECKLIST</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
              {CHECKLIST.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={(form[c.key] as boolean) ?? false} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.checked }))} />
                  {c.icon} {c.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>Notas</label>
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'en_proceso', 'completado', 'cancelado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? `Todos (${onboardings.length})` : `${ESTADO_CONFIG[e as EstadoOnboarding]?.label} (${onboardings.filter(o => o.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>👋</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay procesos de onboarding</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(o => {
            const pct = progreso(o)
            const est = ESTADO_CONFIG[o.estado]
            return (
              <div key={o.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)' }}>{o.nombre_residente}</div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      {o.tipo === 'propietario' ? '🏠 Propietario' : '🔑 Arrendatario'}
                      {o.unidad_nombre && ` · ${o.unidad_nombre}`}
                      {' · '}{o.fecha_ingreso}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                    {canEdit && o.unidad_id && o.estado === 'completado' && (
                      <button onClick={() => activarPortal(o)}
                        title="Generar enlace del portal para el residente"
                        style={{ padding: '4px 9px', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-primary)', fontWeight: 600 }}>
                        🔗 Portal
                      </button>
                    )}
                    {canEdit && <button onClick={() => startEdit(o)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
                    {canEdit && <button onClick={() => handleDelete(o.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Progreso</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: pct === 100 ? 'var(--at-success)' : 'var(--at-warning)' }}>{pct}%</span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--at-chip)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--at-success)' : 'var(--at-warning)', borderRadius: '3px', transition: 'width 0.3s' }} />
                  </div>
                </div>

                {/* Checklist items */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px' }}>
                  {CHECKLIST.map(c => {
                    const done = o[c.key] as boolean
                    return (
                      <button key={c.key} onClick={() => canEdit && toggleCheck(o.id, c.key, done)}
                        style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 10px', background: done ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1.5px solid ${done ? 'var(--at-success)' : 'var(--at-line)'}`, borderRadius: '8px', fontSize: '12px', cursor: canEdit ? 'pointer' : 'default', textAlign: 'left', fontWeight: done ? 600 : 400, color: done ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>
                        <span>{done ? '✅' : '⬜'}</span>
                        <span>{c.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

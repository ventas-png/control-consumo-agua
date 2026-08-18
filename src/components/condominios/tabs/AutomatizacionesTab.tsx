import { hoyLocalISO, dateLocalISO, diasHastaFechaCalendario } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import {
  createCondominioRow,
  updateCondominioRow,
  deleteCondominioRow,
  marcarCuotasMorosas,
} from '../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../shared/Dialog'
import { AutomatizacionCond, TriggerTipoAuto, AccionTipoAuto, CuotaCondominio, TicketMantenimiento } from '../../../types'

interface Props {
  automatizaciones: AutomatizacionCond[]
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TRIGGER_CFG: Record<TriggerTipoAuto, { label: string; desc: (v: number) => string; icon: string }> = {
  cuota_vencida_dias:       { label: 'Cuota vencida',           icon: '💳', desc: v => `Cuotas con más de ${v} días sin pagar` },
  ticket_sin_resolver_dias: { label: 'Ticket sin resolver',     icon: '🔧', desc: v => `Tickets abiertos por más de ${v} días` },
  vencimiento_critico_dias: { label: 'Vencimiento próximo',     icon: '⏳', desc: v => `Documentos/contratos que vencen en menos de ${v} días` },
  cert_personal_vence_dias: { label: 'Cert. personal por vencer', icon: '🎓', desc: v => `Certificados de personal que vencen en menos de ${v} días` },
}

const ACCION_CFG: Record<AccionTipoAuto, { label: string; icon: string; color: string }> = {
  notificacion_interna: { label: 'Notificación interna', icon: '🔔', color: 'var(--at-primary)' },
  crear_alerta:         { label: 'Crear alerta',         icon: '🚨', color: 'var(--at-warning)' },
  marcar_moroso:        { label: 'Marcar como moroso',   icon: '⚠️', color: 'var(--at-danger)' },
}

const BLANK = {
  nombre: '', trigger_tipo: 'cuota_vencida_dias' as TriggerTipoAuto,
  trigger_valor: 30, accion_tipo: 'notificacion_interna' as AccionTipoAuto, notas: '',
}

export default function AutomatizacionesTab({ automatizaciones, cuotas, tickets, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(BLANK)

  const hoy = hoyLocalISO()

  function evaluar(a: AutomatizacionCond): number {
    const dias = a.trigger_valor
    if (a.trigger_tipo === 'cuota_vencida_dias') {
      return cuotas.filter(c => {
        if (!c.fecha_vencimiento || c.estado === 'pagado') return false
        const d = -(diasHastaFechaCalendario(c.fecha_vencimiento) ?? 0)
        return d >= dias
      }).length
    }
    if (a.trigger_tipo === 'ticket_sin_resolver_dias') {
      return tickets.filter(t => {
        if (t.estado === 'resuelto' || t.estado === 'cerrado') return false
        const d = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000)
        return d >= dias
      }).length
    }
    return 0
  }

  async function guardar() {
    if (!form.nombre.trim()) { notify({ variant: 'warning', title: 'Error', text: 'El nombre es obligatorio' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('automatizaciones_cond', {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), trigger_tipo: form.trigger_tipo,
      trigger_valor: form.trigger_valor, accion_tipo: form.accion_tipo,
      accion_config: {}, activa: true, notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function toggleActiva(id: string, activa: boolean) {
    await updateCondominioRow('automatizaciones_cond', id, { activa: !activa })
    onRefresh()
  }

  async function ejecutarAhora(a: AutomatizacionCond) {
    const afectados = evaluar(a)
    const accion = ACCION_CFG[a.accion_tipo]

    // Ejecución real: marcar_moroso sobre cuotas vencidas
    if (a.accion_tipo === 'marcar_moroso' && a.trigger_tipo === 'cuota_vencida_dias') {
      if (afectados === 0) {
        notify({ variant: 'success', title: 'Sin elementos afectados', text: '✓ No hay cuotas que cumplan el criterio actualmente.', duration: 2000 })
        await updateCondominioRow('automatizaciones_cond', a.id, { ultima_ejecucion: new Date().toISOString() })
        onRefresh(); return
      }
      const { isConfirmed } = await confirm({
        title: `Ejecutar: ${a.nombre}`,
        text: `Disparador: ${TRIGGER_CFG[a.trigger_tipo].desc(a.trigger_valor)} · `
            + `Acción: ${accion.icon} ${accion.label} · `
            + `${afectados} cuota${afectados !== 1 ? 's' : ''} serán marcadas como morosas`,
        icon: 'warning',
        variant: 'danger',
        confirmText: '⚡ Ejecutar ahora',
      })
      if (!isConfirmed) return

      const limitDate = dateLocalISO(new Date(Date.now() - a.trigger_valor * 86400000))
      const afectadas = cuotas.filter(c =>
        c.estado === 'pendiente' && c.fecha_vencimiento && c.fecha_vencimiento < limitDate
      )
      const { error } = await marcarCuotasMorosas(afectadas.map(c => c.id))
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
      notify({ variant: 'success', title: `${afectadas.length} cuotas marcadas como morosas`, duration: 1600 })
      await updateCondominioRow('automatizaciones_cond', a.id, { ultima_ejecucion: new Date().toISOString() })
      onRefresh(); return
    }

    // Para otras acciones: solo evaluación informativa
    notify({
      variant: afectados > 0 ? 'warning' : 'success',
      title: `Evaluar: ${a.nombre}`,
      text: `Disparador: ${TRIGGER_CFG[a.trigger_tipo].desc(a.trigger_valor)} · `
          + `Acción: ${accion.icon} ${accion.label} · `
          + `${afectados} elemento${afectados !== 1 ? 's' : ''} afectado${afectados !== 1 ? 's' : ''}`
          + (afectados > 0 ? ' — revisa el Centro de Notificaciones.' : ''),
      duration: 4000,
    })
    await updateCondominioRow('automatizaciones_cond', a.id, { ultima_ejecucion: new Date().toISOString() })
    onRefresh()
  }

  async function eliminar(id: string) {
    const { isConfirmed } = await confirm({ title: '¿Eliminar automatización?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!isConfirmed) return
    await deleteCondominioRow('automatizaciones_cond', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  const activas = automatizaciones.filter(a => a.activa).length

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-primary-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--at-primary)' }}>{automatizaciones.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-primary)', fontWeight: 600 }}>Reglas configuradas</div>
        </div>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--at-success)' }}>{activas}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)', fontWeight: 600 }}>Activas</div>
        </div>
        <div style={{ background: 'var(--at-warning-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--at-warning)' }}>{automatizaciones.reduce((s, a) => s + evaluar(a), 0)}</div>
          <div style={{ fontSize: 11, color: 'var(--at-warning)', fontWeight: 600 }}>Elementos afectados ahora</div>
        </div>
      </div>

      {/* Botón */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva automatización'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Configurar nueva automatización</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 1' }}>
              <label style={lbl}>Nombre *</label>
              <input style={inp} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. Notificar mora +30d" />
            </div>
            <div>
              <label style={lbl}>Disparador</label>
              <select style={inp} value={form.trigger_tipo} onChange={e => setForm(p => ({ ...p, trigger_tipo: e.target.value as TriggerTipoAuto }))}>
                {(Object.keys(TRIGGER_CFG) as TriggerTipoAuto[]).map(k => <option key={k} value={k}>{TRIGGER_CFG[k].icon} {TRIGGER_CFG[k].label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Días</label>
              <input type="number" min={1} style={inp} value={form.trigger_valor} onChange={e => setForm(p => ({ ...p, trigger_valor: parseInt(e.target.value) || 30 }))} />
            </div>
            <div>
              <label style={lbl}>Acción</label>
              <select style={inp} value={form.accion_tipo} onChange={e => setForm(p => ({ ...p, accion_tipo: e.target.value as AccionTipoAuto }))}>
                {(Object.keys(ACCION_CFG) as AccionTipoAuto[]).map(k => <option key={k} value={k}>{ACCION_CFG[k].icon} {ACCION_CFG[k].label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Descripción opcional" />
            </div>
          </div>
          <div style={{ padding: '8px 12px', background: 'var(--at-primary-soft)', borderRadius: 8, fontSize: 11, color: 'var(--at-primary-hover)', marginBottom: 12 }}>
            Vista previa: <strong>{TRIGGER_CFG[form.trigger_tipo].desc(form.trigger_valor)}</strong> → {ACCION_CFG[form.accion_tipo].icon} {ACCION_CFG[form.accion_tipo].label}
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear regla'}
          </button>
        </div>
      )}

      {/* Lista */}
      {automatizaciones.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '48px 0', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚙️</div>
          Sin automatizaciones configuradas
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {automatizaciones.map(a => {
            const tc = TRIGGER_CFG[a.trigger_tipo]
            const ac = ACCION_CFG[a.accion_tipo]
            const afectados = evaluar(a)
            return (
              <div key={a.id} style={{ background: 'var(--at-surface)', border: `1px solid ${a.activa ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: 10, padding: '12px 16px', opacity: a.activa ? 1 : 0.7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{tc.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{a.nombre}</span>
                      {!a.activa && <span style={{ fontSize: 10, background: 'var(--at-chip)', color: 'var(--at-ink-3)', padding: '1px 6px', borderRadius: 10 }}>Inactiva</span>}
                      {afectados > 0 && a.activa && (
                        <span style={{ fontSize: 10, background: 'var(--at-danger-tint)', color: 'var(--at-danger)', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
                          {afectados} elemento{afectados !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                      {tc.desc(a.trigger_valor)} → {ac.icon} {ac.label}
                      {a.ultima_ejecucion && ` · Última eval.: ${a.ultima_ejecucion.slice(0, 10)}`}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => ejecutarAhora(a)}
                        style={{ padding: '5px 10px', background: 'var(--at-primary-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-primary)', fontWeight: 600 }}>
                        ▶ Evaluar
                      </button>
                      <button onClick={() => toggleActiva(a.id, a.activa)}
                        style={{ padding: '5px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink-3)' }}>
                        {a.activa ? 'Pausar' : 'Activar'}
                      </button>
                      <button onClick={() => eliminar(a.id)}
                        style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>✕</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--at-surface-2)', borderRadius: 8, fontSize: 11, color: 'var(--at-ink-3)' }}>
        💡 Las automatizaciones evalúan los datos actuales del proyecto. La ejecución automática programada (cron) estará disponible en la próxima versión con integración de mensajería.
      </div>
      <div style={{ display: 'none' }}>{hoy}</div>
    </div>
  )
}

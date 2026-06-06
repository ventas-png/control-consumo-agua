import { useState, useEffect } from 'react'
import { notify } from '../../shared/Dialog'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { ConfigCondominio } from '../../../types'

interface Props {
  config: ConfigCondominio | null
  proyectoId: string
  companyId: string
  canEdit: boolean
  onRefresh: () => void
}

const METODOS_DISPONIBLES = ['efectivo', 'transferencia', 'cheque', 'tarjeta', 'pago_movil', 'deposito', 'paypal', 'otro']

export default function ConfiguracionCondominioTab({ config, proyectoId, companyId, canEdit, onRefresh }: Props) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    cuota_base: '',
    dias_gracia: '5',
    tasa_mora_mensual: '2.0',
    metodos_pago: ['efectivo', 'transferencia'],
    nombre_administrador: '',
    telefono_admin: '',
    email_admin: '',
    notif_dias_antes_vencimiento: '3',
    permitir_reservas_online: true,
    max_reservas_por_unidad_mes: '3',
    reglamento_url: '',
  })

  useEffect(() => {
    if (config) {
      setForm({
        cuota_base: config.cuota_base != null ? String(config.cuota_base) : '',
        dias_gracia: String(config.dias_gracia),
        tasa_mora_mensual: String(config.tasa_mora_mensual),
        metodos_pago: config.metodos_pago ?? ['efectivo', 'transferencia'],
        nombre_administrador: config.nombre_administrador ?? '',
        telefono_admin: config.telefono_admin ?? '',
        email_admin: config.email_admin ?? '',
        notif_dias_antes_vencimiento: String(config.notif_dias_antes_vencimiento),
        permitir_reservas_online: config.permitir_reservas_online,
        max_reservas_por_unidad_mes: String(config.max_reservas_por_unidad_mes),
        reglamento_url: config.reglamento_url ?? '',
      })
    }
  }, [config])

  function toggleMetodo(m: string) {
    setForm(f => ({
      ...f,
      metodos_pago: f.metodos_pago.includes(m) ? f.metodos_pago.filter(x => x !== m) : [...f.metodos_pago, m],
    }))
  }

  async function guardar() {
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      cuota_base: form.cuota_base ? parseFloat(form.cuota_base) : null,
      dias_gracia: parseInt(form.dias_gracia) || 5,
      tasa_mora_mensual: parseFloat(form.tasa_mora_mensual) || 2.0,
      metodos_pago: form.metodos_pago,
      nombre_administrador: form.nombre_administrador.trim() || null,
      telefono_admin: form.telefono_admin.trim() || null,
      email_admin: form.email_admin.trim() || null,
      notif_dias_antes_vencimiento: parseInt(form.notif_dias_antes_vencimiento) || 3,
      permitir_reservas_online: form.permitir_reservas_online,
      max_reservas_por_unidad_mes: parseInt(form.max_reservas_por_unidad_mes) || 3,
      reglamento_url: form.reglamento_url.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = config
      ? await updateCondominioRow('config_condominio', config.id, payload)
      : await createCondominioRow('config_condominio', payload)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: 'Configuración guardada', duration: 1500 })
    onRefresh()
  }

  const INPUT = (disabled = false) => ({
    width: '100%', padding: '7px 10px', borderRadius: 8,
    border: '1px solid var(--at-line-strong)', fontSize: 13, background: disabled ? 'var(--at-surface-2)' : 'var(--at-surface)',
    outline: 'none', color: 'var(--at-ink)',
  })

  const SECTION = { background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 14 }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>Configuración del Condominio</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
            {config ? 'Configuración guardada — última actualización: ' + config.updated_at.slice(0, 10) : 'Sin configuración guardada aún'}
          </div>
        </div>
        {canEdit && (
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: 8,
              cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Guardando…' : '💾 Guardar cambios'}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Financiero */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>💰 Parámetros Financieros</div>
          {[
            { label: 'Cuota base mensual', key: 'cuota_base', type: 'number', placeholder: '0.00', help: 'Monto estándar por unidad' },
            { label: 'Días de gracia para pago', key: 'dias_gracia', type: 'number', placeholder: '5', help: 'Días antes de aplicar mora' },
            { label: 'Tasa de mora mensual (%)', key: 'tasa_mora_mensual', type: 'number', placeholder: '2.0', help: '% mensual sobre saldo vencido' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 3 }}>{f.label}</label>
              <input type={f.type} value={(form as unknown as Record<string, string>)[f.key]} placeholder={f.placeholder}
                disabled={!canEdit}
                onChange={e => canEdit && setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                style={INPUT(!canEdit)} />
              <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 2 }}>{f.help}</div>
            </div>
          ))}

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 6 }}>Métodos de pago habilitados</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {METODOS_DISPONIBLES.map(m => (
                <button key={m} onClick={() => canEdit && toggleMetodo(m)} disabled={!canEdit}
                  style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid var(--at-line-strong)', fontSize: 11, cursor: canEdit ? 'pointer' : 'default',
                    background: form.metodos_pago.includes(m) ? 'var(--at-ink)' : 'var(--at-surface-2)',
                    color: form.metodos_pago.includes(m) ? 'white' : 'var(--at-ink-2)', fontWeight: form.metodos_pago.includes(m) ? 700 : 400 }}>
                  {m.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Administración */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>👤 Datos del Administrador</div>
          {[
            { label: 'Nombre del administrador', key: 'nombre_administrador', type: 'text', placeholder: 'Nombre completo' },
            { label: 'Teléfono', key: 'telefono_admin', type: 'tel', placeholder: '+502 0000-0000' },
            { label: 'Correo electrónico', key: 'email_admin', type: 'email', placeholder: 'admin@condominio.com' },
            { label: 'URL del Reglamento', key: 'reglamento_url', type: 'url', placeholder: 'https://...' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 3 }}>{f.label}</label>
              <input type={f.type} value={(form as unknown as Record<string, string>)[f.key]} placeholder={f.placeholder}
                disabled={!canEdit}
                onChange={e => canEdit && setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                style={INPUT(!canEdit)} />
            </div>
          ))}
        </div>

        {/* Notificaciones y reservas */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>🔔 Notificaciones y Reservas</div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 3 }}>
              Días antes del vencimiento para notificar
            </label>
            <input type="number" value={form.notif_dias_antes_vencimiento} disabled={!canEdit}
              onChange={e => canEdit && setForm(f => ({ ...f, notif_dias_antes_vencimiento: e.target.value }))}
              style={INPUT(!canEdit)} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 3 }}>
              Reservas online de amenidades
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => canEdit && setForm(f => ({ ...f, permitir_reservas_online: v }))} disabled={!canEdit}
                  style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, cursor: canEdit ? 'pointer' : 'default',
                    background: form.permitir_reservas_online === v ? 'var(--at-ink)' : 'var(--at-surface-2)',
                    color: form.permitir_reservas_online === v ? 'white' : 'var(--at-ink-2)', fontWeight: form.permitir_reservas_online === v ? 700 : 400 }}>
                  {v ? '✅ Habilitado' : '❌ Deshabilitado'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 3 }}>
              Máximo de reservas por unidad / mes
            </label>
            <input type="number" value={form.max_reservas_por_unidad_mes} disabled={!canEdit}
              onChange={e => canEdit && setForm(f => ({ ...f, max_reservas_por_unidad_mes: e.target.value }))}
              style={INPUT(!canEdit)} />
          </div>
        </div>

        {/* Resumen de config actual */}
        <div style={{ ...SECTION, background: 'var(--at-surface-2)' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>📋 Resumen actual</div>
          {[
            { label: 'Cuota base', val: form.cuota_base ? `Q ${parseFloat(form.cuota_base).toFixed(2)}` : 'No definida' },
            { label: 'Días de gracia', val: `${form.dias_gracia} días` },
            { label: 'Tasa mora', val: `${form.tasa_mora_mensual}% mensual` },
            { label: 'Métodos de pago', val: form.metodos_pago.join(', ') || 'Ninguno' },
            { label: 'Notificación', val: `${form.notif_dias_antes_vencimiento} días antes` },
            { label: 'Reservas online', val: form.permitir_reservas_online ? 'Habilitadas' : 'Deshabilitadas' },
            { label: 'Máx. reservas/mes', val: `${form.max_reservas_por_unidad_mes} por unidad` },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 12 }}>
              <span style={{ color: 'var(--at-ink-3)' }}>{r.label}</span>
              <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{r.val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

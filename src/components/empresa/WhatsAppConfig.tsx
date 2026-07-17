// com/B3 — Tarjeta de configuración de WhatsApp Cloud API por tenant.
// Antes el alta de credenciales era un INSERT manual por SQL editor (token en
// texto plano); esta UI usa el edge whatsapp-save-credentials (cifra el token)
// y whatsapp-test-connection, leyendo el estatus (sin token) vía whatsapp_estatus.
import { useState } from 'react'
import { notify } from '../shared/Dialog'
import {
  useEstatusWhatsAppQuery,
  useGuardarCredencialesWhatsAppMutation,
  useProbarConexionWhatsAppMutation,
} from '../../domain/comunicacion/whatsappConfig'

interface Props {
  companyId?: string | null
}

const ESTADO_META: Record<string, { label: string; color: string; bg: string }> = {
  ok: { label: 'Conectado', color: 'var(--at-success-strong)', bg: 'var(--at-success-tint)' },
  error: { label: 'Error', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  desconocido: { label: 'Sin probar', color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}

export function WhatsAppConfig({ companyId }: Props) {
  const cid = companyId ?? undefined
  const { data: estatus, isLoading } = useEstatusWhatsAppQuery(cid)
  const guardar = useGuardarCredencialesWhatsAppMutation(cid)
  const probar = useProbarConexionWhatsAppMutation(cid)

  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [templateDefault, setTemplateDefault] = useState('')
  const [editando, setEditando] = useState(false)

  const configurado = !!estatus?.tiene_token
  const mostrarForm = editando || !configurado

  async function handleGuardar() {
    if (!phoneNumberId.trim()) { notify({ variant: 'warning', title: 'Falta el Phone Number ID' }); return }
    if (!accessToken.trim()) { notify({ variant: 'warning', title: 'Falta el Access Token' }); return }
    try {
      await guardar.mutateAsync({
        companyId: cid,
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim(),
        templateDefault: templateDefault.trim() || null,
      })
      notify({ variant: 'success', title: 'Credenciales guardadas', text: 'El token se guardó cifrado. Probá la conexión para validarlo.' })
      setAccessToken('')
      setEditando(false)
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: e instanceof Error ? e.message : 'Error' })
    }
  }

  async function handleProbar() {
    try {
      const res = await probar.mutateAsync({ companyId: cid })
      notify({
        variant: res.ok ? 'success' : 'error',
        title: res.ok ? 'Conexión válida' : 'Falló la conexión',
        text: res.estado_mensaje ?? '',
      })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo probar', text: e instanceof Error ? e.message : 'Error' })
    }
  }

  const estadoMeta = ESTADO_META[estatus?.estado_conexion ?? 'desconocido'] ?? ESTADO_META.desconocido

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <span style={{ fontSize: '22px' }}>💬</span>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>WhatsApp (Meta Cloud API)</h3>
        {configurado && (
          <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 10px', borderRadius: '999px', color: estadoMeta.color, background: estadoMeta.bg }}>
            {estadoMeta.label}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 18px', fontSize: '13px', color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
        Conectá el número de WhatsApp Business de tu empresa para enviar avisos por este canal.
        El token se guarda cifrado y nunca se muestra de vuelta.
      </p>

      {isLoading ? (
        <div style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando…</div>
      ) : (
        <>
          {configurado && !editando && (
            <div style={{ display: 'grid', gap: '8px', marginBottom: '16px', fontSize: '13px' }}>
              <Row label="Phone Number ID" value={estatus?.phone_number_id ?? '—'} />
              <Row label="Plantilla por defecto" value={estatus?.template_default ?? '—'} />
              {estatus?.estado_mensaje && <Row label="Último resultado" value={estatus.estado_mensaje} />}
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button onClick={handleProbar} disabled={probar.isPending} style={btnPrimary}>
                  {probar.isPending ? 'Probando…' : 'Probar conexión'}
                </button>
                <button onClick={() => setEditando(true)} style={btnGhost}>Cambiar credenciales</button>
              </div>
            </div>
          )}

          {mostrarForm && (
            <div style={{ display: 'grid', gap: '12px', maxWidth: 520 }}>
              <Field label="Phone Number ID">
                <input value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)}
                  placeholder="p. ej. 123456789012345" style={inputStyle} />
              </Field>
              <Field label="Access Token">
                <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)}
                  placeholder="Token permanente de la app de Meta" style={inputStyle} autoComplete="off" />
              </Field>
              <Field label="Plantilla por defecto (opcional)">
                <input value={templateDefault} onChange={e => setTemplateDefault(e.target.value)}
                  placeholder="nombre_de_plantilla_aprobada" style={inputStyle} />
              </Field>
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button onClick={handleGuardar} disabled={guardar.isPending} style={btnPrimary}>
                  {guardar.isPending ? 'Guardando…' : 'Guardar credenciales'}
                </button>
                {configurado && <button onClick={() => setEditando(false)} style={btnGhost}>Cancelar</button>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <span style={{ color: 'var(--at-ink-3)', minWidth: 160 }}>{label}:</span>
      <span style={{ color: 'var(--at-ink)', fontWeight: 500, wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: '5px' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1.5px solid var(--at-line)',
  borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface)',
  color: 'var(--at-ink)', boxSizing: 'border-box', outline: 'none',
}
const btnPrimary: React.CSSProperties = {
  padding: '9px 18px', background: 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))',
  color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  padding: '9px 18px', background: 'transparent', color: 'var(--at-ink-2)',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
}

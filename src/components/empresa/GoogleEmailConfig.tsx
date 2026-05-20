import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'

// Template metadata displayed in the UI
const TEMPLATE_DEFS = [
  { key: 'recibo',            label: 'Recibo de Consumo',       icon: '📄', desc: 'Se envía al registrar una lectura con cobro.' },
  { key: 'ruta_asignada',     label: 'Asignación de Ruta',      icon: '🗺️', desc: 'Se envía al operador cuando se le asigna una ruta.' },
  { key: 'difusion',          label: 'Comunicado / Difusión',   icon: '📢', desc: 'Se usa en campañas de comunicación masiva.' },
  { key: 'password_reset',    label: 'Restablecer Contraseña',  icon: '🔐', desc: 'Enlace de recuperación de contraseña.' },
  { key: 'pago_confirmado',   label: 'Pago Confirmado',         icon: '✅', desc: 'Confirmación automática al recibir un pago.' },
  { key: 'bienvenida_empresa',label: 'Bienvenida Empresa',      icon: '🎉', desc: 'Solo superadmin: nuevas empresas incorporadas.' },
  { key: 'notificacion_empresa', label: 'Notificación a Empresa', icon: '📣', desc: 'Solo superadmin: avisos o anuncios a clientes empresa.' },
]

interface EmailConfig {
  id: string
  email: string
  is_active: boolean
  updated_at: string
}

interface EmailTemplate {
  id: string
  template_key: string
  subject: string
  html_body: string
  is_active: boolean
}

interface Props {
  companyId?: string | null
  isSuperadmin?: boolean
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

async function callFn(name: string, body: unknown): Promise<Response> {
  const token = await getAccessToken()
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export function GoogleEmailConfig({ companyId, isSuperadmin = false }: Props) {
  const [config, setConfig] = useState<EmailConfig | null>(null)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)

    if (!isSuperadmin && !companyId) {
      setLoading(false)
      return
    }

    // Supabase query builder is immutable — apply ownership filter via ternary
    const { data } = await (
      isSuperadmin
        ? supabase.from('company_email_configs')
            .select('id, email, is_active, updated_at')
            .eq('is_superadmin', true)
        : supabase.from('company_email_configs')
            .select('id, email, is_active, updated_at')
            .eq('company_id', companyId!)
    ).maybeSingle()
    setConfig(data as EmailConfig | null)

    const { data: tplData } = await (
      isSuperadmin
        ? supabase.from('email_templates')
            .select('id, template_key, subject, html_body, is_active')
            .eq('is_superadmin', true)
        : supabase.from('email_templates')
            .select('id, template_key, subject, html_body, is_active')
            .eq('company_id', companyId!)
    )
    setTemplates((tplData as EmailTemplate[]) ?? [])
    setLoading(false)
  }, [companyId, isSuperadmin])

  useEffect(() => { void loadConfig() }, [loadConfig])

  async function handleConnect() {
    setConnecting(true)
    try {
      const res = await callFn('google-oauth-initiate', {
        company_id: isSuperadmin ? null : companyId,
        is_superadmin: isSuperadmin,
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        void Swal.fire({ icon: 'error', title: 'Error', text: data.error ?? 'No se pudo iniciar la conexión con Google.' })
        return
      }
      // Redirect the current page to Google OAuth
      window.location.href = data.url
    } catch {
      void Swal.fire({ icon: 'error', title: 'Error de red', text: 'No se pudo conectar con el servidor.' })
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: '¿Desconectar cuenta de Google?',
      text: 'Los correos dejarán de enviarse desde esta cuenta. Se puede volver a conectar en cualquier momento.',
      showCancelButton: true,
      confirmButtonText: 'Desconectar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
    })
    if (!isConfirmed) return

    const query = supabase.from('company_email_configs').delete()
    if (isSuperadmin) {
      query.eq('is_superadmin', true)
    } else {
      query.eq('company_id', companyId)
    }
    await query
    setConfig(null)
    void Swal.fire({ icon: 'success', title: 'Desconectado', timer: 1500, showConfirmButton: false })
  }

  async function handleTestEmail() {
    if (!testEmail.trim()) {
      void Swal.fire({ icon: 'warning', title: 'Ingresa un correo', text: 'Escribe la dirección de correo de prueba.' })
      return
    }
    setSendingTest(true)
    try {
      const res = await callFn('send-email', {
        company_id: isSuperadmin ? null : companyId,
        is_superadmin: isSuperadmin,
        template_key: 'difusion',
        to_email: testEmail.trim(),
        to_name: 'Prueba de Sistema',
        vars: {
          empresa_nombre: 'Control de Consumo de Agua',
          subject: 'Correo de prueba — Conexión exitosa',
          message: '¡Esta es una prueba de correo automático! Si recibes este mensaje, la integración con Google Mail está funcionando correctamente.',
          from_name: isSuperadmin ? 'Superadministrador' : 'Administrador',
        },
      })
      if (res.ok) {
        void Swal.fire({ icon: 'success', title: '¡Correo enviado!', text: `El correo de prueba fue enviado a ${testEmail}.`, timer: 3000, showConfirmButton: false })
      } else {
        const err = await res.json() as { error?: string }
        void Swal.fire({ icon: 'error', title: 'Error al enviar', text: err.error ?? 'No se pudo enviar el correo de prueba.' })
      }
    } catch {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo conectar con el servidor.' })
    } finally {
      setSendingTest(false)
    }
  }

  async function editTemplate(def: typeof TEMPLATE_DEFS[0]) {
    const existing = templates.find((t: EmailTemplate) => t.template_key === def.key)

    const inpStyle = 'width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid var(--at-line);border-radius:8px;font-size:13px;color:var(--at-ink);background:#fff;outline:none;font-family:inherit'

    const { value: formValues } = await Swal.fire({
      title: `${def.icon} ${def.label}`,
      width: 700,
      html: `
        <div style="text-align:left;display:flex;flex-direction:column;gap:12px;">
          <p style="margin:0;font-size:12px;color:var(--at-ink-3);">${def.desc}</p>
          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:var(--at-ink-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Asunto del correo</label>
            <input id="swal-subject" style="${inpStyle}" placeholder="Ej: Recibo de consumo — {{mes}} | {{empresa_nombre}}"
              value="${(existing?.subject ?? '').replace(/"/g, '&quot;')}" />
          </div>
          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:var(--at-ink-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Cuerpo HTML del correo</label>
            <p style="margin:0 0 5px;font-size:11px;color:var(--at-ink-3);">Usa <code>{{variable}}</code> para insertar valores dinámicos. Deja en blanco para usar el template predeterminado.</p>
            <textarea id="swal-body" style="${inpStyle};height:220px;resize:vertical;font-family:monospace;font-size:12px;">${existing?.html_body ?? ''}</textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      ...(existing ? {
        footer: `<button id="swal-delete-tpl" type="button" style="background:none;border:none;color:#ef4444;font-size:13px;font-weight:600;cursor:pointer;">Eliminar personalización</button>`,
        didOpen: () => {
          document.getElementById('swal-delete-tpl')?.addEventListener('click', () => {
            Swal.close()
            void deleteTemplate(existing.id)
          })
        },
      } : {}),
      preConfirm: () => {
        const subject = (document.getElementById('swal-subject') as HTMLInputElement)?.value?.trim()
        const html_body = (document.getElementById('swal-body') as HTMLTextAreaElement)?.value?.trim()
        if (html_body && !subject) {
          Swal.showValidationMessage('Si defines el cuerpo, el asunto también es obligatorio.')
          return false
        }
        return { subject, html_body }
      },
    })

    if (!formValues) return
    const { subject, html_body } = formValues as { subject: string; html_body: string }

    if (!subject && !html_body) return // nothing to save

    if (existing) {
      await supabase.from('email_templates').update({ subject, html_body, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      await supabase.from('email_templates').insert({
        template_key: def.key,
        subject,
        html_body,
        ...(isSuperadmin ? { is_superadmin: true } : { company_id: companyId }),
      })
    }

    void Swal.fire({ icon: 'success', title: 'Template guardado', timer: 1200, showConfirmButton: false })
    void loadConfig()
  }

  async function deleteTemplate(templateId: string) {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: '¿Eliminar personalización?',
      text: 'El template volverá al diseño predeterminado del sistema.',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      confirmButtonColor: '#ef4444',
    })
    if (!isConfirmed) return
    await supabase.from('email_templates').delete().eq('id', templateId)
    void Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1000, showConfirmButton: false })
    void loadConfig()
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Cargando configuración…</div>
    )
  }

  return (
    <div>
      {/* Section title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <span style={{ fontSize: '22px' }}>📧</span>
        <div>
          <h3 style={{ margin: 0, color: 'var(--at-ink)', fontSize: '16px', fontWeight: 700 }}>
            Correo Electrónico con Google
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--at-ink-3)' }}>
            Conecta una cuenta de Gmail o Google Workspace para enviar correos automáticos a tus clientes.
          </p>
        </div>
      </div>

      {/* Connection status card */}
      <div style={{
        background: config ? 'rgba(34,197,94,.08)' : 'rgba(100,116,139,.08)',
        border: `1.5px solid ${config ? 'rgba(34,197,94,.3)' : 'rgba(100,116,139,.25)'}`,
        borderRadius: '12px',
        padding: '18px 20px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Google icon */}
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <div>
            {config ? (
              <>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#166534' }}>Conectado</p>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  Enviando desde: <strong>{config.email}</strong>
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--at-ink-2)' }}>Sin cuenta conectada</p>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  Conecta una cuenta de Google para habilitar el envío de correos.
                </p>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {config ? (
            <button
              onClick={() => void handleDisconnect()}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: '1.5px solid rgba(239,68,68,.4)',
                background: 'rgba(239,68,68,.08)', color: '#dc2626',
                cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              Desconectar
            </button>
          ) : (
            <button
              onClick={() => void handleConnect()}
              disabled={connecting}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px', borderRadius: '8px', border: 'none',
                background: connecting ? 'var(--at-line-strong)' : '#4285F4',
                color: 'white', cursor: connecting ? 'not-allowed' : 'pointer',
                fontSize: '13px', fontWeight: 700, boxShadow: '0 2px 8px rgba(66,133,244,.35)',
              }}
            >
              {connecting ? 'Redirigiendo…' : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Conectar con Google
                </>
              )}
            </button>
          )}
          {config && (
            <button
              onClick={() => void handleConnect()}
              disabled={connecting}
              style={{
                padding: '8px 14px', borderRadius: '8px', border: '1.5px solid rgba(27, 59, 54,.3)',
                background: 'rgba(27, 59, 54,.08)', color: 'var(--at-primary-hover)',
                cursor: 'pointer', fontSize: '12px', fontWeight: 600,
              }}
            >
              Cambiar cuenta
            </button>
          )}
        </div>
      </div>

      {/* Test email */}
      {config && (
        <div style={{
          background: 'rgba(27, 59, 54,.06)', border: '1px solid rgba(27, 59, 54,.2)',
          borderRadius: '12px', padding: '16px 20px', marginBottom: '24px',
        }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>
            Enviar correo de prueba
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              style={{
                flex: 1, minWidth: '200px', padding: '9px 12px',
                borderRadius: '8px', border: '1.5px solid var(--at-line)',
                fontSize: '13px', outline: 'none',
              }}
            />
            <button
              onClick={() => void handleTestEmail()}
              disabled={sendingTest}
              style={{
                padding: '9px 18px', borderRadius: '8px', border: 'none',
                background: sendingTest ? 'var(--at-line-strong)' : 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))',
                color: 'white', cursor: sendingTest ? 'not-allowed' : 'pointer',
                fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              {sendingTest ? 'Enviando…' : 'Enviar prueba'}
            </button>
          </div>
        </div>
      )}

      {/* Email templates */}
      <div>
        <h4 style={{ margin: '0 0 12px', color: 'var(--at-ink)', fontSize: '14px', fontWeight: 700 }}>
          Templates de correo
        </h4>
        <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
          Personaliza el diseño de cada correo. Si no defines un template, se usa el diseño predeterminado del sistema.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {TEMPLATE_DEFS
            .filter(def =>
              isSuperadmin
                ? true
                : !['bienvenida_empresa', 'notificacion_empresa'].includes(def.key)
            )
            .map(def => {
              const custom = templates.find(t => t.template_key === def.key)
              return (
                <div key={def.key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '12px', flexWrap: 'wrap',
                  background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px 16px',
                  border: `1px solid ${custom ? 'rgba(27, 59, 54,.3)' : 'var(--at-line)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                    <span style={{ fontSize: '20px', flexShrink: 0 }}>{def.icon}</span>
                    <div>
                      <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>
                        {def.label}
                        {custom && (
                          <span style={{
                            marginLeft: '8px', fontSize: '10px', fontWeight: 700,
                            padding: '2px 7px', borderRadius: '20px',
                            background: 'rgba(27, 59, 54,.12)', color: 'var(--at-primary-hover)',
                          }}>Personalizado</span>
                        )}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--at-ink-3)' }}>{def.desc}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => void editTemplate(def)}
                    style={{
                      padding: '6px 14px', borderRadius: '7px',
                      border: '1.5px solid rgba(27, 59, 54,.3)',
                      background: 'rgba(27, 59, 54,.08)', color: 'var(--at-primary-hover)',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
                    }}
                  >
                    {custom ? 'Editar' : 'Personalizar'}
                  </button>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

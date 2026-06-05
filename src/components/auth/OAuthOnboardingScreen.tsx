import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { BrandLogo } from '../shared/BrandLogo'

interface Props {
  googleUser: { id: string; email: string; full_name: string }
  onSuccess: () => void
  onCancel: () => void
}

export default function OAuthOnboardingScreen({ googleUser, onSuccess, onCancel }: Props) {
  const [cuiDui, setCuiDui] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!cuiDui.trim() || !fechaNacimiento) {
      setError('Por favor complete todos los campos.')
      return
    }

    setLoading(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('complete-oauth-onboarding', {
        body: { cui_dui: cuiDui.trim(), fecha_nacimiento: fechaNacimiento },
      })

      if (fnError) {
        setError('Error de conexión. Intente nuevamente.')
        return
      }

      const result = data as { success?: boolean; error?: string }
      if (result?.error) {
        setError(result.error)
        return
      }

      if (result?.success) {
        onSuccess()
      }
    } catch {
      setError('Error inesperado. Intente nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel() {
    await supabase.auth.signOut()
    onCancel()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 14px', border: '1.5px solid var(--at-line)',
    borderRadius: '10px', fontSize: '14px',
    background: 'var(--at-surface-2)', color: 'var(--at-ink)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 50%, var(--at-accent-2) 100%)',
      padding: '16px',
    }}>
      {/* Estilos (.oauth-input, .reg-card) en src/styles/runtime.css (I24). */}

      <div className="reg-card" style={{
        background: 'var(--at-surface)', borderRadius: '24px',
        width: '100%', maxWidth: '440px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '56px', height: '56px', margin: '0 auto 14px', lineHeight: 0,
            filter: 'drop-shadow(0 8px 20px rgba(27,59,54,0.3))',
          }}>
            <BrandLogo size={56} />
          </div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>
            Completa tu registro
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Confirma tu identidad para vincular tu cuenta de Google
          </p>
        </div>

        {/* Google account info */}
        <div style={{
          background: 'var(--at-success-tint)', border: '1.5px solid var(--at-success-border)',
          borderRadius: '12px', padding: '12px 14px', marginBottom: '20px',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '20px' }}>✅</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-success-strong)' }}>
              {googleUser.full_name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--at-success)' }}>{googleUser.email}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '5px' }}>
                DPI / CUI *
              </label>
              <input
                className="oauth-input"
                type="text"
                value={cuiDui}
                onChange={e => setCuiDui(e.target.value)}
                placeholder="Número de DPI o CUI"
                disabled={loading}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '5px' }}>
                Fecha de nacimiento *
              </label>
              <input
                className="oauth-input"
                type="date"
                value={fechaNacimiento}
                onChange={e => setFechaNacimiento(e.target.value)}
                disabled={loading}
                style={inputStyle}
              />
            </div>
          </div>

          {error && (
            <div style={{
              background: 'var(--at-danger-tint)', border: '1.5px solid var(--at-danger-border)',
              borderRadius: '10px', padding: '10px 14px',
              fontSize: '13px', color: 'var(--at-danger)', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px',
              background: loading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
              color: 'white', border: 'none', borderRadius: '12px',
              fontSize: '15px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: '10px',
            }}
          >
            {loading ? 'Verificando…' : 'Completar registro'}
          </button>

          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            style={{
              width: '100%', padding: '10px',
              background: 'transparent', color: 'var(--at-ink-3)',
              border: '1.5px solid var(--at-line)', borderRadius: '12px',
              fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
        </form>
      </div>
    </div>
  )
}

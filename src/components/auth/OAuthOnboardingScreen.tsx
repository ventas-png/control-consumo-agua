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
    padding: '10px 14px', border: '1.5px solid #e2e8f0',
    borderRadius: '10px', fontSize: '14px',
    background: '#f8fafc', color: '#0f172a',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0d9488 100%)',
      padding: '16px',
    }}>
      <style>{`
        .oauth-input:focus {
          outline: none;
          border-color: #0ea5e9 !important;
          box-shadow: 0 0 0 3px rgba(14,165,233,0.15);
        }
        .reg-card { padding: 40px; }
        @media (max-width: 480px) { .reg-card { padding: 24px 20px !important; } }
      `}</style>

      <div className="reg-card" style={{
        background: 'rgba(255,255,255,0.97)', borderRadius: '24px',
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
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
            Completa tu registro
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>
            Confirma tu identidad para vincular tu cuenta de Google
          </p>
        </div>

        {/* Google account info */}
        <div style={{
          background: '#f0fdf4', border: '1.5px solid #86efac',
          borderRadius: '12px', padding: '12px 14px', marginBottom: '20px',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '20px' }}>✅</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#15803d' }}>
              {googleUser.full_name}
            </div>
            <div style={{ fontSize: '12px', color: '#16a34a' }}>{googleUser.email}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '5px' }}>
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
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '5px' }}>
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
              background: '#fef2f2', border: '1.5px solid #fca5a5',
              borderRadius: '10px', padding: '10px 14px',
              fontSize: '13px', color: '#dc2626', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px',
              background: loading ? '#94a3b8' : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
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
              background: 'transparent', color: '#64748b',
              border: '1.5px solid #e2e8f0', borderRadius: '12px',
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

import { hoyLocalISO } from '../../lib/format'
import { useState, useEffect, useCallback, type FormEvent } from 'react'
import {
  listMfaFactors,
  enrollTotpFactor,
  challengeMfaFactor,
  verifyMfaFactor,
  unenrollMfaFactor,
} from '../../domain/auth/mfaActions'
import { findVerifiedTotpFactor } from '../../domain/auth/mfa'

// P0 #10 (auditoría 2026-07-10) — enforcement de MFA por empresa.
//
// Cuando la empresa tiene `mfa_required = true`, App monta este gate ANTES del
// shell. Si el usuario ya tiene un factor TOTP verificado → satisface y sigue
// (el step-up por sesión lo maneja el login). Si NO tiene ninguno → lo obliga a
// enrolar aquí; no hay forma de entrar a la app sin 2FA (o cerrar sesión).
//
// Boundary: solo usa domain/auth/mfaActions (no importa supabase directo).

interface Props {
  /** Se llama cuando el usuario ya tiene (o acaba de activar) 2FA. */
  onSatisfied: () => void
  /** Escape: cerrar sesión si no puede/quiere enrolar. */
  onLogout: () => void
}

type Phase = 'checking' | 'intro' | 'enrolling'

export function MfaGate({ onSatisfied, onLogout }: Props) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [enroll, setEnroll] = useState<{ factorId: string; qrSvg: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Al montar: ¿ya tiene un factor verificado? → satisface. Si no, pide enrolar.
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await listMfaFactors()
      if (!alive) return
      if (findVerifiedTotpFactor(data)) onSatisfied()
      else setPhase('intro')
    })()
    return () => { alive = false }
  }, [onSatisfied])

  const startEnroll = useCallback(async () => {
    setErr(null)
    setBusy(true)
    // Limpia factores TOTP huérfanos (unverified) de intentos previos para que
    // Supabase no rechace el enroll con "factor already exists".
    const { data } = await listMfaFactors()
    for (const o of (data?.all ?? []).filter(f => f.factor_type === 'totp' && f.status === 'unverified')) {
      await unenrollMfaFactor(o.id).catch(() => undefined)
    }
    const res = await enrollTotpFactor(`Authenticator (${hoyLocalISO()})`)
    setBusy(false)
    if (res.error || !res.data) {
      setErr(res.error ?? 'No fue posible iniciar el enrolamiento.')
      return
    }
    setEnroll({ factorId: res.data.id, qrSvg: res.data.totp.qr_code, secret: res.data.totp.secret })
    setPhase('enrolling')
  }, [])

  const submitCode = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (!enroll) return
    setErr(null)
    if (!/^\d{6}$/.test(code.trim())) { setErr('El código debe tener 6 dígitos.'); return }
    setBusy(true)
    const ch = await challengeMfaFactor(enroll.factorId)
    if (ch.error || !ch.data) { setBusy(false); setErr(ch.error ?? 'No fue posible crear el desafío.'); return }
    const { error } = await verifyMfaFactor(enroll.factorId, ch.data.id, code.trim())
    setBusy(false)
    if (error) { setErr('Código incorrecto. Revisá la app de autenticación e intentá de nuevo.'); return }
    onSatisfied()
  }, [enroll, code, onSatisfied])

  if (phase === 'checking') {
    return (
      <Screen>
        <div style={{ color: 'var(--at-ink-3)', fontSize: 14 }}>Verificando seguridad de la cuenta…</div>
      </Screen>
    )
  }

  return (
    <Screen>
      <div style={{ fontSize: 34, marginBottom: 8 }}>🔐</div>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px', color: 'var(--at-ink)' }}>
        Verificación en dos pasos requerida
      </h1>
      <p style={{ fontSize: 14, color: 'var(--at-ink-2)', margin: '0 0 20px', lineHeight: 1.5 }}>
        Tu empresa exige 2FA para operar. Configurá tu app de autenticación
        (Google Authenticator, Authy, 1Password) para continuar.
      </p>

      {err && (
        <div role="alert" style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', color: 'var(--at-danger-strong)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
          {err}
        </div>
      )}

      {phase === 'intro' && (
        <button onClick={() => void startEnroll()} disabled={busy} style={primaryBtn(busy)}>
          {busy ? 'Preparando…' : 'Configurar 2FA'}
        </button>
      )}

      {phase === 'enrolling' && enroll && (
        <>
          <div style={{ background: '#fff', padding: 12, borderRadius: 10, border: '1px solid var(--at-line)', display: 'inline-block', marginBottom: 12, lineHeight: 0 }}
               dangerouslySetInnerHTML={{ __html: enroll.qrSvg }} />
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>
            ¿No podés escanear? Ingresá esta clave en tu app:
          </div>
          <code style={{ display: 'block', background: 'var(--at-chip)', borderRadius: 6, padding: '6px 10px', fontSize: 13, letterSpacing: 1, marginBottom: 16, wordBreak: 'break-all' }}>
            {enroll.secret}
          </code>
          <form onSubmit={submitCode}>
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Código de 6 dígitos"
              aria-label="Código de verificación"
              style={{ width: '100%', padding: '11px 14px', border: '1.5px solid var(--at-line-strong)', borderRadius: 10, fontSize: 18, letterSpacing: 6, textAlign: 'center', fontFamily: 'monospace', boxSizing: 'border-box', marginBottom: 12 }}
            />
            <button type="submit" disabled={busy} style={primaryBtn(busy)}>
              {busy ? 'Verificando…' : 'Activar y continuar'}
            </button>
          </form>
        </>
      )}

      <button onClick={onLogout} style={{ marginTop: 18, background: 'none', border: 'none', color: 'var(--at-ink-3)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
        Cerrar sesión
      </button>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--at-bg)', padding: 20 }}>
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 16, padding: '32px 28px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.12)' }}>
        {children}
      </div>
    </div>
  )
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '12px', fontSize: 15, fontWeight: 700,
    background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
    color: '#fff', border: 'none', borderRadius: 12,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  }
}

import { useState, useEffect } from 'react'
import { fetchCompanySuspension, type CompanySuspension } from '../../domain/shared/queries'

// ============================================================================
// CompanySuspendedBanner — aviso persistente cuando la empresa está suspendida.
// ============================================================================
// Defensa en profundidad del ciclo de vida (migración company_lifecycle): el
// login ya rechaza a usuarios de empresas suspendidas y los triggers de BD
// bloquean las escrituras con prefijo COMPANY_SUSPENDED. Este banner cubre las
// sesiones que YA estaban abiertas cuando el superadmin suspendió la empresa:
// en vez de errores crudos al guardar, el usuario ve el aviso y el motivo.
//
// Se monta en App.tsx junto a TrialExpirationBanner. NO es descartable (la
// suspensión no es autoservicio — la resuelve soporte, no un upgrade).

interface Props {
  companyId: string | null | undefined
}

export function CompanySuspendedBanner({ companyId }: Props) {
  const [suspension, setSuspension] = useState<CompanySuspension | null>(null)

  useEffect(() => {
    if (!companyId) return
    let alive = true
    void fetchCompanySuspension(companyId).then((data) => {
      if (alive) setSuspension(data)
    })
    return () => { alive = false }
  }, [companyId])

  if (!suspension || suspension.activa) return null

  return (
    <div
      role="alert"
      style={{
        background: 'var(--at-danger-tint)',
        borderBottom: '2px solid var(--at-danger)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        position: 'sticky',
        top: 0,
        zIndex: 150,
      }}
    >
      <span style={{ fontSize: '20px' }} aria-hidden="true">⛔</span>
      <span style={{ color: 'var(--at-danger)', fontWeight: 600, fontSize: '14px' }}>
        Tu empresa está <strong>suspendida</strong> — la cuenta queda en modo solo lectura.
        {suspension.suspended_reason && <> Motivo: “{suspension.suspended_reason}”.</>}{' '}
        Comunícate con soporte de AdministraTodo para reactivar el servicio.
      </span>
    </div>
  )
}

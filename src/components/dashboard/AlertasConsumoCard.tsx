// dashboard (D3) — Tarjeta "Alertas de consumo": fugas probables y medidores
// parados detectados sobre el histórico (RPC agua_anomalias_consumo). Se oculta
// sola cuando no hay anomalías, para no ocupar espacio en el caso normal.
import { useAnomaliasConsumoQuery, TIPO_ANOMALIA_META } from '../../domain/agua/anomalias'

interface Props {
  companyId?: string
  projectId?: string | null
  moneda?: string
}

export function AlertasConsumoCard({ companyId, projectId }: Props) {
  const { data: anomalias = [], isLoading } = useAnomaliasConsumoQuery(companyId, projectId)

  if (!companyId || isLoading || anomalias.length === 0) return null

  const fugas = anomalias.filter(a => a.tipo_anomalia === 'fuga_probable').length
  const parados = anomalias.filter(a => a.tipo_anomalia === 'medidor_parado').length

  return (
    <div style={{
      background: 'var(--at-surface)', borderRadius: '20px', padding: '24px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.06)', border: '1px solid var(--at-warning-border, var(--at-line))',
      marginBottom: '24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 22 }}>⚠️</span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--at-ink)' }}>Alertas de consumo</h3>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--at-ink-3)' }}>
          {fugas > 0 && <>{fugas} fuga{fugas !== 1 ? 's' : ''} probable{fugas !== 1 ? 's' : ''}</>}
          {fugas > 0 && parados > 0 && ' · '}
          {parados > 0 && <>{parados} medidor{parados !== 1 ? 'es' : ''} parado{parados !== 1 ? 's' : ''}</>}
        </span>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
        Detectadas sobre el historial de cada medidor: un salto atípico de consumo sugiere fuga; varias lecturas en
        cero seguidas, un medidor trabado o bypass. Revisa antes de emitir el próximo recibo.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {anomalias.slice(0, 12).map(a => {
          const meta = TIPO_ANOMALIA_META[a.tipo_anomalia]
          const alta = a.severidad === 'alta'
          return (
            <div key={a.contador_id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              background: 'var(--at-surface-2, var(--at-chip))', borderRadius: 10,
              borderLeft: `3px solid ${alta ? 'var(--at-danger)' : 'var(--at-warning)'}`,
            }}>
              <span style={{ fontSize: 18 }}>{meta.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.cliente_nombre || 'Cliente'}
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: alta ? 'var(--at-danger)' : 'var(--at-warning-strong, var(--at-warning))' }}>
                    {meta.label}{alta ? ' · alta' : ''}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>
                  {a.tipo_anomalia === 'fuga_probable'
                    ? `Último ${a.ultimo_consumo} m³ vs promedio ${a.promedio} m³ (${a.z_score}σ)`
                    : `${a.ceros_consecutivos} lecturas en cero seguidas`}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { type CSSProperties, type KeyboardEvent } from 'react'
import { Skeleton } from '../shared/Skeleton'
import { Sparkline } from '../shared/Sparkline'
import { formatUsdCents } from './empresaHelpers'
import { computeArpaCents, computeDeltaMrr } from './metricsHelpers'
import type { PlataformaKpis, MrrTrendPoint } from '../../domain/superadmin/queries'

// ============================================================================
// HeroPlataforma — banda titular del dashboard superadmin (ingreso recurrente).
// ============================================================================
// Sustituye al KPI-grid de SuperAdminMetricsCard con la jerarquía C6/F2: la
// cifra titular es el MRR COBRABLE (lo que Stripe factura); el potencial de los
// pilotos sin cobro va aparte como pill clickeable hacia la tabla de empresas.
// Fondo sobre var(--at-nav-bg) (oscuro FIJO en ambos temas — nunca var(--at-ink),
// que se invierte en dark); por eso los overlays blancos aquí sí son legítimos.

const INK_SOFT = 'color-mix(in srgb, var(--at-nav-ink) 62%, transparent)'
const INK_MUTED = 'color-mix(in srgb, var(--at-nav-ink) 45%, transparent)'

interface Props {
  kpis: PlataformaKpis | null | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  /** Serie diaria (misma respuesta que usan las gráficas — cero fetch extra). */
  serie: MrrTrendPoint[]
  onVerEmpresas: () => void
}

export function HeroPlataforma({ kpis, loading, error, onRetry, serie, onVerEmpresas }: Props) {
  if (error) {
    return (
      <div style={{
        background: 'var(--at-surface)', borderRadius: '16px', padding: '20px 24px',
        border: '1px solid var(--at-danger-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: '13px', color: 'var(--at-danger)' }}>
          Error cargando las métricas de plataforma: {error instanceof Error ? error.message : String(error)}
        </div>
        <button onClick={onRetry} style={retryBtnStyle}>Reintentar</button>
      </div>
    )
  }

  if (loading || !kpis) {
    return (
      <div style={heroStyle}>
        <Skeleton onDark width={220} height={12} />
        <Skeleton onDark width={280} height={40} style={{ marginTop: 14 }} />
        <Skeleton onDark width={340} height={14} style={{ marginTop: 12 }} />
        <div style={{ display: 'flex', gap: 24, marginTop: 22 }}>
          <Skeleton onDark width={120} height={22} />
          <Skeleton onDark width={120} height={22} />
        </div>
      </div>
    )
  }

  const delta = computeDeltaMrr(serie)
  const arpaCents = computeArpaCents(kpis.mrr_cobrable_cents, kpis.suscripciones_activas, kpis.empresas_grandfathered)
  // Serie HOMOGÉNEA: cobrable solo con los días que tienen desglose, o total
  // completa — nunca mezclar ambas punto a punto (saltaría de semántica donde
  // arranca la columna nueva).
  const sparkEsCobrable = serie.some(p => p.mrr_cobrable_cents != null)
  const sparkData = sparkEsCobrable
    ? serie.filter(p => p.mrr_cobrable_cents != null).map(p => (p.mrr_cobrable_cents as number) / 100)
    : serie.map(p => p.mrr_cents / 100)

  const onPotencialKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onVerEmpresas()
    }
  }

  return (
    <div style={heroStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' }}>
        {/* Bloque titular: MRR cobrable */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK_MUTED }}>
            Plataforma · Métricas SaaS
          </div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: INK_SOFT, marginTop: '14px' }}>
            MRR cobrable
          </div>
          <div style={{
            fontFamily: 'var(--at-font-mono)', fontVariantNumeric: 'tabular-nums',
            fontSize: 'clamp(32px, 5vw, 42px)', fontWeight: 800, lineHeight: 1.05,
            color: 'var(--at-nav-ink)', marginTop: '2px',
          }}>
            {formatUsdCents(kpis.mrr_cobrable_cents)}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {delta ? (
              <span
                aria-label={`Variación del MRR ${delta.base === 'total' ? 'total' : 'cobrable'} en 30 días: ${delta.pct >= 0 ? 'subió' : 'bajó'} ${Math.abs(delta.pct)} por ciento`}
                style={{
                  ...pillStyle,
                  // Tintes claros fijos: los tokens success/danger cambian con el
                  // tema, pero este fondo es oscuro FIJO en ambos temas.
                  color: delta.pct >= 0 ? '#B7F4C9' : '#F4B7B7',
                }}
              >
                <span aria-hidden="true">{delta.pct >= 0 ? '↑' : '↓'}</span>
                {Math.abs(delta.pct).toFixed(1)}% vs hace 30 días{delta.base === 'total' ? ' · MRR total' : ''}
              </span>
            ) : (
              <span style={{ ...pillStyle, color: INK_MUTED }}>sin comparativo aún</span>
            )}

            {kpis.mrr_potencial_cents > 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={onVerEmpresas}
                onKeyDown={onPotencialKey}
                title="Ver las empresas piloto en la tabla"
                style={{ ...pillStyle, cursor: 'pointer', color: 'var(--at-nav-ink)', border: '1px solid rgba(255,255,255,0.22)' }}
              >
                +{formatUsdCents(kpis.mrr_potencial_cents)} potenciales · {kpis.empresas_grandfathered} piloto{kpis.empresas_grandfathered !== 1 ? 's' : ''} sin cobro →
              </span>
            )}
          </div>

          {/* Fila secundaria: ARR + ARPA */}
          <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', marginTop: '20px' }}>
            <MiniKpi
              label="ARR (run-rate)"
              value={formatUsdCents(kpis.mrr_cobrable_cents * 12)}
              hint="= MRR cobrable × 12"
            />
            <MiniKpi
              label="ARPA"
              value={arpaCents !== null ? formatUsdCents(arpaCents) : '—'}
              hint="por empresa activa de pago (excluye pilotos)"
            />
          </div>
        </div>

        {/* Bloque derecho: tendencia */}
        {sparkData.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', gap: '6px' }}>
            <div style={{ width: 220, maxWidth: '60vw', height: 56 }}>
              <Sparkline
                data={sparkData}
                color="#FFFFFF"
                height={56}
                ariaLabel={`Tendencia del MRR ${sparkEsCobrable ? 'cobrable' : 'total'}, serie diaria`}
              />
            </div>
            <div style={{ fontSize: '10.5px', color: INK_MUTED }}>
              {sparkEsCobrable ? 'MRR cobrable' : 'MRR total'} · serie diaria
            </div>
          </div>
        )}
      </div>

      {/* Footer: totales de plataforma */}
      <div style={{
        display: 'flex', gap: '10px 28px', flexWrap: 'wrap',
        borderTop: '1px solid rgba(255,255,255,0.10)', marginTop: '22px', paddingTop: '16px',
      }}>
        <Total label="Empresas" value={kpis.total_empresas} title={`${kpis.empresas_activas} activas · ${kpis.empresas_inactivas} inactivas`} />
        <Total label="Usuarios" value={kpis.total_usuarios} />
        <Total label="Proyectos" value={kpis.total_proyectos} />
        <Total label="Unidades" value={kpis.total_unidades} />
        <Total label="Suscripciones vigentes" value={kpis.suscripciones_vigentes} title={`${kpis.suscripciones_activas} activas · ${kpis.suscripciones_trialing} en trial`} />
      </div>
    </div>
  )
}

function MiniKpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: INK_MUTED }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--at-font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '20px', fontWeight: 700, color: 'var(--at-nav-ink)', marginTop: '2px' }}>
        {value}
      </div>
      <div style={{ fontSize: '10.5px', color: INK_MUTED, marginTop: '1px' }}>{hint}</div>
    </div>
  )
}

function Total({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <div title={title} style={{ minWidth: 90 }}>
      <div style={{ fontFamily: 'var(--at-font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '17px', fontWeight: 700, color: 'var(--at-nav-ink)' }}>
        {value.toLocaleString('es-GT')}
      </div>
      <div style={{ fontSize: '10.5px', color: INK_MUTED, marginTop: '1px' }}>{label}</div>
    </div>
  )
}

// Fondo oscuro FIJO (nav-bg no cambia con el tema) → overlays blancos legítimos.
const heroStyle: CSSProperties = {
  background: 'linear-gradient(135deg, var(--at-nav-bg) 0%, color-mix(in srgb, var(--at-nav-bg) 78%, var(--at-primary-2)) 60%, color-mix(in srgb, var(--at-nav-bg) 72%, var(--at-accent-2)) 100%)',
  borderRadius: '20px',
  padding: '26px 28px',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: 'var(--at-elevation-3)',
}

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 12px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.10)',
  fontSize: '11.5px',
  fontWeight: 700,
}

const retryBtnStyle: CSSProperties = {
  padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--at-line)',
  background: 'var(--at-surface)', color: 'var(--at-ink-2)', cursor: 'pointer',
  fontSize: '13px', fontWeight: 600,
}

import type { ReactNode } from 'react'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { Icon } from '../../shared/Icon'
import { parseFecha } from '../../../lib/format'
import { TIPO_AGUA_LABELS, type ContadorInfo, type LecturaInfo } from '../../../lib/portalDashboard'
import { ESTADO_COLORS } from './ui'

// Historial de un contador en ventana emergente (Mis Servicios). Antes se
// desplegaba dentro de la tarjeta como una tabla de siete columnas que en el
// teléfono había que arrastrar de lado; aquí cada lectura es una fila legible
// con una barra que compara su consumo con el mayor del período.

interface Props {
  contador: ContadorInfo
  unidadNombre?: string
  proyectoNombre?: string
  moneda: string
  /** Lecturas del contador, de la más reciente a la más antigua. */
  lecturas: LecturaInfo[]
  onClose: () => void
}

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '12px', padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--at-ink)', marginTop: '2px', whiteSpace: 'nowrap' }}>{value}</div>
      {hint && <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '1px' }}>{hint}</div>}
    </div>
  )
}

export function ContadorDetalleModal({ contador, unidadNombre, proyectoNombre, moneda, lecturas, onClose }: Props) {
  const ultima = lecturas[0]
  const maxConsumo = Math.max(0, ...lecturas.map(l => l.consumo))
  const promedio = lecturas.length > 0 ? lecturas.reduce((a, l) => a + l.consumo, 0) / lecturas.length : 0

  return (
    <EditModal
      title={`Contador #${contador.numero_serie}`}
      subtitle={[
        `💧 ${TIPO_AGUA_LABELS[contador.tipo_agua] ?? contador.tipo_agua}`,
        unidadNombre,
        proyectoNombre,
      ].filter(Boolean).join(' · ')}
      maxWidth="640px"
      fullScreenOnMobile
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
    >
      {lecturas.length === 0 ? (
        <EmptyState
          compact
          audience="resident"
          icon={<Icon name="gauge" size={24} />}
          title="No hay lecturas registradas para este contador."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <Metric label="Último consumo" value={`${ultima.consumo.toFixed(2)} m³`} hint={parseFecha(ultima.fecha).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })} />
            <Metric label="Último monto" value={`${moneda} ${ultima.monto_calculado.toFixed(2)}`} hint={(ESTADO_COLORS[ultima.estado] ?? ESTADO_COLORS.pendiente).label} />
            <Metric label="Promedio" value={`${promedio.toFixed(2)} m³`} hint={`Últimas ${lecturas.length} lecturas`} />
          </div>

          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Últimas lecturas
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden' }}>
              {lecturas.map((l, i) => {
                const est = ESTADO_COLORS[l.estado] ?? ESTADO_COLORS.pendiente
                const pct = maxConsumo > 0 ? Math.round((l.consumo / maxConsumo) * 100) : 0
                const periodo = l.dias_servicio != null ? `${l.dias_servicio} días` : l.mes ? `Mes ${l.mes}` : null
                return (
                  <li key={l.id} style={{
                    padding: '12px 14px', background: 'var(--at-surface)',
                    borderTop: i > 0 ? '1px solid var(--at-line)' : 'none',
                    display: 'flex', flexDirection: 'column', gap: '6px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                        {parseFecha(l.fecha).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', whiteSpace: 'nowrap' }}>
                        {moneda} {l.monto_calculado.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--at-primary)', whiteSpace: 'nowrap', minWidth: '84px' }}>
                        {l.consumo.toFixed(2)} m³
                      </span>
                      {/* Barra relativa al mayor consumo del historial: deja ver de un
                          vistazo qué mes se gastó más. */}
                      <span aria-hidden="true" style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'var(--at-chip)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: `${pct}%`, height: '100%', borderRadius: '999px', background: 'var(--at-primary-2)' }} />
                      </span>
                      <span style={{ padding: '2px 9px', borderRadius: '999px', background: est.bg, color: est.color, fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {est.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                      Lectura {l.lectura_anterior.toFixed(2)} → {l.lectura_actual.toFixed(2)}
                      {periodo && ` · ${periodo}`}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </EditModal>
  )
}

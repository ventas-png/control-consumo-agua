// Bloque extraído de VisitantesTab (fase B): JSX idéntico al original.
import type { VisitantesCtx } from './ctx'
import type { Visitante } from '../../../../types'
import { SecureImage } from '../../../shared/SecureImage'

export function VisitanteCard({ ctx, v, isSTRMember = false }: { ctx: VisitantesCtx; v: Visitante; isSTRMember?: boolean }) {
  const { visitantes, setVisitanteDetalle, hoy, iniciarSalida } = ctx
    const enPremisa = !v.hora_salida
    const esSTR = v.motivo?.startsWith('Renta corta')
    // Date restriction only applies to legacy single-person STR entries (no reserva_str_id).
    // Group members with reserva_str_id can always exit individually.
    const fechaSalidaSTR = (esSTR && !v.reserva_str_id) ? (v.notas?.match(/Salida: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null
    const salidaHabilitada = !fechaSalidaSTR || hoy >= fechaSalidaSTR
    const esAcompanante = !!v.visitante_principal_id
    const principal = esAcompanante ? visitantes.find(p => p.id === v.visitante_principal_id) : null
    const acompsActivos = !esAcompanante ? visitantes.filter(a => a.visitante_principal_id === v.id && !a.hora_salida) : []

    const borderColor = enPremisa
      ? (isSTRMember ? 'var(--at-accent-soft)' : esAcompanante ? 'var(--at-primary-soft-2)' : 'var(--at-success-border)')
      : 'var(--at-line)'
    const borderLeft = isSTRMember
      ? '4px solid var(--at-accent)'
      : esAcompanante ? '4px solid var(--at-accent-2)' : undefined

    return (
      <div key={v.id}
        style={{
          background: 'var(--at-surface)',
          border: `1.5px solid ${borderColor}`,
          borderRadius: '12px',
          padding: '12px 14px',
          marginLeft: isSTRMember ? 0 : esAcompanante ? '20px' : 0,
          borderLeft,
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          {v.foto_url
            ? <SecureImage src={v.foto_url} alt={v.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${enPremisa ? (isSTRMember ? 'var(--at-accent)' : esAcompanante ? 'var(--at-primary-2)' : 'var(--at-success)') : 'var(--at-line)'}` }} />
            : <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: v.es_menor
                  ? (enPremisa ? 'var(--at-warning-tint)' : 'var(--at-warning-tint)')
                  : isSTRMember
                    ? (enPremisa ? 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))' : 'var(--at-accent-tint)')
                    : esAcompanante
                      ? (enPremisa ? 'linear-gradient(135deg,var(--at-primary-2),var(--at-primary))' : 'var(--at-accent-soft-2)')
                      : (enPremisa ? 'linear-gradient(135deg,var(--at-success),var(--at-success-strong))' : 'var(--at-line)'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: v.es_menor ? 'var(--at-warning-strong)' : (enPremisa ? 'white' : 'var(--at-ink-3)'),
                fontWeight: 700, fontSize: '15px',
              }}>
              {v.es_menor ? '👶' : v.nombre.charAt(0).toUpperCase()}
            </div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{v.nombre}</span>
              {v.es_menor && (
                <span style={{ padding: '2px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '10.5px', fontWeight: 700 }}>Menor</span>
              )}
              {esAcompanante && (
                <span style={{ padding: '2px 7px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', borderRadius: '20px', fontSize: '10.5px', fontWeight: 700 }}>Acompañante</span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '3px' }}>
              {v.unidad_nombre && <span>📍 {v.unidad_nombre}</span>}
              {v.motivo && <span>· {v.motivo}</span>}
              {!v.es_menor && v.identificacion && <span>· ID: {v.identificacion}</span>}
              {v.es_menor && v.fecha_nacimiento && <span>· Nac. {v.fecha_nacimiento}</span>}
              {v.placa_vehiculo && <span>· 🚗 {v.placa_vehiculo}</span>}
              {esAcompanante && principal && (
                <span style={{ color: 'var(--at-primary-2)' }}>· De: {principal.nombre}</span>
              )}
              {!esAcompanante && acompsActivos.length > 0 && (
                <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>· {acompsActivos.length} acomp. en premisas</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Entrada: {new Date(v.hora_entrada).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
            {v.hora_salida && <span style={{ color: 'var(--at-ink-3)' }}>· Salida: {new Date(v.hora_salida).toLocaleString('es', { hour: '2-digit', minute: '2-digit' })}</span>}
            {enPremisa && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', background: isSTRMember ? 'var(--at-accent-tint)' : esAcompanante ? 'var(--at-primary-soft)' : 'var(--at-success-tint)', color: isSTRMember ? 'var(--at-accent-dark)' : esAcompanante ? 'var(--at-primary-hover)' : 'var(--at-success)', fontWeight: 700 }}>En premisas</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <button onClick={() => setVisitanteDetalle(v)}
              style={{ padding: '6px 12px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              Ver detalle
            </button>
            {enPremisa && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                <button onClick={() => salidaHabilitada && iniciarSalida(v)}
                  title={!salidaHabilitada ? `Salida programada: ${fechaSalidaSTR}` : undefined}
                  style={{ padding: '6px 12px', background: salidaHabilitada ? 'var(--at-warning-tint)' : 'var(--at-chip)', color: salidaHabilitada ? 'var(--at-warning-strong)' : 'var(--at-ink-3)', border: `1px solid ${salidaHabilitada ? 'var(--at-warning-border)' : 'var(--at-line)'}`, borderRadius: '8px', cursor: salidaHabilitada ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Registrar salida
                </button>
                {!salidaHabilitada && <span style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>Hasta {fechaSalidaSTR}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }



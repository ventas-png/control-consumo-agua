// Detalle de un visitante, en ventana (pantalla completa en el teléfono, Esc
// la cierra). Lee el registro vigente: tras registrar la salida ya no dice
// «En premisas».
import type { VisitantesCtx } from './ctx'
import { SecureImage } from '../../../shared/SecureImage'
import { SecureFileLink } from '../../../shared/SecureFileLink'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'

const chip = (bg: string, color: string) => ({ padding: '2px 8px', background: bg, color, borderRadius: '20px', fontSize: '11px', fontWeight: 700 }) as const

export function VisitanteDetalle({ ctx }: { ctx: VisitantesCtx }) {
  const { visitantes, visitanteDetalle, setVisitanteDetalle, hoy, iniciarSalida, canCreate } = ctx
  if (!visitanteDetalle) return null

  const v = visitanteDetalle
  const esSTR = v.motivo?.startsWith('Renta corta')
  const fechaSalidaSTR = (esSTR && !v.reserva_str_id) ? (v.notas?.match(/Salida: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null
  const salidaHabilitada = !fechaSalidaSTR || hoy >= fechaSalidaSTR
  const cerrar = () => setVisitanteDetalle(null)

  const datos = [
    { label: 'Entrada', value: new Date(v.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
    { label: 'Salida', value: v.hora_salida ? new Date(v.hora_salida).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '— En premisas' },
    ...(v.es_menor
      ? [{ label: 'Tipo', value: 'Menor de edad' }]
      : v.identificacion ? [{ label: 'DPI / ID', value: v.identificacion }] : []),
    ...(v.fecha_nacimiento ? [{ label: 'Fecha nac.', value: v.fecha_nacimiento }] : []),
    ...(v.placa_vehiculo ? [{ label: 'Vehículo', value: `🚗 ${v.placa_vehiculo}` }] : []),
    ...(v.motivo ? [{ label: 'Motivo', value: v.motivo }] : []),
    ...(v.notas ? [{ label: 'Notas', value: v.notas }] : []),
    ...(v.visitante_principal_id ? (() => {
      const p = visitantes.find(x => x.id === v.visitante_principal_id)
      return p ? [{ label: 'Acompañante de', value: p.nombre }] : []
    })() : []),
  ]

  return (
    <EditModal
      title={v.nombre}
      subtitle={
        <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {v.unidad_nombre && <span>📍 {v.unidad_nombre}</span>}
          {v.es_menor && <span style={chip('var(--at-warning-tint)', 'var(--at-warning-strong)')}>Menor</span>}
          {v.visitante_principal_id && <span style={chip('var(--at-primary-tint)', 'var(--at-primary-hover)')}>Acompañante</span>}
          {v.reserva_str_id && <span style={chip('var(--at-accent-tint-2)', 'var(--at-accent-hover)')}>STR</span>}
          {v.solicitud_mudanza_id && <span style={chip('var(--at-warning-tint)', 'var(--at-warning)')}>Mudanza</span>}
        </span>
      }
      maxWidth="520px"
      fullScreenOnMobile
      onClose={cerrar}
      footer={
        <>
          {!v.hora_salida && canCreate && salidaHabilitada && (
            <Button variant="warning" onClick={() => { setVisitanteDetalle(null); iniciarSalida(v) }}>Registrar salida</Button>
          )}
          <Button variant="secondary" onClick={cerrar}>Cerrar</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {v.foto_url
            ? <SecureImage src={v.foto_url} alt={v.nombre} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--at-line)', flexShrink: 0 }} />
            : <div aria-hidden style={{ width: 52, height: 52, borderRadius: '50%', background: !v.hora_salida ? 'linear-gradient(135deg,var(--at-success),var(--at-success-strong))' : 'var(--at-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: !v.hora_salida ? 'white' : 'var(--at-ink-3)', fontWeight: 800, fontSize: '20px', flexShrink: 0 }}>
                {v.es_menor ? '👶' : v.nombre.charAt(0).toUpperCase()}
              </div>
          }
          <span style={{ fontSize: '13px', fontWeight: 700, color: v.hora_salida ? 'var(--at-ink-3)' : 'var(--at-success)' }}>
            {v.hora_salida ? 'Ya salió' : '🟢 En premisas'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '10px' }}>
          {datos.map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '10px 12px', border: '1px solid var(--at-line)', minWidth: 0 }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>{label}</div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</div>
            </div>
          ))}
        </div>
        {(v.foto_url || v.foto_documento_url || v.foto_vehiculo_url) && (
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Fotografías registradas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 96px), 1fr))', gap: '8px' }}>
              {[
                { url: v.foto_url, label: 'Persona' },
                { url: v.foto_documento_url, label: 'DPI' },
                { url: v.foto_vehiculo_url, label: 'Vehículo' },
              ].filter(f => f.url).map(f => (
                <SecureFileLink key={f.label} src={f.url} style={{ textDecoration: 'none' }}>
                  {signed => (
                    <>
                      <img src={signed} alt={f.label} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
                      <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', textAlign: 'center', marginTop: '3px' }}>{f.label}</div>
                    </>
                  )}
                </SecureFileLink>
              ))}
            </div>
          </div>
        )}
      </div>
    </EditModal>
  )
}

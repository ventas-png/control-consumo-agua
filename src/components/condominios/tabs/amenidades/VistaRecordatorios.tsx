// Vista extraída de AmenidadesTab (fase B): JSX idéntico al original.
import type { AmenidadesCtx } from './ctx'
import { EmptyState } from './comunes'
import { formatFechaCalendario, sumarDiasCalendario } from '../../../../lib/format'

export function VistaRecordatorios({ ctx }: { ctx: AmenidadesCtx }) {
  const { reservas, unidades, hoy, enviarRecordatorio } = ctx
        // El límite es una fecha de CALENDARIO: «hoy y los próximos 2 días».
        // Con `toISOString().slice(0,10)` se tomaba el día UTC, así que en
        // Guatemala (GMT-6) a partir de las 18:00 el límite saltaba al día
        // siguiente y la vista colaba un TERCER día de reservas.
        const limiteStr = sumarDiasCalendario(hoy, 2) ?? hoy
        const proximas = reservas
          .filter(r => r.estado !== 'cancelada' && r.fecha >= hoy && r.fecha <= limiteStr)
          .sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio))
        const pendientes = proximas.filter(r => !r.recordatorio_enviado)

        return (
          <>
            <div style={{ background: 'var(--at-primary-tint)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: 12, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: 'var(--at-ink-deep)' }}>
              📨 Reservas para hoy y los próximos 2 días: <strong>{proximas.length}</strong> · Sin recordatorio enviado: <strong>{pendientes.length}</strong>
              <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 4 }}>Al hacer clic en <strong>Enviar WhatsApp</strong> se abrirá la app/web de WhatsApp con el mensaje listo. La reserva queda marcada como recordada.</div>
            </div>
            {proximas.length === 0 ? (
              <EmptyState icon="📨" title="No hay reservas próximas para recordar"
                hint="Cuando haya reservas confirmadas para hoy o los próximos 2 días, aparecerán aquí con un botón para enviarles WhatsApp." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {proximas.map(r => {
                  const unidad = unidades.find(u => u.id === r.unidad_id)
                  const tieneTel = !!unidad?.propietario_telefono?.trim()
                  return (
                    <div key={r.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${r.recordatorio_enviado ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>{r.amenidad_nombre}</div>
                        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                          {r.unidad_nombre} · {r.fecha === hoy ? 'HOY' : formatFechaCalendario(r.fecha, { weekday: 'long', day: '2-digit', month: 'long' }, 'es', '—')} · {r.hora_inicio}–{r.hora_fin}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>
                          {unidad?.propietario_nombre || '— sin propietario —'} {tieneTel ? `· ${unidad?.propietario_telefono}` : '· sin teléfono'}
                        </div>
                      </div>
                      {r.recordatorio_enviado && (
                        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>
                          ✓ Enviado
                        </span>
                      )}
                      <button onClick={() => enviarRecordatorio(r)} disabled={!tieneTel}
                        style={{ padding: '7px 14px', background: tieneTel ? '#25d366' : 'var(--at-line)', color: tieneTel ? 'white' : 'var(--at-ink-3)', border: 'none', borderRadius: 8, cursor: tieneTel ? 'pointer' : 'not-allowed', fontSize: 12.5, fontWeight: 700 }}
                        title={tieneTel ? 'Abrir WhatsApp con mensaje' : 'Falta teléfono del propietario'}>
                        💬 {r.recordatorio_enviado ? 'Reenviar' : 'Enviar WhatsApp'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )
}

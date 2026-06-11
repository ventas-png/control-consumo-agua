// Bloque extraído de VisitantesTab (fase B): JSX idéntico al original.
import type { VisitantesCtx } from './ctx'
import { VisitanteCard } from './VisitanteCard'
import { TIPO_MUDANZA_LABEL } from './ui'

export function ListaVisitantes({ ctx }: { ctx: VisitantesCtx }) {
  const { canCreate, filtroFecha, filtrados, strGruposMap, mudanzaGruposMap, regulares } = ctx
  return (
    filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🚪</div>
          <div style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>Sin visitantes{filtroFecha !== 'todos' ? ' en este período' : ' registrados'}</div>
          {canCreate && <div style={{ fontSize: '13px', marginTop: '4px' }}>Usa &quot;+ Registrar visita&quot; para añadir el primero</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Regular visitors */}
          {regulares.map(v => <VisitanteCard ctx={ctx} v={v} />)}

          {/* STR group blocks */}
          {[...strGruposMap.values()].map(({ reserva, miembros }) => {
            const enPremisasAhora = miembros.filter(m => !m.hora_salida).length
            const capacidad = reserva.num_adultos + reserva.num_ninos
            return (
              <div key={reserva.id}>
                {/* Group header */}
                <div style={{ background: 'linear-gradient(to right,var(--at-accent-tint-2),var(--at-accent-tint))', border: '1.5px solid var(--at-accent-soft)', borderRadius: '12px', padding: '12px 16px', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-accent-darker)' }}>
                        🏠 {reserva.huesped_nombre}
                        {reserva.unidad_nombre && <span style={{ fontWeight: 400, color: 'var(--at-accent-hover)', marginLeft: 6 }}>— {reserva.unidad_nombre}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--at-accent-hover)', marginTop: '2px' }}>
                        Renta corta · {reserva.fecha_entrada} → {reserva.fecha_salida}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 }}>
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: enPremisasAhora >= capacidad ? 'var(--at-success-tint)' : 'var(--at-accent-tint)', color: enPremisasAhora >= capacidad ? 'var(--at-success)' : 'var(--at-accent-dark)' }}>
                        {enPremisasAhora}/{capacidad} en premisas
                      </span>
                    </div>
                  </div>
                </div>
                {/* Group members */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '16px' }}>
                  {miembros.map(v => <VisitanteCard ctx={ctx} v={v} isSTRMember />)}
                </div>
              </div>
            )
          })}

          {/* Mudanza group blocks */}
          {[...mudanzaGruposMap.values()].map(({ solicitud, miembros }) => {
            const enPremisasAhora = miembros.filter(m => !m.hora_salida).length
            const fechaEfectiva = solicitud.fecha_autorizada ?? solicitud.fecha_solicitada ?? ''
            const horaEfectiva = solicitud.hora_autorizada ?? solicitud.hora_solicitada ?? ''
            return (
              <div key={solicitud.id}>
                <div style={{ background: 'linear-gradient(to right,var(--at-warning-tint),var(--at-warning-tint))', border: '1.5px solid #fdba74', borderRadius: '12px', padding: '12px 16px', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-warning-strong)' }}>
                        🚛 {TIPO_MUDANZA_LABEL[solicitud.tipo_mudanza] ?? solicitud.tipo_mudanza}
                        {solicitud.unidad_nombre && <span style={{ fontWeight: 400, color: 'var(--at-warning-strong)', marginLeft: 6 }}>— {solicitud.unidad_nombre}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--at-warning-strong)', marginTop: '2px' }}>
                        {fechaEfectiva}{horaEfectiva ? ` ${horaEfectiva}` : ''}{solicitud.hora_fin ? ` → ${solicitud.hora_fin}` : ''}
                        {solicitud.empresa_mudanza ? ` · ${solicitud.empresa_mudanza}` : ''}
                      </div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' }}>
                      {enPremisasAhora} en premisas
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '16px' }}>
                  {miembros.map(v => <VisitanteCard ctx={ctx} v={v} isSTRMember />)}
                </div>
              </div>
            )
          })}
        </div>
      )
  )
}

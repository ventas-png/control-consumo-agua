import { SecureImage } from '../../shared/SecureImage'
import { BUCKET_EVIDENCIAS } from '../../../domain/shared/buckets'
import {
  diasParaVencer, esPiezaSaliente, etiquetaEstadoResidente, SUBTIPOS,
} from '../../../domain/condominios/recepcion'
import { hoyLocalISO } from '../../../lib/format'
import type { PiezaRecepcion } from '../../../types'

interface Props {
  correspondencia: PiezaRecepcion[]
}

/**
 * "Mi correspondencia" del portal del residente.
 *
 * La RLS ya le concedía estas filas (rama `unidad_id IN mis_unidades_ids()`,
 * desde 20260713020000), pero ninguna pantalla las leía: el residente no tenía
 * forma de enterarse de que le había llegado una carta o una notificación
 * hasta que alguien se lo dijera. Aquí las ve, con su acuse si ya la retiró.
 *
 * Es de SOLO LECTURA a propósito. La correspondencia no se firma desde el
 * portal —`paquete_firmar_recepcion` está acotada a clase='paquete'
 * (20260829000000)— porque se entrega en administración con identificación de
 * por medio; un acuse a distancia no probaría nada.
 *
 * ENTRADAS Y SALIDAS NO SE CUENTAN IGUAL. Una pieza `direccion='saliente'` es
 * algo que el residente MANDÓ, no algo que le espera: presentarla como
 * "pendiente de retiro", contarla entre las que tiene que ir a recoger y
 * mostrarle un "plazo de respuesta" es pedirle que vaya a buscar su propio
 * envío. Aquí sale con su vocabulario ("En trámite de envío" / "Enviada") y sin
 * ninguna de esas tres cosas.
 */

const ESTADO_STYLE: Record<string, { bg: string; color: string }> = {
  pendiente: { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  atendido:  { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  archivado: { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
  devuelto:  { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

function fechaLarga(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function PortalCorrespondenciaTab({ correspondencia }: Props) {
  const hoy = hoyLocalISO()
  // Solo las ENTRADAS pendientes son "por retirar". Las salidas pendientes
  // están esperando al mensajero, no al residente.
  const pendientes = correspondencia.filter(c => c.estado === 'pendiente' && !esPiezaSaliente(c))

  if (correspondencia.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>📬</div>
        <p style={{ fontWeight: 600 }}>Sin correspondencia</p>
        <p style={{ fontSize: '13px' }}>Aquí verás las cartas y notificaciones que lleguen a tu unidad.</p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ margin: '0 0 16px', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
        {correspondencia.length} piezas
        {pendientes.length > 0 && (
          <> · <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{pendientes.length} por retirar en administración</span></>
        )}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {correspondencia.map(c => {
          const subtipo = SUBTIPOS.correspondencia[c.tipo] ?? SUBTIPOS.correspondencia.otro
          const estilo = ESTADO_STYLE[c.estado] ?? ESTADO_STYLE.pendiente
          const salida = esPiezaSaliente(c)
          const etiqueta = etiquetaEstadoResidente(c)
          // El plazo de respuesta solo aplica a lo que le llegó: una salida no
          // le exige nada al residente.
          const dias = !salida && c.estado === 'pendiente' && c.fecha_limite
            ? diasParaVencer(c.fecha_limite, hoy) : null
          return (
            <div key={c.id} style={{
              background: 'var(--at-surface)',
              border: `1.5px solid ${c.estado === 'pendiente' ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
              borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: '14px',
            }}>
              <div style={{ fontSize: '26px', flexShrink: 0 }}>{subtipo.icono}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>{c.descripcion}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '20px', padding: '2px 9px' }}>
                    {subtipo.label}
                  </span>
                  {c.prioridad === 'urgente' && (
                    <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--at-danger)' }}>URGENTE</span>
                  )}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                  {salida ? 'Registrada para envío el ' : 'Recibida el '}
                  {fechaLarga(c.fecha_pieza ?? c.hora_recepcion)}
                  {salida
                    ? (c.destinatario ? ` · Para: ${c.destinatario}` : '')
                    : (c.remitente ? ` · De: ${c.remitente}` : '')}
                </div>
                {/* El plazo es lo único que le exige algo al residente: se
                    muestra solo mientras la pieza siga sin retirarse. */}
                {dias !== null && !Number.isNaN(dias) && (
                  <div style={{
                    fontSize: '12.5px', fontWeight: 700, marginTop: '4px',
                    color: dias < 0 ? 'var(--at-danger)' : dias <= 3 ? 'var(--at-warning-strong)' : 'var(--at-ink-2)',
                  }}>
                    {dias < 0
                      ? `⚠ Plazo vencido el ${fechaLarga(c.fecha_limite)}`
                      : dias === 0 ? '⚠ El plazo vence hoy'
                      : `Plazo de respuesta: ${fechaLarga(c.fecha_limite)} (${dias} días)`}
                  </div>
                )}
                {c.estado === 'atendido' && (
                  <div style={{ fontSize: '12px', color: 'var(--at-success)', fontWeight: 600, marginTop: '4px' }}>
                    {salida ? (
                      <>✓ Enviada {c.hora_entrega ? `el ${fechaLarga(c.hora_entrega)}` : ''}</>
                    ) : (
                      <>
                        ✓ Entregada {c.hora_entrega ? `el ${fechaLarga(c.hora_entrega)}` : ''}
                        {c.entregado_a_nombre ? ` a ${c.entregado_a_nombre}` : ''}
                        {c.firma_path ? ' · con firma de acuse' : ''}
                      </>
                    )}
                  </div>
                )}
                {c.fotos && c.fotos.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {c.fotos.map(f => (
                      <SecureImage key={f} src={f} bucket={BUCKET_EVIDENCIAS} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)' }} />
                    ))}
                  </div>
                )}
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, flexShrink: 0,
                background: estilo.bg, color: estilo.color,
              }}>{etiqueta}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

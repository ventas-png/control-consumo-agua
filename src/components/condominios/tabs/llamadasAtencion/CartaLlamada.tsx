import type { CSSProperties } from 'react'
import { SecureImage } from '../../../shared/SecureImage'
import { BUCKET_RRHH_LLAMADAS } from '../../../../domain/shared/buckets'
import { ESTADO_LLAMADA, tipoLlamadaTitulo } from '../../../../domain/condominios/llamadasAtencion'
import { formatDateTime, formatFechaCalendario } from '../../../../lib/format'
import type { CartaParaPdf } from './llamadasAtencionPdf'

interface Props {
  carta: CartaParaPdf
  proyectoNombre?: string | null
  /** Sin el bloque de firmas (el formulario de acuse pone el suyo debajo). */
  sinFirmas?: boolean
}

const lbl: CSSProperties = { fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }

/** La carta tal cual se emitió: la misma lectura para RRHH y para el empleado. */
export function CartaLlamada({ carta, proyectoNombre, sinFirmas = false }: Props) {
  const estado = ESTADO_LLAMADA[carta.estado]
  return (
    <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '12px', padding: '20px 22px', fontSize: '14px', color: 'var(--at-ink)', lineHeight: 1.55 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div>
          {proyectoNombre && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{proyectoNombre}</div>}
          <div style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '0.02em' }}>{tipoLlamadaTitulo(carta.tipo)}</div>
        </div>
        <span style={{ alignSelf: 'flex-start', padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: estado.bg, color: estado.color }}>
          {estado.label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px 16px', marginBottom: '14px' }}>
        <div><div style={lbl}>Para</div><div>{carta.empleado_nombre}{carta.empleado_cargo ? <span style={{ color: 'var(--at-ink-3)' }}> — {carta.empleado_cargo}</span> : null}</div></div>
        <div><div style={lbl}>Fecha de los hechos</div><div>{formatFechaCalendario(carta.fecha_hechos, { day: 'numeric', month: 'long', year: 'numeric' }, 'es', carta.fecha_hechos)}</div></div>
        {carta.tipo === 'suspension' && carta.dias_suspension ? (
          <div><div style={lbl}>Suspensión</div><div>{carta.dias_suspension} día{carta.dias_suspension === 1 ? '' : 's'} sin goce de salario</div></div>
        ) : null}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={lbl}>Asunto</div>
        <div style={{ fontWeight: 600 }}>{carta.motivo}</div>
      </div>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: carta.fundamento ? '12px' : 0 }}>{carta.descripcion}</div>
      {carta.fundamento && (
        <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)' }}><span style={{ fontWeight: 700 }}>Fundamento:</span> {carta.fundamento}</div>
      )}

      {!sinFirmas && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginTop: '20px', paddingTop: '14px', borderTop: '1px solid var(--at-line)' }}>
          <BloqueFirma path={carta.firma_emisor_path} titulo="Emitida por" nombre={carta.emitido_por_nombre || 'La administración'} cuando={carta.emitido_en} />
          {carta.acuse_en ? (
            <BloqueFirma path={carta.firma_acuse_path} titulo="Recibí" nombre={carta.acuse_nombre ?? ''} cuando={carta.acuse_en}
              nota={carta.acuse_modo === 'presencial' ? 'Firmado en persona' : carta.acuse_modo === 'usuario' ? 'Firmado desde su cuenta' : undefined} />
          ) : (
            <div>
              <div style={lbl}>Recibí</div>
              <div style={{ height: '64px', display: 'flex', alignItems: 'center', color: 'var(--at-warning-strong)', fontSize: '13px' }}>Pendiente de firma de recibido</div>
            </div>
          )}
        </div>
      )}
      {carta.estado === 'anulada' && (
        <div style={{ marginTop: '14px', padding: '8px 12px', borderRadius: '8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontSize: '13px' }}>
          <b>Anulada</b> el {formatDateTime(carta.anulada_en, 'es')}{carta.motivo_anulacion ? `: ${carta.motivo_anulacion}` : ''}
        </div>
      )}
    </div>
  )
}

function BloqueFirma({ path, titulo, nombre, cuando, nota }: { path?: string | null; titulo: string; nombre: string; cuando?: string | null; nota?: string }) {
  return (
    <div>
      <div style={lbl}>{titulo}</div>
      <div style={{ height: '64px', background: '#fff', border: '1px solid var(--at-line)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', margin: '4px 0' }}>
        <SecureImage src={path} bucket={BUCKET_RRHH_LLAMADAS} alt={`Firma: ${titulo} ${nombre}`} style={{ maxHeight: '60px', maxWidth: '100%' }}
          placeholder={<span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Cargando firma…</span>} />
      </div>
      <div style={{ fontSize: '13px', fontWeight: 600 }}>{nombre}</div>
      <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{formatDateTime(cuando, 'es')}{nota ? ` · ${nota}` : ''}</div>
    </div>
  )
}

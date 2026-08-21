// Piezas de solo lectura compartidas por las dos caras de la solicitud de
// autorización de renta: el portal del propietario (PortalRentasTab, que muestra
// lo que envió) y el panel de la administración (SolicitudesRentaTab, que lo
// evalúa). Viven aquí para que ambas rindan exactamente los mismos datos.
import type { DocumentoSolicitudRenta, SolicitudRentaUnidad } from '../../types'
import { SecureFileLink } from '../shared/SecureFileLink'
import { fileIcon, nombreDeArchivo } from '../shared/FileUploader'

/** Bucket privado de los adjuntos de la solicitud (20260828000100). */
export const BUCKET_RENTA_DOCS = 'renta-docs'

/** Los adjuntos llegan como jsonb: puede ser null, y en filas viejas no existe. */
export function documentosDe(s: Pick<SolicitudRentaUnidad, 'documentos'>): DocumentoSolicitudRenta[] {
  return Array.isArray(s.documentos) ? s.documentos : []
}

/** `true` si la solicitud trae los datos que el contrato exige NOT NULL. */
export function tieneDatosContrato(s: Pick<SolicitudRentaUnidad, 'arrendatario_nombre' | 'monto_renta' | 'fecha_inicio'>): boolean {
  return Boolean(s.arrendatario_nombre?.trim()) && s.monto_renta != null && Boolean(s.fecha_inicio)
}

function Dato({ label, valor }: { label: string; valor: string | null | undefined }) {
  if (!valor) return null
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)' }}>{label}</div>
      <div style={{ fontSize: '13px', color: 'var(--at-ink)' }}>{valor}</div>
    </div>
  )
}

/** Grilla con los datos de contrato que el propietario propuso. */
export function DatosContratoSolicitud({ solicitud, moneda = 'Q', titulo = '📄 Datos del arrendamiento propuestos' }: {
  solicitud: SolicitudRentaUnidad
  moneda?: string
  titulo?: string
}) {
  const s = solicitud
  if (!s.arrendatario_nombre && s.monto_renta == null && !s.fecha_inicio) return null
  return (
    <div style={{
      marginTop: '12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
      borderRadius: '10px', padding: '12px 14px',
    }}>
      <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '10px' }}>{titulo}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
        <Dato label="Arrendatario" valor={s.arrendatario_nombre} />
        <Dato label="DPI / Identificación" valor={s.arrendatario_identificacion} />
        <Dato label="Teléfono" valor={s.arrendatario_telefono} />
        <Dato label="Email" valor={s.arrendatario_email} />
        <Dato label="Monto de renta" valor={s.monto_renta != null ? `${moneda} ${s.monto_renta.toLocaleString()}` : null} />
        <Dato label="Depósito" valor={s.deposito != null ? `${moneda} ${s.deposito.toLocaleString()}` : null} />
        <Dato label="Día de pago" valor={s.dia_pago != null ? `Día ${s.dia_pago}` : null} />
        <Dato label="Período" valor={s.fecha_inicio ? `${s.fecha_inicio} → ${s.fecha_fin ?? 'indefinido'}` : null} />
      </div>
      {s.notas_contrato && (
        <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
          <span style={{ fontWeight: 600 }}>Notas:</span> {s.notas_contrato}
        </div>
      )}
    </div>
  )
}

/** Lista de adjuntos, cada uno como link firmado del bucket privado. */
export function DocumentosSolicitudRenta({ documentos, titulo = '📎 Documentos anexos' }: {
  documentos: DocumentoSolicitudRenta[]
  titulo?: string
}) {
  if (documentos.length === 0) return null
  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
        {titulo} ({documentos.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {documentos.map(d => {
          const nombre = d.nombre || nombreDeArchivo(d.path)
          return (
            <SecureFileLink
              key={d.path}
              src={d.path}
              bucket={BUCKET_RENTA_DOCS}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', background: 'var(--at-surface)',
                border: '1px solid var(--at-line)', borderRadius: '8px',
                textDecoration: 'none', color: 'inherit',
              }}
            >
              <span style={{ fontSize: '17px' }}>{fileIcon(nombre)}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>
                  {d.etiqueta?.trim() || nombre}
                </span>
                {d.etiqueta?.trim() && (
                  <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{nombre}</span>
                )}
              </span>
            </SecureFileLink>
          )
        })}
      </div>
    </div>
  )
}

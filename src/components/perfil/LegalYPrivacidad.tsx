import { type CSSProperties } from 'react'
import { useLegalStatusQuery, type LegalDocStatus } from '../../domain/legal/queries'
import { useAceptarLegalMutation, useExportMyDataMutation } from '../../domain/legal/mutations'
import { resumirEstadoLegal } from '../../lib/legalStatus'
import { descargarJson, nombreArchivoExport } from '../../lib/descargaArchivo'

// plat:P33/P34 — Documentos legales (Términos, Privacidad, DPA): estado de
// aceptación del usuario y acción para aceptar la versión vigente. Se monta
// dentro de una <Card> en PerfilSection. Lógica en src/domain/legal + helper puro.

function fechaCorta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' })
}

const hintStyle: CSSProperties = { fontSize: '13px', color: 'var(--at-ink-3)', padding: '8px 0' }
const linkBtnStyle: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--at-primary)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '13px' }
const verLinkStyle: CSSProperties = { fontSize: '12px', color: 'var(--at-primary)', fontWeight: 600, textDecoration: 'none' }
const empresaBadge: CSSProperties = { marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-2)', background: 'var(--at-chip)', padding: '1px 7px', borderRadius: '8px' }
const aceptadoStyle: CSSProperties = { fontSize: '12px', color: '#10b981', fontWeight: 600, flexShrink: 0 }
const aceptarBtnStyle: CSSProperties = { border: '1px solid var(--at-primary)', background: 'var(--at-primary)', color: 'white', fontWeight: 600, fontSize: '13px', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', flexShrink: 0 }

function rowStyle(pendiente: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
    border: '1px solid var(--at-line)', borderRadius: '10px',
    background: pendiente ? 'var(--at-warning-tint)' : 'var(--at-surface)',
  }
}

export function LegalYPrivacidad() {
  const { data: docs = [], isLoading, isError, refetch } = useLegalStatusQuery()
  const aceptar = useAceptarLegalMutation()
  const exportar = useExportMyDataMutation()

  async function handleExportar() {
    try {
      const data = await exportar.mutateAsync()
      descargarJson(data, nombreArchivoExport())
    } catch {
      /* el estado de error se muestra en la sección de export */
    }
  }

  if (isLoading) return <div style={hintStyle}>Cargando documentos…</div>
  if (isError) {
    return (
      <div style={hintStyle}>
        No se pudieron cargar los documentos.{' '}
        <button style={linkBtnStyle} onClick={() => void refetch()}>Reintentar</button>
      </div>
    )
  }
  if (docs.length === 0) return <div style={hintStyle}>No hay documentos legales para revisar.</div>

  const resumen = resumirEstadoLegal(docs)

  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginTop: 0, marginBottom: '14px', lineHeight: 1.5 }}>
        {resumen.todoAceptado
          ? 'Estás al día con los documentos legales vigentes.'
          : `Tienes ${resumen.pendientes} documento(s) pendiente(s) de aceptar.`}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {docs.map((d: LegalDocStatus) => (
          <div key={`${d.doc_type}-${d.version}`} style={rowStyle(!d.accepted)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--at-ink)' }}>
                {d.title}
                {d.audience === 'company' && <span style={empresaBadge}>Empresa</span>}
              </div>
              {d.summary && (
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px' }}>{d.summary}</div>
              )}
              <div style={{ marginTop: '5px' }}>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" style={verLinkStyle}>
                    Ver documento ↗
                  </a>
                )}
              </div>
            </div>
            {d.accepted ? (
              <span style={aceptadoStyle}>✓ Aceptado{d.accepted_at ? ` · ${fechaCorta(d.accepted_at)}` : ''}</span>
            ) : (
              <button
                onClick={() => aceptar.mutate(d.doc_type)}
                disabled={aceptar.isPending}
                style={aceptarBtnStyle}
              >
                {aceptar.isPending ? '…' : 'Aceptar'}
              </button>
            )}
          </div>
        ))}
      </div>

      {aceptar.isError && (
        <div style={{ fontSize: '12px', color: 'var(--at-danger)', marginTop: '8px' }}>
          No se pudo registrar la aceptación. Intenta de nuevo.
        </div>
      )}

      {/* plat:P35 — derecho de acceso/portabilidad (GDPR): descarga de datos */}
      <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--at-chip)' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--at-ink)', marginBottom: '4px' }}>
          Mis datos (GDPR)
        </div>
        <p style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginTop: 0, marginBottom: '12px', lineHeight: 1.5 }}>
          Descarga una copia de tus datos personales (perfil, aceptaciones, notificaciones,
          eventos de seguridad y sesiones) en formato JSON.
        </p>
        <button
          onClick={() => void handleExportar()}
          disabled={exportar.isPending}
          style={{ border: '1px solid var(--at-line)', background: 'var(--at-surface-2)', color: 'var(--at-ink)', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}
        >
          {exportar.isPending ? 'Preparando…' : 'Descargar mis datos (JSON)'}
        </button>
        {exportar.isError && (
          <div style={{ fontSize: '12px', color: 'var(--at-danger)', marginTop: '8px' }}>
            No se pudo generar el export. Intenta de nuevo.
          </div>
        )}
      </div>
    </div>
  )
}

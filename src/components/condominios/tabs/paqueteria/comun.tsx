// Piezas que comparten Entrantes y Salidas de Paquetería: los rótulos de tipo,
// los estilos de los campos y lo que muestra la ventana de detalle (datos,
// fotos y firma). Antes cada pestaña llevaba su copia.
import type { CSSProperties, ReactNode } from 'react'
import { SecureImage } from '../../../shared/SecureImage'

// Clave `string`: la fila del motor único puede traer el vocabulario de la otra
// clase. Ver la nota en PaqueteriaTab.
export const TIPO_CONFIG: Record<string, { label: string; icon: string }> = {
  paquete:   { label: 'Paquete',   icon: '📦' },
  documento: { label: 'Documento', icon: '📄' },
  sobre:     { label: 'Sobre',     icon: '✉️' },
  otro:      { label: 'Otro',      icon: '🎁' },
}

export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  background: 'var(--at-surface-2)', color: 'var(--at-ink)',
}
export const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }

/** Dos columnas que bajan a una en el teléfono (antes eran `1fr 1fr` fijas). */
export const rejillaFormulario: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '14px', alignItems: 'start',
}

export function fechaCorta(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
}

export function Chip({ bg, color, children }: { bg: string; color: string; children: ReactNode }) {
  return <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>
}

/** Fila «rótulo — valor» del detalle. */
export function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: '13.5px' }}>
      <span style={{ color: 'var(--at-ink-3)', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--at-ink)', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

/** Todas las fotos del paquete (la lista sólo muestra la primera) y la firma de entrega. */
export function FotosYFirma({ fotos, firma }: { fotos?: string[] | null; firma?: string | null }) {
  const lista = fotos ?? []
  if (lista.length === 0 && !firma) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
      {lista.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
            Fotos ({lista.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 96px), 1fr))', gap: '8px' }}>
            {lista.map((f, i) => (
              <SecureImage key={f} src={f} alt={`Foto ${i + 1} del paquete`}
                style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
            ))}
          </div>
        </div>
      )}
      {firma && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Firma de entrega</div>
          <SecureImage src={firma} alt="Firma de entrega"
            style={{ width: '100%', height: '90px', objectFit: 'contain', background: '#fff', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
        </div>
      )}
    </div>
  )
}

/** Miniatura de la lista: la primera foto o el ícono. */
export function Miniatura({ fotos, icono }: { fotos?: string[] | null; icono: string }) {
  return fotos && fotos.length > 0
    ? <SecureImage src={fotos[0]} alt="" style={{ width: '46px', height: '46px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, border: '1px solid var(--at-line)' }} />
    : <div aria-hidden style={{ fontSize: '28px', flexShrink: 0, width: '46px', textAlign: 'center' }}>{icono}</div>
}

/**
 * Tarjeta de la lista. Tocarla abre el detalle; «Ver» es el camino de teclado
 * y las acciones de la derecha no la abren. En el teléfono las acciones bajan
 * debajo de los datos en vez de apretarlos en una columna angosta.
 */
export function TarjetaPaquete({ resaltada, onAbrir, miniatura, children, acciones }: {
  resaltada: boolean
  onAbrir: () => void
  miniatura: ReactNode
  children: ReactNode
  acciones: ReactNode
}) {
  return (
    <div onClick={onAbrir} className="cond-kpi-link"
      style={{ background: 'var(--at-surface)', border: `1.5px solid ${resaltada ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px 14px', flexWrap: 'wrap', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: '1 1 260px', minWidth: 0 }}>
        {miniatura}
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
        {acciones}
      </div>
    </div>
  )
}

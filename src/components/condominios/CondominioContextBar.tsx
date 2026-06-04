import { useActiveCondominio } from './ActiveCondominioContext'

// cond:B5 (switcher) + cond:B6 (banner de contexto activo).
//
// Banda de cabecera de la sección Condominios que muestra el CONDOMINIO ACTIVO
// (logo + nombre — cond:B6) y, cuando la empresa gestiona varios, un switcher
// (cond:B5) para cambiarlo SIN recarga. El cambio solo actualiza el contexto
// (`setActiveProjectId`); como las queries de la sección dependen del
// `activeProjectId`, refetchean solas — no se usa `window.location`.

interface Props {
  /** Mostrado bajo el nombre mientras la sección re-carga datos del proyecto. */
  loading?: boolean
}

function LogoBadge({ logoUrl, nombre }: { logoUrl: string | null; nombre: string }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--at-line)' }}
      />
    )
  }
  // Fallback: inicial del condominio sobre el color de marca.
  return (
    <div
      aria-hidden="true"
      style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: 'var(--at-primary-soft)', color: 'var(--at-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 800,
      }}
    >
      {nombre.trim().charAt(0).toUpperCase() || '🏢'}
    </div>
  )
}

export function CondominioContextBar({ loading = false }: Props) {
  const { proyectosActivos, activeProjectId, activeProyecto, setActiveProjectId } = useActiveCondominio()
  const multi = proyectosActivos.length > 1

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      {/* Banner de contexto activo (cond:B6) */}
      <div
        data-testid="condominio-banner"
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '6px 12px', borderRadius: '10px',
          background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
        }}
      >
        <LogoBadge logoUrl={activeProyecto?.logo_url ?? null} nombre={activeProyecto?.nombre ?? ''} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--at-ink-3)', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', lineHeight: 1.2 }}>
            Condominio activo
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--at-ink)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
            {activeProyecto?.nombre ?? '—'}
          </span>
        </div>
      </div>

      {/* Switcher (cond:B5) — solo cuando hay >1 condominio activo accesible */}
      {multi && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)', fontWeight: 600 }}>Cambiar a</span>
          <select
            aria-label="Cambiar de condominio activo"
            value={activeProjectId}
            onChange={e => setActiveProjectId(e.target.value)}
            style={{
              padding: '6px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px',
              fontSize: '14px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {proyectosActivos.map(p => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </label>
      )}

      {loading && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Cargando…</span>}
    </div>
  )
}

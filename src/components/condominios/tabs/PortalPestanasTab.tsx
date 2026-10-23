import { useEffect, useMemo, useState } from 'react'
import { notify } from '../../shared/Dialog'
import { Button } from '../../shared/Button'
import { fetchPortalTabsOcultos, guardarPortalTabsOcultos } from '../../../domain/condominios/portalPestanas'
import {
  PORTAL_TABS, PORTAL_TABS_FIJOS, esTabSoloPropietario, normalizarTabsOcultos, tabsVisiblesPortal,
  type PortalTab, type PortalTabDef,
} from '../../../lib/portalTabs'

interface Props {
  proyectoId: string
  proyectoNombre?: string
  /** Sólo el propietario/administrador de la empresa (projects_update). */
  canEdit: boolean
}

// Config. portal (Residentes): qué pestañas ve el residente en el portal de
// ESTE condominio (projects.portal_tabs_ocultos, 20261106000000). La regla de
// visibilidad vive en lib/portalTabs y es la misma que aplica el portal: lo que
// se ve en la vista previa es lo que verá el residente.

const PARA_TODOS = PORTAL_TABS.filter(t => !esTabSoloPropietario(t.id))
const SOLO_PROPIETARIOS = PORTAL_TABS.filter(t => esTabSoloPropietario(t.id))

function mismoConjunto(a: readonly PortalTab[], b: readonly PortalTab[]): boolean {
  return a.length === b.length && a.every(x => b.includes(x))
}

export function PortalPestanasTab({ proyectoId, proyectoNombre, canEdit }: Props) {
  // `guardadas` es lo que hay en la base; `ocultas`, lo que se está editando.
  const [guardadas, setGuardadas] = useState<PortalTab[]>([])
  const [ocultas, setOcultas]     = useState<PortalTab[]>([])
  const [cargando, setCargando]   = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [intento, setIntento]     = useState(0)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!proyectoId) return
    let cancelado = false
    setCargando(true)
    setErrorCarga(null)
    void fetchPortalTabsOcultos(proyectoId).then(r => {
      if (cancelado) return
      setGuardadas(r.ocultos)
      setOcultas(r.ocultos)
      setErrorCarga(r.error)
      setCargando(false)
    })
    return () => { cancelado = true }
  }, [proyectoId, intento])

  const hayCambios = !mismoConjunto(guardadas, ocultas)
  const vistaPropietario = useMemo(() => tabsVisiblesPortal('propietario', ocultas), [ocultas])
  const vistaInquilino   = useMemo(() => tabsVisiblesPortal('arrendatario', ocultas), [ocultas])
  const editable = canEdit && !cargando && !errorCarga && !guardando

  function alternar(id: PortalTab) {
    setOcultas(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function guardar() {
    setGuardando(true)
    const { error } = await guardarPortalTabsOcultos(proyectoId, ocultas)
    setGuardando(false)
    if (error) { notify({ variant: 'error', title: 'No se guardó la configuración', text: error }); return }
    const normalizadas = normalizarTabsOcultos(ocultas)
    setGuardadas(normalizadas)
    setOcultas(normalizadas)
    notify({
      variant: 'success',
      title: 'Portal actualizado',
      text: 'Los residentes verán el cambio la próxima vez que abran o recarguen su portal.',
    })
  }

  if (!proyectoId) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--at-ink-3)', fontSize: 13 }}>
        Selecciona un condominio para configurar su portal.
      </div>
    )
  }

  const SECTION = { background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' as const }

  return (
    <div style={{ padding: 16 }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Pestañas del portal del residente</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
            Elige qué pestañas ven los residentes{proyectoNombre ? <> de <strong style={{ color: 'var(--at-ink-2)' }}>{proyectoNombre}</strong></> : null} en su portal.
            Apagar una pestaña la quita del menú del residente; no borra ningún dato.
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {hayCambios && (
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-warning)', background: 'var(--at-warning-tint)', borderRadius: 999, padding: '4px 10px' }}>
                Cambios sin guardar
              </span>
            )}
            {hayCambios && (
              <Button variant="secondary" size="sm" disabled={guardando} onClick={() => setOcultas(guardadas)}>
                Descartar
              </Button>
            )}
            <Button size="sm" disabled={!editable || !hayCambios} loading={guardando} loadingText="Guardando…" onClick={guardar}>
              Guardar cambios
            </Button>
          </div>
        )}
      </div>

      {!canEdit && (
        <div style={{ fontSize: 12.5, color: 'var(--at-ink-2)', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
          🔒 Sólo el propietario o el administrador de la empresa puede cambiar las pestañas del portal.
        </div>
      )}

      {errorCarga ? (
        <div style={{ ...SECTION, padding: 20, textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--at-ink)', marginBottom: 4 }}>No se pudo leer la configuración del portal</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 12 }}>{errorCarga}</div>
          <Button variant="secondary" size="sm" onClick={() => setIntento(n => n + 1)}>Reintentar</Button>
        </div>
      ) : cargando ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          {[0, 1].map(i => (
            <div key={i} style={{ ...SECTION, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[0, 1, 2, 3].map(j => <div key={j} className="condo-skeleton" style={{ height: 34 }} />)}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
            <div style={SECTION}>
              <GrupoTitulo titulo="Para todos los residentes" detalle="Propietarios, inquilinos y familiares." />
              {PARA_TODOS.map(def => (
                <FilaPestana key={def.id} def={def} fija={PORTAL_TABS_FIJOS.includes(def.id)}
                  encendida={!ocultas.includes(def.id)} disabled={!editable} onToggle={() => alternar(def.id)} />
              ))}
            </div>
            <div style={SECTION}>
              <GrupoTitulo titulo="Sólo propietarios" detalle="Los inquilinos y familiares no las ven aunque estén encendidas." />
              {SOLO_PROPIETARIOS.map(def => (
                <FilaPestana key={def.id} def={def} fija={false}
                  encendida={!ocultas.includes(def.id)} disabled={!editable} onToggle={() => alternar(def.id)} />
              ))}
            </div>
          </div>

          {/* Vista previa: la misma regla que aplica el portal */}
          <div style={{ ...SECTION, marginTop: 14, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 10 }}>Vista previa del menú del portal</div>
            <VistaPrevia rol="Propietario" tabs={vistaPropietario} />
            <VistaPrevia rol="Inquilino o familiar" tabs={vistaInquilino} />
          </div>
        </>
      )}
    </div>
  )
}

function GrupoTitulo({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)' }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)' }}>{titulo}</div>
      <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>{detalle}</div>
    </div>
  )
}

function FilaPestana({ def, encendida, fija, disabled, onToggle }: {
  def: PortalTabDef
  encendida: boolean
  fija: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: '1px solid var(--at-line)' }}>
      <span aria-hidden="true" style={{ fontSize: 20, width: 26, textAlign: 'center', flexShrink: 0, opacity: encendida ? 1 : 0.45 }}>{def.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, color: encendida ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>{def.label}</div>
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', lineHeight: 1.4 }}>{def.descripcion}</div>
      </div>
      {fija ? (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Siempre visible
        </span>
      ) : (
        <Switch checked={encendida} disabled={disabled} label={def.label} onToggle={onToggle} />
      )}
    </div>
  )
}

function VistaPrevia({ rol, tabs }: { rol: string; tabs: PortalTab[] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: 5 }}>
        {rol} · {tabs.length} {tabs.length === 1 ? 'pestaña' : 'pestañas'}
      </div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px', borderRadius: 10,
        background: 'linear-gradient(135deg, var(--at-accent-hover), var(--at-accent))',
      }}>
        {PORTAL_TABS.filter(t => tabs.includes(t.id)).map(t => (
          <span key={t.id} style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.92)', padding: '4px 8px', borderRadius: 7, background: 'rgba(255,255,255,0.12)', whiteSpace: 'nowrap' }}>
            {t.icon} {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// Mismo interruptor que las preferencias de notificación (NotificationPreferencesPanel).
function Switch({ checked, disabled, label, onToggle }: {
  checked: boolean
  disabled: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}: ${checked ? 'visible en el portal' : 'oculta en el portal'}`}
      disabled={disabled}
      onClick={onToggle}
      style={{
        position: 'relative', width: '44px', height: '26px', flexShrink: 0,
        borderRadius: '999px', border: 'none', padding: 0,
        background: checked ? 'var(--at-primary)' : 'var(--at-line-strong)',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s ease',
      }}
    >
      <span
        style={{
          position: 'absolute', top: '3px', left: checked ? '21px' : '3px',
          width: '20px', height: '20px', borderRadius: '50%',
          background: 'white', transition: 'left 0.15s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  )
}

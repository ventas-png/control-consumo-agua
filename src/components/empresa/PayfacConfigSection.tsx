// Cobros pluggable — UI "elige tu payfac y solo conecta". Gemela de
// FiscalConfigSection (FEL), pero para el PROCESADOR DE PAGOS (payfac).
//
// Flujo: elige ÁMBITO (empresa o locación) → ve la config EFECTIVA (payfac +
// moneda, heredado vs propio) → elige payfac del catálogo → conecta credenciales
// (sandbox/prod) vía edge (la bóveda es deny-all; NUNCA se muestran las guardadas,
// solo flags) → "Probar conexión" → badge estado_conexion.
//
// Hoy hay adapter REAL de QPayPro (Guatemala) y Sandbox; Visanet/PayPal son
// elegibles pero su cobro es follow-up; Stripe se configura en su pantalla
// dedicada. Gating admin/owner igual que StripePayPalConfig.
import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notify } from '../shared/Dialog'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../../domain/queryFetch'
import type { PayfacEstatus } from '../../types/pagos'
import { useConfigPagoEfectivaQuery, useEstatusPayfacQuery } from '../../domain/cobros/queries'
import {
  useGuardarConfigPagoMutation,
  useGuardarCredencialesPayfacMutation,
  useProbarConexionPayfacMutation,
  type AmbitoPago,
} from '../../domain/cobros/mutations'
import {
  payfacsDisponibles,
  payfacPorValue,
  etiquetaPayfac,
  camposCredencial,
  estadoConexionStyle,
} from '../../lib/payfacCatalogo'

interface Props {
  /** Locaciones del tenant para el override por proyecto. Vacío = solo empresa. */
  proyectos?: Array<{ id: string; nombre: string }>
}

function EstadoConexionBadge({ estado }: { estado?: string | null }) {
  const s = estadoConexionStyle(estado)
  return (
    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.icon} {s.label}
    </span>
  )
}

export function PayfacConfigSection({ proyectos = [] }: Props) {
  const currentUser = useSession()
  const perms = usePermissionsContext()
  const companyId = currentUser.company_id
  const canEdit = perms.canEdit('empresa') && currentUser.role !== 'viewer'

  // ── Selector de ámbito: '' = empresa; otro = projects.id ──
  const [ambitoProjectId, setAmbitoProjectId] = useState('')
  const esEmpresa = ambitoProjectId === ''
  const ambito: AmbitoPago = esEmpresa
    ? { tipo: 'empresa' }
    : { tipo: 'locacion', projectId: ambitoProjectId }

  const { data: config, isLoading: configLoading } = useConfigPagoEfectivaQuery(
    companyId,
    esEmpresa ? undefined : ambitoProjectId,
  )

  // Override CRUDO de la locación (projects.proveedor_pago) para distinguir
  // "hereda" (NULL) de "propio" (con valor). A nivel empresa no aplica.
  const { data: rawOverride } = useQuery<{ proveedorPago: string | null } | null>({
    queryKey: ['payfac', 'project-override-crudo', ambitoProjectId],
    enabled: !esEmpresa && !!ambitoProjectId,
    queryFn: async () => {
      const rows = await runQuery<Array<{ proveedor_pago: string | null }>>((signal) =>
        supabase.from('projects').select('proveedor_pago').eq('id', ambitoProjectId).limit(1).abortSignal(signal),
      )
      const p = rows?.[0]
      return p ? { proveedorPago: p.proveedor_pago ?? null } : null
    },
  })

  const { data: estatusList = [] } = useEstatusPayfacQuery(companyId)
  const estatus: PayfacEstatus | undefined = useMemo(
    () => estatusList.find((e) => (esEmpresa ? e.project_id === null : e.project_id === ambitoProjectId)),
    [estatusList, esEmpresa, ambitoProjectId],
  )

  const guardarConfig = useGuardarConfigPagoMutation(companyId)
  const guardarCreds = useGuardarCredencialesPayfacMutation(companyId)
  const probarConexion = useProbarConexionPayfacMutation(companyId)

  // ── Payfac elegido en el form ──
  // EMPRESA: se siembra del efectivo (= valor propio). LOCACIÓN: del override
  // crudo ('' = hereda); el efectivo se muestra como pista.
  const [proveedorForm, setProveedorForm] = useState('')
  useEffect(() => {
    if (esEmpresa) {
      setProveedorForm(config?.proveedorPago ?? 'sandbox')
    } else {
      setProveedorForm(rawOverride?.proveedorPago ?? '')
    }
  }, [config, rawOverride, esEmpresa, ambitoProjectId])

  // Payfac efectivo del control (en locación sin override, refleja el heredado).
  const proveedorEfectivo = proveedorForm.trim() !== '' ? proveedorForm : config?.proveedorPago ?? 'sandbox'
  const opcion = payfacPorValue(proveedorEfectivo)
  const campos = camposCredencial(proveedorEfectivo)

  // ── Credenciales por ambiente (se ESCRIBEN, nunca se muestran) ──
  const [sandboxCreds, setSandboxCreds] = useState<Record<string, string>>({})
  const [prodCreds, setProdCreds] = useState<Record<string, string>>({})
  useEffect(() => {
    setSandboxCreds({})
    setProdCreds({})
  }, [ambitoProjectId, proveedorEfectivo])

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const card: CSSProperties = { background: 'var(--at-surface)', borderRadius: 14, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }
  const h3: CSSProperties = { margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--at-ink)' }
  const sub: CSSProperties = { margin: '0 0 14px', fontSize: 13, color: 'var(--at-ink-3)' }

  const btnPrimary = (disabled: boolean): CSSProperties => ({
    padding: '9px 20px', borderRadius: 8, border: 'none',
    background: disabled ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
    color: 'white', fontWeight: 600, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
  })

  /** Junta los campos no vacíos de un ambiente en el objeto de credenciales. */
  function credsNoVacias(valores: Record<string, string>): Record<string, string> | undefined {
    const out: Record<string, string> = {}
    for (const c of campos) {
      const v = (valores[c.key] ?? '').trim()
      if (v) out[c.key] = v
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  async function onGuardarPayfac() {
    if (!canEdit) return
    try {
      await guardarConfig.mutateAsync({ ambito, proveedorPago: proveedorForm })
      notify({ variant: 'success', title: 'Payfac guardado', duration: 1600 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function onGuardarCredenciales() {
    if (!canEdit) return
    const sandbox = credsNoVacias(sandboxCreds)
    const prod = credsNoVacias(prodCreds)
    if (!sandbox && !prod) {
      notify({ variant: 'warning', title: 'Sin credenciales', text: 'Completa al menos un ambiente (sandbox o producción).' })
      return
    }
    try {
      await guardarCreds.mutateAsync({
        projectId: esEmpresa ? null : ambitoProjectId,
        proveedor: proveedorEfectivo,
        credenciales: { sandbox, prod },
      })
      setSandboxCreds({})
      setProdCreds({})
      notify({ variant: 'success', title: 'Credenciales guardadas', text: 'Se guardaron de forma segura. Prueba la conexión para verificarlas.', duration: 2200 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function onProbarConexion(ambiente: 'sandbox' | 'prod') {
    try {
      const res = await probarConexion.mutateAsync({ projectId: esEmpresa ? null : ambitoProjectId, ambiente })
      if (res.ok) {
        notify({ variant: 'success', title: 'Conexión OK', text: res.mensaje ?? 'El payfac respondió correctamente.', duration: 2200 })
      } else {
        notify({ variant: 'warning', title: 'No se pudo conectar', text: res.mensaje ?? res.error ?? 'El payfac respondió un error.' })
      }
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  const guardandoPayfac = guardarConfig.isPending
  const guardandoCreds = guardarCreds.isPending
  const probando = probarConexion.isPending

  // ── Render de los campos de credenciales de un ambiente ──
  function CamposAmbiente({ titulo, icono, valores, setValores }: {
    titulo: string; icono: string; valores: Record<string, string>; setValores: (v: Record<string, string>) => void
  }) {
    if (campos.length === 0) {
      return (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 14, fontSize: 12, color: 'var(--at-ink-3)' }}>
          {icono} <strong>{titulo}</strong> — {opcion?.value === 'sandbox' ? 'No requiere credenciales (cobro simulado).' : 'Este payfac se conecta en su propia pantalla.'}
        </div>
      )
    }
    return (
      <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{icono} {titulo}</div>
        {campos.map((c) => (
          <div key={c.key} style={{ marginBottom: 8 }}>
            <label style={lbl}>{c.label}{c.requerido ? ' *' : ''}</label>
            <input
              type={c.secreto === false ? 'text' : 'password'}
              style={inp}
              value={valores[c.key] ?? ''}
              autoComplete="off"
              placeholder={c.placeholder ?? '••• nuevo valor'}
              onChange={(e) => setValores({ ...valores, [c.key]: e.target.value })}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Aviso de estado de integración ── */}
      <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'var(--at-warning-strong)' }}>
        <strong>💳 Elige tu procesador de pagos (payfac).</strong> Igual que el certificador fiscal, cada empresa
        (y cada locación) puede irse con el payfac de su elección y solo conectar credenciales. Hoy está integrado{' '}
        <strong>QPayPro (Guatemala)</strong> y el <strong>Sandbox</strong> de pruebas; Visanet y PayPal son elegibles
        y su cobro se habilita al completar su <em>adapter</em>. <strong>Stripe</strong> se configura en su pantalla dedicada.
      </div>

      {/* ── Selector de ÁMBITO ── */}
      <section style={card}>
        <h3 style={h3}>Ámbito de la configuración de cobros</h3>
        <p style={sub}>
          Configura el payfac a nivel <strong>empresa</strong> (aplica a todas las locaciones) o por <strong>locación</strong> (sobrescribe solo en esa locación).
        </p>
        <div style={{ width: 360, maxWidth: '100%' }}>
          <label style={lbl}>Configurar para</label>
          <select style={inp} value={ambitoProjectId} onChange={(e) => setAmbitoProjectId(e.target.value)}>
            <option value="">🏢 Empresa (config base)</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>📍 Locación: {p.nombre}</option>
            ))}
          </select>
        </div>
        {!esEmpresa && config && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--at-ink-3)' }}>
            {config.desdeLocacion
              ? 'Esta locación cobra con un payfac propio que sobrescribe al de la empresa.'
              : 'Esta locación hereda el payfac de la empresa. Elige uno distinto para sobrescribirlo solo aquí.'}
          </p>
        )}
      </section>

      {/* ── Selector de payfac ── */}
      <section style={card}>
        <h3 style={h3}>Procesador de pagos (payfac)</h3>
        <p style={sub}>
          {esEmpresa ? 'Este payfac es la base de la empresa.' : 'Déjalo en “Heredar de la empresa” para usar el de la empresa, o elige uno propio.'}
        </p>
        {configLoading ? (
          <div style={{ color: 'var(--at-ink-3)', fontSize: 13, padding: '12px 0' }}>Cargando configuración…</div>
        ) : (
          <>
            <div style={{ width: 420, maxWidth: '100%' }}>
              <label style={lbl}>Payfac{!esEmpresa && config ? ` (efectivo: ${etiquetaPayfac(config.proveedorPago)})` : ''}</label>
              <select style={inp} value={proveedorForm} disabled={!canEdit} onChange={(e) => setProveedorForm(e.target.value)}>
                {!esEmpresa && <option value="">↳ Heredar de la empresa</option>}
                {payfacsDisponibles().map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}{o.disponible ? '' : ' (próximamente)'}
                  </option>
                ))}
              </select>
            </div>
            {opcion?.nota && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--at-ink-3)' }}>{opcion.nota}</p>
            )}
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--at-ink-3)' }}>
              Moneda de cobro: <strong style={{ color: 'var(--at-ink)' }}>{config?.moneda ?? 'GTQ'}</strong> (de la empresa)
            </p>
            {canEdit && (
              <div style={{ marginTop: 16 }}>
                <button onClick={() => void onGuardarPayfac()} disabled={guardandoPayfac} style={btnPrimary(guardandoPayfac)}>
                  {guardandoPayfac ? 'Guardando…' : 'Guardar payfac'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Credenciales del payfac + Probar conexión ── */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <h3 style={{ ...h3, margin: 0 }}>Credenciales de {etiquetaPayfac(proveedorEfectivo)}</h3>
          <EstadoConexionBadge estado={estatus?.estado_conexion} />
        </div>
        <p style={sub}>
          Las credenciales se guardan de forma segura (solo accesibles por el servidor): <strong>nunca se muestran de vuelta</strong>.
          Escribe valores nuevos solo si quieres reemplazar los actuales.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
          <span>Payfac actual: <strong style={{ color: 'var(--at-ink)' }}>{etiquetaPayfac(estatus?.proveedor ?? proveedorEfectivo)}</strong></span>
          <span>Sandbox: <strong style={{ color: estatus?.tiene_sandbox ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>{estatus?.tiene_sandbox ? 'configurado ✓' : 'sin configurar'}</strong></span>
          <span>Producción: <strong style={{ color: estatus?.tiene_prod ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>{estatus?.tiene_prod ? 'configurado ✓' : 'sin configurar'}</strong></span>
          {estatus?.estado_mensaje && <span title={estatus.estado_mensaje} style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Último ping: {estatus.estado_mensaje}</span>}
        </div>

        {canEdit && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <CamposAmbiente titulo="Sandbox (pruebas)" icono="🧪" valores={sandboxCreds} setValores={setSandboxCreds} />
            <CamposAmbiente titulo="Producción" icono="🚀" valores={prodCreds} setValores={setProdCreds} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          {canEdit && campos.length > 0 && (
            <button onClick={() => void onGuardarCredenciales()} disabled={guardandoCreds} style={btnPrimary(guardandoCreds)}>
              {guardandoCreds ? 'Guardando…' : 'Guardar credenciales'}
            </button>
          )}
          <button onClick={() => void onProbarConexion('sandbox')} disabled={probando}
            style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--at-primary)', background: 'transparent', color: 'var(--at-primary)', fontWeight: 600, fontSize: 14, cursor: probando ? 'not-allowed' : 'pointer' }}>
            {probando ? 'Probando…' : '🔌 Probar conexión (sandbox)'}
          </button>
        </div>
      </section>
    </div>
  )
}

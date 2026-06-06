// serv:S11 — UI fiscal "selecciona tu PAC y solo conecta" (parte 2). Vive bajo
// `tarifas/` y se anida en FacturacionConfigSection (sub-tab de TarifasSection).
//
// Flujo: elige ÁMBITO (empresa o locación) → ve la config EFECTIVA con qué campos
// heredan vs override → elige PAC por régimen → edita datos del emisor → carga
// credenciales (sandbox/prod) vía edge (la bóveda es deny-all; NUNCA se muestran
// las ya guardadas, solo flags) → "Probar conexión" → badge estado_conexion.
//
// El timbrado REAL espera el adapter del PAC: hoy todo corre contra el Sandbox
// (mensaje claro en la UI). Gating admin/owner igual que el resto de tarifas.
import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notify } from '../shared/Dialog'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import type { Proyecto } from '../../types/plataforma'
import type {
  ConfigFiscalLocacion,
  EstatusCredencialesPac,
  RegimenFiscalConfig,
} from '../../types/fiscal'
import {
  useConfigFiscalEfectivaQuery,
  useEstatusCredencialesPacQuery,
  fetchProjectFiscalOverride,
} from '../../domain/fiscal/queries'
import {
  useGuardarConfigFiscalLocacionMutation,
  useGuardarCredencialesPacMutation,
  useProbarConexionPacMutation,
  type AmbitoFiscal,
  type ConfigFiscalEmisorInput,
} from '../../domain/fiscal/mutations'
import {
  REGIMEN_OPCIONES,
  pacsParaRegimen,
  etiquetaPac,
  origenCampos,
  mostrarHerencia,
  estadoConexionStyle,
  regimenDeConfig,
  type CampoFiscal,
} from './pacCatalogo'

interface Props {
  proyectos: Proyecto[]
}

// ── Chip "Heredado (empresa)" / "Propio (locación)" ────────────────────────────
function HerenciaChip({ origen }: { origen: 'heredado' | 'locacion' }) {
  const heredado = origen === 'heredado'
  return (
    <span
      style={{
        padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700,
        background: heredado ? 'var(--at-chip)' : 'var(--at-primary-tint)',
        color: heredado ? 'var(--at-ink-3)' : 'var(--at-primary-hover)',
        whiteSpace: 'nowrap',
      }}
    >
      {heredado ? '↳ Hereda de empresa' : '◆ Propio de locación'}
    </span>
  )
}

function EstadoConexionBadge({ estado }: { estado?: string | null }) {
  const s = estadoConexionStyle(estado)
  return (
    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.icon} {s.label}
    </span>
  )
}

export function FiscalConfigSection({ proyectos }: Props) {
  const currentUser = useSession()
  const perms = usePermissionsContext()
  const companyId = currentUser.company_id
  // Mismo gating que TarifasSection / FacturacionConfigSection.
  const canEdit = perms.canEdit('tarifas') && currentUser.role !== 'viewer'

  // ── Selector de ámbito: empresa (default) o una locación (project) ──
  // '' = empresa; cualquier otro valor = projects.id.
  const [ambitoProjectId, setAmbitoProjectId] = useState('')
  const esEmpresa = ambitoProjectId === ''
  const ambito: AmbitoFiscal = esEmpresa
    ? { tipo: 'empresa' }
    : { tipo: 'locacion', projectId: ambitoProjectId }

  // Config EFECTIVA del ámbito elegido (resuelve override locación↔empresa).
  const { data: config, isLoading: configLoading } = useConfigFiscalEfectivaQuery(
    companyId,
    esEmpresa ? undefined : ambitoProjectId,
  )

  // Override CRUDO de la locación (columnas fiscales NO secretas de projects).
  // Necesario para distinguir "hereda" (columna NULL) de "override" (columna con
  // valor) en los chips — la config efectiva ya mezcló ambos niveles y no lo
  // permite. Lectura directa por RLS (admin/owner ya lee/escribe projects; sin
  // secretos aquí). A nivel empresa no aplica (no hay override que leer).
  const { data: rawOverride } = useQuery<ConfigFiscalLocacion | null>({
    queryKey: ['fiscal', 'project-override-crudo', ambitoProjectId],
    enabled: !esEmpresa && !!ambitoProjectId,
    queryFn: async () => {
      const p = await fetchProjectFiscalOverride(ambitoProjectId)
      if (!p) return null
      return {
        regimenFiscal: (p.regimen_fiscal as ConfigFiscalLocacion['regimenFiscal']) ?? null,
        nombre: p.nombre ?? null,
        nombreFiscal: p.nombre_fiscal ?? null,
        nit: p.nit ?? null,
        rfc: p.rfc ?? null,
        proveedorTimbrado: p.proveedor_timbrado ?? null,
        establecimiento: p.establecimiento ?? null,
        lugarExpedicion: p.lugar_expedicion ?? null,
        serieFiscal: p.serie_fiscal ?? null,
      }
    },
  })
  // Estatus (NO sensible) de credenciales del tenant: proveedor + estado_conexion
  // + flags tiene_sandbox/tiene_prod. NUNCA el secreto.
  const { data: estatusList = [] } = useEstatusCredencialesPacQuery(companyId)
  const estatus: EstatusCredencialesPac | undefined = useMemo(
    () =>
      estatusList.find((e) =>
        esEmpresa ? e.project_id === null : e.project_id === ambitoProjectId,
      ),
    [estatusList, esEmpresa, ambitoProjectId],
  )

  const guardarConfig = useGuardarConfigFiscalLocacionMutation(companyId)
  const guardarCreds = useGuardarCredencialesPacMutation(companyId)
  const probarConexion = useProbarConexionPacMutation(companyId)

  // ── Editor del emisor (form local) ──
  // EMPRESA: se siembra de la config efectiva (= los propios valores de la
  // empresa). LOCACIÓN: se siembra del OVERRIDE CRUDO (vacío = "hereda"), de modo
  // que un campo vacío NO pisa a la empresa y los chips reflejan herencia real;
  // el valor efectivo/heredado se muestra como placeholder.
  const [form, setForm] = useState<ConfigFiscalEmisorInput>({})
  useEffect(() => {
    if (esEmpresa) {
      if (!config) { setForm({}); return }
      setForm({
        regimenFiscal: config.regimenFiscal,
        nombreFiscal: config.nombreFiscal ?? '',
        nit: config.nit ?? '',
        rfc: config.rfc ?? '',
        proveedorTimbrado: config.proveedorTimbrado,
        // establecimiento/serie/lugar no existen a nivel empresa.
        establecimiento: '',
        lugarExpedicion: '',
        serieFiscal: '',
      })
      return
    }
    // Locación: form = override crudo (campos NULL → '' = hereda).
    setForm({
      regimenFiscal: rawOverride?.regimenFiscal ?? 'ninguno',
      nombreFiscal: rawOverride?.nombreFiscal ?? '',
      nit: rawOverride?.nit ?? '',
      rfc: rawOverride?.rfc ?? '',
      proveedorTimbrado: rawOverride?.proveedorTimbrado ?? '',
      establecimiento: rawOverride?.establecimiento ?? '',
      lugarExpedicion: rawOverride?.lugarExpedicion ?? '',
      serieFiscal: rawOverride?.serieFiscal ?? '',
    })
    // Reinicia el form cuando cambia el ámbito/los datos cargados.
  }, [config, rawOverride, esEmpresa, ambitoProjectId])

  // Régimen que aplica al editor: en locación, si no hay override, usa el efectivo
  // (lo heredado de la empresa) para decidir qué campos del emisor mostrar.
  const regimenForm: RegimenFiscalConfig =
    form.regimenFiscal && form.regimenFiscal !== 'ninguno'
      ? form.regimenFiscal
      : config?.regimenFiscal ?? 'ninguno'
  const regimenRealForm = regimenDeConfig({ regimenFiscal: regimenForm })
  const pacOpciones = pacsParaRegimen(regimenForm)
  // PAC seleccionado en el control: en locación sin override, refleja el efectivo
  // (heredado) para no mostrar 'sandbox' cuando la empresa ya eligió un PAC.
  const proveedorForm =
    form.proveedorTimbrado && form.proveedorTimbrado.trim() !== ''
      ? form.proveedorTimbrado
      : config?.proveedorTimbrado ?? 'sandbox'

  // Origen de cada campo (heredado vs override) para los chips, desde el FORM
  // (lo que el usuario edita): vacío → hereda; con valor → override de locación.
  const origenes = origenCampos(esEmpresa ? 'empresa' : 'locacion', {
    regimenFiscal: form.regimenFiscal === 'ninguno' ? null : form.regimenFiscal,
    nombreFiscal: form.nombreFiscal ?? null,
    nit: form.nit ?? null,
    rfc: form.rfc ?? null,
    proveedorTimbrado: form.proveedorTimbrado ?? null,
    establecimiento: form.establecimiento ?? null,
    lugarExpedicion: form.lugarExpedicion ?? null,
    serieFiscal: form.serieFiscal ?? null,
  })
  const verChips = mostrarHerencia(esEmpresa ? 'empresa' : 'locacion')
  // Valor efectivo (heredado) a mostrar como placeholder en una locación.
  const ph = (efectivo: string | null | undefined, fallback: string) =>
    !esEmpresa && efectivo ? `Hereda: ${efectivo}` : fallback

  // ── Credenciales (sandbox/prod): se ESCRIBEN, nunca se muestran ──
  const [sandboxUsuario, setSandboxUsuario] = useState('')
  const [sandboxClave, setSandboxClave] = useState('')
  const [prodUsuario, setProdUsuario] = useState('')
  const [prodClave, setProdClave] = useState('')
  // Al cambiar de ámbito, limpia los inputs de credenciales (no se precargan).
  useEffect(() => {
    setSandboxUsuario(''); setSandboxClave(''); setProdUsuario(''); setProdClave('')
  }, [ambitoProjectId])

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
  const card: CSSProperties = { background: 'var(--at-surface)', borderRadius: 14, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }
  const h3: CSSProperties = { margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--at-ink)' }
  const sub: CSSProperties = { margin: '0 0 14px', fontSize: 13, color: 'var(--at-ink-3)' }
  const fieldLbl = (campo: CampoFiscal, text: string) => (
    <label style={lbl}>
      {text}
      {verChips && <HerenciaChip origen={origenes[campo]} />}
    </label>
  )

  async function onGuardarEmisor() {
    if (!canEdit) return
    try {
      await guardarConfig.mutateAsync({ ambito, input: form })
      notify({ variant: 'success', title: 'Datos del emisor guardados', duration: 1600 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function onGuardarCredenciales() {
    if (!canEdit) return
    const sandbox =
      sandboxUsuario.trim() || sandboxClave.trim()
        ? { usuario: sandboxUsuario.trim(), clave: sandboxClave.trim() }
        : undefined
    const prod =
      prodUsuario.trim() || prodClave.trim()
        ? { usuario: prodUsuario.trim(), clave: prodClave.trim() }
        : undefined
    if (!sandbox && !prod) {
      notify({ variant: 'warning', title: 'Sin credenciales', text: 'Completa al menos un ambiente (sandbox o producción).' })
      return
    }
    try {
      await guardarCreds.mutateAsync({
        projectId: esEmpresa ? null : ambitoProjectId,
        proveedor: proveedorForm,
        credenciales: { sandbox, prod },
      })
      setSandboxUsuario(''); setSandboxClave(''); setProdUsuario(''); setProdClave('')
      notify({ variant: 'success', title: 'Credenciales guardadas', text: 'Se guardaron de forma segura. Prueba la conexión para verificarlas.', duration: 2200 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function onProbarConexion() {
    try {
      const res = await probarConexion.mutateAsync({
        projectId: esEmpresa ? null : ambitoProjectId,
        ambiente: 'sandbox',
      })
      if (res.ok) {
        notify({ variant: 'success', title: 'Conexión OK', text: res.mensaje ?? 'El proveedor respondió correctamente.', duration: 2200 })
      } else {
        notify({ variant: 'warning', title: 'No se pudo conectar', text: res.mensaje ?? res.error ?? 'El proveedor respondió un error.' })
      }
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  const guardandoEmisor = guardarConfig.isPending
  const guardandoCreds = guardarCreds.isPending
  const probando = probarConexion.isPending

  const btnPrimary = (disabled: boolean): CSSProperties => ({
    padding: '9px 20px', borderRadius: 8, border: 'none',
    background: disabled ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
    color: 'white', fontWeight: 600, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Aviso: hoy todo corre contra el Sandbox ── */}
      <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'var(--at-warning-strong)' }}>
        <strong>🧪 Modo de pruebas (Sandbox).</strong> Puedes elegir tu PAC, capturar los datos del emisor y conectar credenciales desde ya.
        El <strong>timbrado real</strong> con el certificador (FEL en Guatemala / CFDI en México) se habilita cuando se complete el <em>adapter</em> del PAC elegido;
        por ahora "Probar conexión" y el timbrado corren contra un proveedor de pruebas, sin enviar nada al SAT.
      </div>

      {/* ── Selector de ÁMBITO ── */}
      <section style={card}>
        <h3 style={h3}>Ámbito de la configuración fiscal</h3>
        <p style={sub}>
          Configura el emisor a nivel <strong>empresa</strong> (se aplica a todas las locaciones) o por <strong>locación</strong> (sobrescribe lo de la empresa solo en esa locación).
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
              ? 'Esta locación tiene configuración fiscal propia que sobrescribe a la empresa en los campos marcados.'
              : 'Esta locación hereda toda su configuración fiscal de la empresa. Rellena un campo para sobrescribirlo solo aquí.'}
          </p>
        )}
      </section>

      {/* ── Datos del emisor + selector de PAC ── */}
      <section style={card}>
        <h3 style={h3}>Datos del emisor y proveedor (PAC)</h3>
        <p style={sub}>
          El régimen define el motor de comprobante (FEL/CFDI) y la lista de PACs disponibles.
          {esEmpresa ? ' Estos valores son la base de la empresa.' : ' En una locación, los campos vacíos heredan de la empresa.'}
        </p>
        {configLoading ? (
          <div style={{ color: 'var(--at-ink-3)', fontSize: 13, padding: '12px 0' }}>Cargando configuración…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                {fieldLbl('regimenFiscal', 'Régimen fiscal')}
                <select
                  style={inp} value={regimenForm} disabled={!canEdit}
                  onChange={(e) => {
                    // Cambiar de régimen invalida el PAC anterior (otro país):
                    // resetea el proveedor a 'sandbox' (default seguro del nuevo
                    // régimen) para no arrastrar un PAC fuera de catálogo.
                    const nuevo = e.target.value as RegimenFiscalConfig
                    setForm((p) => ({ ...p, regimenFiscal: nuevo, proveedorTimbrado: 'sandbox' }))
                  }}
                >
                  {REGIMEN_OPCIONES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {regimenRealForm && (
                <div style={{ gridColumn: 'span 2' }}>
                  {fieldLbl('proveedorTimbrado', 'Proveedor de timbrado (PAC)')}
                  <select
                    style={inp} value={proveedorForm} disabled={!canEdit}
                    onChange={(e) => setForm((p) => ({ ...p, proveedorTimbrado: e.target.value }))}
                  >
                    {/* Si el proveedor guardado no está en la lista del régimen, lo añadimos para no perderlo. */}
                    {!pacOpciones.some((o) => o.value === proveedorForm) && (
                      <option value={proveedorForm}>{etiquetaPac(proveedorForm)}</option>
                    )}
                    {pacOpciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}

              <div style={{ gridColumn: 'span 2' }}>
                {fieldLbl('nombreFiscal', 'Nombre / razón social fiscal')}
                <input style={inp} value={form.nombreFiscal ?? ''} disabled={!canEdit}
                  onChange={(e) => setForm((p) => ({ ...p, nombreFiscal: e.target.value }))}
                  placeholder={ph(config?.nombreFiscal, 'Razón social del emisor')} />
              </div>

              {regimenRealForm === 'fel_gt' && (
                <>
                  <div>
                    {fieldLbl('nit', 'NIT del emisor (Guatemala)')}
                    <input style={inp} value={form.nit ?? ''} disabled={!canEdit}
                      onChange={(e) => setForm((p) => ({ ...p, nit: e.target.value }))}
                      placeholder={ph(config?.nit, 'Ej. 1234567-8')} />
                  </div>
                  <div>
                    {fieldLbl('establecimiento', 'Establecimiento (FEL)')}
                    <input style={inp} value={form.establecimiento ?? ''} disabled={!canEdit}
                      onChange={(e) => setForm((p) => ({ ...p, establecimiento: e.target.value }))}
                      placeholder="Código de establecimiento ante SAT" />
                  </div>
                </>
              )}

              {regimenRealForm === 'cfdi_mx' && (
                <>
                  <div>
                    {fieldLbl('rfc', 'RFC del emisor (México)')}
                    <input style={inp} value={form.rfc ?? ''} disabled={!canEdit}
                      onChange={(e) => setForm((p) => ({ ...p, rfc: e.target.value }))}
                      placeholder={ph(config?.rfc, 'Ej. AAA010101AAA')} />
                  </div>
                  <div>
                    {fieldLbl('lugarExpedicion', 'Lugar de expedición (CP)')}
                    <input style={inp} value={form.lugarExpedicion ?? ''} disabled={!canEdit}
                      onChange={(e) => setForm((p) => ({ ...p, lugarExpedicion: e.target.value }))}
                      placeholder={ph(config?.lugarExpedicion, 'Código postal del CSD/sucursal')} />
                  </div>
                  <div>
                    {fieldLbl('serieFiscal', 'Serie del folio (CFDI)')}
                    <input style={inp} value={form.serieFiscal ?? ''} disabled={!canEdit}
                      onChange={(e) => setForm((p) => ({ ...p, serieFiscal: e.target.value }))}
                      placeholder="Opcional" />
                  </div>
                </>
              )}
            </div>

            {canEdit && (
              <div style={{ marginTop: 16 }}>
                <button onClick={() => void onGuardarEmisor()} disabled={guardandoEmisor} style={btnPrimary(guardandoEmisor)}>
                  {guardandoEmisor ? 'Guardando…' : 'Guardar datos del emisor'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Credenciales del PAC + Probar conexión ── */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <h3 style={{ ...h3, margin: 0 }}>Credenciales del PAC</h3>
          <EstadoConexionBadge estado={estatus?.estado_conexion} />
        </div>
        <p style={sub}>
          Las credenciales se guardan de forma segura (cifradas, solo accesibles por el servidor): <strong>nunca se muestran de vuelta</strong>.
          Por seguridad, los campos siempre aparecen vacíos; escribe credenciales nuevas solo si quieres reemplazar las actuales.
        </p>

        {/* Estado de presencia (flags), sin revelar el secreto. */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
          <span>PAC actual: <strong style={{ color: 'var(--at-ink)' }}>{etiquetaPac(estatus?.proveedor ?? proveedorForm)}</strong></span>
          <span>Sandbox: <strong style={{ color: estatus?.tiene_sandbox ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>{estatus?.tiene_sandbox ? 'configurado ✓' : 'sin configurar'}</strong></span>
          <span>Producción: <strong style={{ color: estatus?.tiene_prod ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>{estatus?.tiene_prod ? 'configurado ✓' : 'sin configurar'}</strong></span>
          {estatus?.estado_mensaje && <span title={estatus.estado_mensaje} style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Último ping: {estatus.estado_mensaje}</span>}
        </div>

        {canEdit && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {/* Sandbox */}
            <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🧪 Sandbox (pruebas)</div>
              <label style={lbl}>Usuario / API key</label>
              <input style={{ ...inp, marginBottom: 8 }} value={sandboxUsuario} autoComplete="off"
                onChange={(e) => setSandboxUsuario(e.target.value)} placeholder="••• nuevo valor" />
              <label style={lbl}>Clave / token</label>
              <input type="password" style={inp} value={sandboxClave} autoComplete="new-password"
                onChange={(e) => setSandboxClave(e.target.value)} placeholder="••• nuevo valor" />
            </div>
            {/* Producción */}
            <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🚀 Producción</div>
              <label style={lbl}>Usuario / API key</label>
              <input style={{ ...inp, marginBottom: 8 }} value={prodUsuario} autoComplete="off"
                onChange={(e) => setProdUsuario(e.target.value)} placeholder="••• nuevo valor" />
              <label style={lbl}>Clave / token</label>
              <input type="password" style={inp} value={prodClave} autoComplete="new-password"
                onChange={(e) => setProdClave(e.target.value)} placeholder="••• nuevo valor" />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          {canEdit && (
            <button onClick={() => void onGuardarCredenciales()} disabled={guardandoCreds} style={btnPrimary(guardandoCreds)}>
              {guardandoCreds ? 'Guardando…' : 'Guardar credenciales'}
            </button>
          )}
          <button onClick={() => void onProbarConexion()} disabled={probando}
            style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--at-primary)', background: 'transparent', color: 'var(--at-primary)', fontWeight: 600, fontSize: 14, cursor: probando ? 'not-allowed' : 'pointer' }}>
            {probando ? 'Probando…' : '🔌 Probar conexión'}
          </button>
        </div>
      </section>
    </div>
  )
}

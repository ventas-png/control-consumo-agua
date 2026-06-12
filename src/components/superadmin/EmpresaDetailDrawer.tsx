import { useState, type ReactNode } from 'react'
import { EditModal } from '../shared/EditModal'
import { StatusBadge } from '../shared/StatusBadge'
import { notify, confirm } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import {
  updateEmpresaCampo,
  suspendEmpresa,
  reactivarEmpresa,
  deleteEmpresa,
} from '../../domain/superadmin/mutations'
import {
  useEmpresaUsuariosQuery,
  useEmpresaBillingQuery,
  type EmpresaSuperadminRow,
} from '../../domain/superadmin/queries'
import { ToggleSwitch } from './ToggleSwitch'
import { subscriptionBadge } from './EmpresasTable'
import {
  moduleBadgeLabel,
  planCodeLabel,
  formatUsdCents,
  purgeEligibleAt,
  isPurgeEligible,
  DELETE_GRACE_DAYS,
} from './empresaHelpers'

// ============================================================================
// EmpresaDetailDrawer — detalle y gestión de una empresa (superadmin).
// ============================================================================
// Concentra lo que antes vivía inline en cada card de SuperAdminSection:
// info + edición, suscripción con desglose (misma RPC que ve el tenant en
// Perfil), límites, servicios, usuarios, y la zona de peligro del ciclo de
// vida (suspender / reactivar / purga con período de gracia).

interface Props {
  empresa: EmpresaSuperadminRow
  onClose: () => void
  /** Invalida las queries del dominio (el padre refresca el listado). */
  onChanged: () => void
}

export function EmpresaDetailDrawer({ empresa, onClose, onChanged }: Props) {
  // Copia local para reflejar mutaciones al instante (el listado se refresca
  // vía onChanged → invalidate; al reabrir el drawer la fila llega fresca).
  const [emp, setEmp] = useState<EmpresaSuperadminRow>(empresa)
  const [maxProj, setMaxProj] = useState<string>(String(empresa.max_projects))
  const [maxUnits, setMaxUnits] = useState<string>(String(empresa.max_units))
  const [busy, setBusy] = useState(false)

  const { data: usuarios = [], isLoading: usuariosLoading } = useEmpresaUsuariosQuery(emp.id)
  const { data: billing } = useEmpresaBillingQuery(emp.id)

  const patch = (changes: Partial<EmpresaSuperadminRow>) => setEmp(prev => ({ ...prev, ...changes }))

  async function editarInfo() {
    const result = await openPromptDialog({
      title: 'Editar Empresa',
      fields: [
        { name: 'nombre', label: 'Nombre de la empresa', required: true, initialValue: emp.nombre, autoFocus: true },
        { name: 'nit', label: 'NIT', initialValue: emp.nit ?? '' },
        { name: 'email', label: 'Email de contacto', type: 'email', initialValue: emp.email ?? '' },
        { name: 'telefono', label: 'Teléfono', type: 'tel', initialValue: emp.telefono ?? '' },
      ],
      submitText: 'Guardar',
      validate: (data) => data.nombre?.trim() ? null : 'El nombre es obligatorio',
    })
    if (!result) return
    const values = {
      nombre: result.nombre.trim(),
      nit: result.nit?.trim() || null,
      email: result.email?.trim() || null,
      telefono: result.telefono?.trim() || null,
    }
    const { error } = await updateEmpresaCampo(emp.id, values)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la empresa.' })
    } else {
      notify({ variant: 'success', title: 'Actualizado', duration: 1200 })
      patch(values)
      onChanged()
    }
  }

  async function guardarLimites() {
    const proj = parseInt(maxProj, 10)
    const units = parseInt(maxUnits, 10)
    if (!proj || proj < 1 || !units || units < 1) {
      notify({ variant: 'warning', title: 'Valor inválido', text: 'Los límites mínimos son 1 proyecto y 1 unidad.' })
      return
    }
    if (units < emp.unit_count) {
      notify({
        variant: 'warning', title: 'Límite menor al uso actual',
        text: `Esta empresa ya tiene ${emp.unit_count} unidades creadas. El nuevo límite debe ser igual o mayor.`,
      })
      return
    }
    const { error } = await updateEmpresaCampo(emp.id, { max_projects: proj, max_units: units })
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudieron actualizar los límites.' })
    } else {
      notify({ variant: 'success', title: 'Límites actualizados', duration: 1200 })
      patch({ max_projects: proj, max_units: units })
      onChanged()
    }
  }

  async function toggleServicio(campo: 'servicio_agua' | 'servicio_condominios', nuevoValor: boolean) {
    const { error } = await updateEmpresaCampo(emp.id, { [campo]: nuevoValor })
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar el servicio.' })
    } else {
      patch({ [campo]: nuevoValor } as Partial<EmpresaSuperadminRow>)
      onChanged()
    }
  }

  async function suspender() {
    const result = await openPromptDialog({
      title: `Suspender "${emp.nombre}"`,
      description: 'Sus usuarios no podrán iniciar sesión ni registrar cambios hasta reactivarla. Los datos se conservan intactos.',
      fields: [
        { name: 'motivo', label: 'Motivo de la suspensión', control: 'textarea', rows: 3, helpText: 'Quedará registrado (ej. falta de pago, solicitud del cliente).' },
      ],
      submitText: 'Suspender',
    })
    if (!result) return
    setBusy(true)
    const { error } = await suspendEmpresa(emp.id, result.motivo?.trim() ?? '')
    setBusy(false)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo suspender la empresa.' })
    } else {
      notify({ variant: 'success', title: 'Empresa suspendida', duration: 1500 })
      patch({ activa: false, suspended_at: new Date().toISOString(), suspended_reason: result.motivo?.trim() || null })
      onChanged()
    }
  }

  async function reactivar() {
    const { isConfirmed } = await confirm({
      title: `¿Reactivar "${emp.nombre}"?`,
      text: 'Sus usuarios recuperan el acceso de inmediato.',
      confirmText: 'Reactivar',
    })
    if (!isConfirmed) return
    setBusy(true)
    const { error } = await reactivarEmpresa(emp.id)
    setBusy(false)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo reactivar la empresa.' })
    } else {
      notify({ variant: 'success', title: 'Empresa reactivada', duration: 1500 })
      patch({ activa: true, suspended_at: null, suspended_reason: null })
      onChanged()
    }
  }

  async function purgar() {
    const result = await openPromptDialog({
      title: 'Eliminar empresa definitivamente',
      description: `Se eliminarán ${emp.project_count} proyecto(s), ${emp.unit_count} unidad(es), ${emp.user_count} usuario(s) y TODO su historial (lecturas, pagos, contabilidad). Esta acción es irreversible. Escribe el nombre exacto de la empresa para confirmar.`,
      fields: [
        { name: 'confirmacion', label: `Escribe "${emp.nombre}"`, required: true, autoFocus: true },
      ],
      submitText: 'Eliminar definitivamente',
      validate: (data) => data.confirmacion === emp.nombre ? null : 'El nombre no coincide.',
    })
    if (!result) return
    setBusy(true)
    const { ok, error } = await deleteEmpresa(emp.id, result.confirmacion)
    setBusy(false)
    if (!ok) {
      notify({ variant: 'error', title: 'No se pudo eliminar', text: error ?? 'Error desconocido' })
    } else {
      notify({ variant: 'success', title: 'Empresa eliminada', text: `"${emp.nombre}" fue purgada definitivamente.`, duration: 2500 })
      onChanged()
      onClose()
    }
  }

  const badge = subscriptionBadge(emp.subscription_status)
  const eligibleAt = purgeEligibleAt(emp.suspended_at)
  const canPurge = !emp.activa && isPurgeEligible(emp.suspended_at)

  return (
    <EditModal
      title={emp.nombre}
      subtitle={
        <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge tone="neutral">{moduleBadgeLabel(emp.servicio_agua, emp.servicio_condominios)}</StatusBadge>
          {!emp.activa && <StatusBadge tone="danger" dot>Suspendida</StatusBadge>}
          {emp.nit && <span>NIT: {emp.nit}</span>}
        </span>
      }
      onClose={onClose}
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ── Información de contacto ── */}
        <Section
          title="Información"
          action={<button onClick={() => void editarInfo()} style={secondaryBtnStyle}>Editar</button>}
        >
          <InfoGrid items={[
            ['Email', emp.email ?? '—'],
            ['Teléfono', emp.telefono ?? '—'],
            ['NIT', emp.nit ?? '—'],
            ['Creada', emp.created_at ? new Date(emp.created_at).toLocaleDateString('es-GT') : '—'],
          ]} />
        </Section>

        {/* ── Suscripción y facturación ── */}
        <Section title="Suscripción y facturación">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            <span style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>{planCodeLabel(emp.plan_code)}</span>
          </div>
          {billing ? (
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
              <tbody>
                <BreakdownRow label="Activación base" value={formatUsdCents(billing.base_activation_cents)} />
                <BreakdownRow
                  label={`Unidades proyecto principal (${billing.primary_units_count})`}
                  value={formatUsdCents(billing.primary_units_subtotal)}
                />
                <BreakdownRow
                  label={`Proyectos adicionales (${billing.extra_projects_count})`}
                  value={formatUsdCents(billing.extra_projects_subtotal)}
                />
                <BreakdownRow
                  label={`Unidades proyectos adicionales (${billing.extra_units_count})`}
                  value={formatUsdCents(billing.extra_units_subtotal)}
                />
                <tr>
                  <td style={{ padding: '8px 0', fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>Total mensual</td>
                  <td style={{ padding: '8px 0', fontWeight: 700, textAlign: 'right', borderTop: '2px solid var(--at-line)', fontFamily: 'var(--at-font-mono)' }}>
                    {formatUsdCents(billing.total_cents)}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Cargando desglose…</div>
          )}
        </Section>

        {/* ── Límites del tenant ── */}
        <Section title="Límites">
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <LimitInput
              label={`Proyectos (en uso: ${emp.project_count})`}
              value={maxProj}
              onChange={setMaxProj}
            />
            <LimitInput
              label={`Unidades (en uso: ${emp.unit_count})`}
              value={maxUnits}
              onChange={setMaxUnits}
            />
            <button onClick={() => void guardarLimites()} style={primaryBtnStyle}>
              Guardar límites
            </button>
          </div>
        </Section>

        {/* ── Módulos contratados ── */}
        <Section title="Módulos">
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <ToggleSwitch
              checked={emp.servicio_agua}
              onChange={v => void toggleServicio('servicio_agua', v)}
              label="Control Agua"
              onLabelColor="var(--at-primary)"
            />
            <ToggleSwitch
              checked={emp.servicio_condominios}
              onChange={v => void toggleServicio('servicio_condominios', v)}
              label="Condominios"
              onColors={['var(--at-accent-light)', 'var(--at-accent-hover)']}
              onLabelColor="var(--at-accent)"
            />
          </div>
        </Section>

        {/* ── Usuarios ── */}
        <Section title={`Usuarios (${usuarios.length})`}>
          {usuariosLoading ? (
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Cargando…</div>
          ) : usuarios.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Sin usuarios registrados.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {usuarios.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                  <span style={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0 }}>{u.full_name ?? '(sin nombre)'}</span>
                  <StatusBadge tone="neutral">{u.role}</StatusBadge>
                  {!u.activo && <StatusBadge tone="warning">Inactivo</StatusBadge>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Zona de peligro: ciclo de vida ── */}
        <Section title="Zona de peligro" danger>
          {emp.activa ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                <strong>Suspender servicio.</strong> Bloquea el acceso de todos sus usuarios y las escrituras
                de datos. Los datos se conservan y puede reactivarse en cualquier momento.
              </div>
              <button onClick={() => void suspender()} disabled={busy} style={warningBtnStyle}>
                Suspender empresa
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 280px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                  Suspendida {emp.suspended_at ? `desde ${new Date(emp.suspended_at).toLocaleDateString('es-GT')}` : ''}.
                  {emp.suspended_reason && <> Motivo: “{emp.suspended_reason}”.</>}
                </div>
                <button onClick={() => void reactivar()} disabled={busy} style={primaryBtnStyle}>
                  Reactivar empresa
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', borderTop: '1px solid var(--at-line)', paddingTop: '14px' }}>
                <div style={{ flex: '1 1 280px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                  <strong>Eliminar definitivamente.</strong> Purga todos los datos (irreversible).
                  {!canPurge && eligibleAt && (
                    <> Disponible a partir del <strong>{eligibleAt.toLocaleDateString('es-GT')}</strong> ({DELETE_GRACE_DAYS} días de gracia desde la suspensión).</>
                  )}
                </div>
                <button
                  onClick={() => void purgar()}
                  disabled={busy || !canPurge}
                  title={canPurge ? undefined : `Requiere ${DELETE_GRACE_DAYS} días de suspensión previa`}
                  style={{ ...dangerBtnStyle, opacity: canPurge ? 1 : 0.5, cursor: canPurge ? 'pointer' : 'not-allowed' }}
                >
                  Eliminar empresa
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>
    </EditModal>
  )
}

// ── Piezas locales ──────────────────────────────────────────────────────────

function Section({ title, action, danger = false, children }: {
  title: string
  action?: ReactNode
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section style={{
      border: `1px solid ${danger ? 'var(--at-danger)' : 'var(--at-line)'}`,
      borderRadius: '12px', padding: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{
          margin: 0, fontSize: '12px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: danger ? 'var(--at-danger)' : 'var(--at-ink-3)',
        }}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
      {items.map(([label, value]) => (
        <div key={label}>
          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
          <div style={{ fontSize: '13px', color: 'var(--at-ink)', marginTop: '2px', overflowWrap: 'anywhere' }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '5px 0', color: 'var(--at-ink-2)' }}>{label}</td>
      <td style={{ padding: '5px 0', textAlign: 'right', fontFamily: 'var(--at-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{value}</td>
    </tr>
  )
}

function LimitInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '110px', padding: '7px 9px', borderRadius: '8px',
          border: '1px solid var(--at-line)', fontSize: '13px', textAlign: 'center',
        }}
      />
    </label>
  )
}

const primaryBtnStyle = {
  padding: '8px 16px', borderRadius: '8px', border: 'none',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
  color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
} as const

const secondaryBtnStyle = {
  padding: '6px 14px', borderRadius: '8px',
  border: '1px solid var(--at-line)', background: 'var(--at-surface)',
  color: 'var(--at-ink-2)', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
} as const

const warningBtnStyle = {
  padding: '8px 16px', borderRadius: '8px',
  border: '1px solid var(--at-warning)', background: 'transparent',
  color: 'var(--at-warning)', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
} as const

const dangerBtnStyle = {
  padding: '8px 16px', borderRadius: '8px',
  border: '1px solid var(--at-danger)', background: 'transparent',
  color: 'var(--at-danger)', fontSize: '13px', fontWeight: 600,
} as const

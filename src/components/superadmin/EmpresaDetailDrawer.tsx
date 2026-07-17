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
  exportEmpresaData,
} from '../../domain/superadmin/mutations'
import {
  useEmpresaUsuariosQuery,
  useEmpresaBillingQuery,
  useEmpresaMonedaQuery,
  useEmpresaComisionQuery,
  useEmpresaComisionResumenQuery,
  useEmpresaTimbradoQuery,
  useEmpresaTimbresResumenQuery,
  type EmpresaSuperadminRow,
} from '../../domain/superadmin/queries'
import { guardarComisionConfig, guardarTimbradoConfig } from '../../domain/superadmin/mutations'
import { superadminKeys } from '../../domain/superadmin/keys'
import { useQueryClient } from '@tanstack/react-query'
import { MONEDAS_ISO, monedaLabel } from '../../lib/monedas'
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
  const { data: moneda } = useEmpresaMonedaQuery(emp.id)
  // F7: comisión transaccional de la plataforma (config + acumulado mensual).
  const { data: comisionRows = [] } = useEmpresaComisionQuery(emp.id)
  const { data: comisionResumen = [] } = useEmpresaComisionResumenQuery(emp.id)
  // F8: modelo de cobro del timbrado fiscal (config + contador mensual).
  const { data: timbrado } = useEmpresaTimbradoQuery(emp.id)
  const { data: timbresResumen = [] } = useEmpresaTimbresResumenQuery(emp.id)
  const qc = useQueryClient()

  const patch = (changes: Partial<EmpresaSuperadminRow>) => setEmp(prev => ({ ...prev, ...changes }))

  async function editarInfo() {
    const result = await openPromptDialog({
      title: 'Editar Empresa',
      fields: [
        { name: 'nombre', label: 'Nombre de la empresa', required: true, initialValue: emp.nombre, autoFocus: true },
        { name: 'nit', label: 'NIT', initialValue: emp.nit ?? '' },
        { name: 'email', label: 'Email de contacto', type: 'email', initialValue: emp.email ?? '' },
        { name: 'telefono', label: 'Teléfono', type: 'tel', initialValue: emp.telefono ?? '' },
        {
          name: 'moneda',
          label: 'Moneda de cobro',
          control: 'select',
          options: MONEDAS_ISO.map(m => ({ value: m.code, label: m.label })),
          initialValue: moneda ?? 'usd',
          helpText: 'Cobros del tenant y moneda base contable. Cambiarla no reconvierte montos históricos.',
        },
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
      default_currency: result.moneda,
    }
    const { error } = await updateEmpresaCampo(emp.id, values)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la empresa.' })
    } else {
      notify({ variant: 'success', title: 'Actualizado', duration: 1200 })
      patch({ nombre: values.nombre, nit: values.nit, email: values.email, telefono: values.telefono })
      onChanged()
    }
  }

  // F7: configurar la comisión transaccional de un canal. Dos pasos (igual que
  // el cierre automático): elegir canal → editar valores prefijados con la fila
  // vigente. pct se captura en % y se guarda como fracción.
  async function configurarComision() {
    const paso1 = await openPromptDialog({
      title: '💸 Comisión transaccional',
      description:
        'Comisión de la plataforma sobre cada pago en línea del tenant (solo pagos de ambiente prod). '
        + 'Se sella al crear cada cobro: cambiarla no afecta pagos ya creados. '
        + 'La fila «Todos los canales» aplica a cualquier proveedor sin fila propia.',
      fields: [
        {
          name: 'canal', label: 'Canal', control: 'select', autoFocus: true,
          initialValue: 'default',
          options: CANALES_COMISION.map(c => ({ value: c.value, label: c.label })),
        },
      ],
      submitText: 'Continuar',
    })
    const canal = paso1?.canal
    if (!canal) return
    const actual = comisionRows.find(c => c.canal === canal)
    const datos = await openPromptDialog({
      title: `💸 Comisión — ${canalComisionLabel(canal)}`,
      description: actual
        ? `Config vigente: ${(actual.pct * 100).toFixed(2)}% + ${actual.fijo.toFixed(2)} fijo${actual.activo ? '' : ' (inactiva)'}.`
        : 'Este canal aún no tiene comisión configurada.',
      fields: [
        {
          name: 'pct', label: 'Porcentaje del monto (%)', type: 'number',
          initialValue: actual ? String(actual.pct * 100) : '0',
          helpText: 'Ej. 2.5 = 2.5% de cada pago. Máximo 20.',
        },
        {
          name: 'fijo', label: 'Monto fijo por pago', type: 'number',
          initialValue: actual ? String(actual.fijo) : '0',
          helpText: 'En la moneda de cobro del tenant. 0 = sin componente fijo.',
        },
        {
          name: 'activo', label: 'Comisión activa', control: 'checkbox',
          initialValue: actual == null || actual.activo ? 'true' : '',
        },
      ],
      submitText: 'Guardar',
      validate: (d) => {
        const pct = Number(d.pct)
        const fijo = Number(d.fijo)
        if (!Number.isFinite(pct) || pct < 0 || pct > 20) return 'El porcentaje debe estar entre 0 y 20.'
        if (!Number.isFinite(fijo) || fijo < 0) return 'El monto fijo no puede ser negativo.'
        return null
      },
    })
    if (!datos) return
    const { error } = await guardarComisionConfig(emp.id, canal, {
      activo: datos.activo === 'true',
      pct: Number(datos.pct) / 100,
      fijo: Number(datos.fijo),
    })
    if (error) {
      notify({ variant: 'error', title: 'No se pudo guardar la comisión', text: error })
      return
    }
    notify({ variant: 'success', title: '💸 Comisión guardada', duration: 1400 })
    void qc.invalidateQueries({ queryKey: superadminKeys.empresaComision(emp.id) })
    void qc.invalidateQueries({ queryKey: superadminKeys.empresaComisionResumen(emp.id) })
  }

  // F8: configurar el modelo de cobro del timbrado (precio por DTE + cuota
  // incluida). El costo se sella POR DTE al certificar: cambiar la config no
  // toca timbres ya sellados.
  async function configurarTimbrado() {
    const datos = await openPromptDialog({
      title: '🧾 Cobro del timbrado (DTE)',
      description:
        (timbrado
          ? `Vigente: $${(timbrado.precio_dte_cents / 100).toFixed(2)} por DTE, ${timbrado.timbres_incluidos} incluido${timbrado.timbres_incluidos !== 1 ? 's' : ''}/mes${timbrado.activo ? '' : ' (inactivo)'}. `
          : 'Esta empresa aún no tiene modelo de cobro de timbrado. ')
        + 'El costo se sella por DTE al certificar; los primeros N del mes calendario salen sin costo.',
      fields: [
        {
          name: 'precio', label: 'Precio por DTE (USD)', type: 'number', autoFocus: true,
          initialValue: timbrado ? String(timbrado.precio_dte_cents / 100) : '0',
          helpText: 'Ej. 0.50 = 50¢ por DTE timbrado. 0 = sin costo.',
        },
        {
          name: 'incluidos', label: 'DTEs incluidos por mes', type: 'number',
          initialValue: String(timbrado?.timbres_incluidos ?? 0),
          helpText: '0 = todos los DTEs se cobran al precio configurado.',
        },
        {
          name: 'activo', label: 'Modelo de cobro activo', control: 'checkbox',
          initialValue: timbrado == null || timbrado.activo ? 'true' : '',
        },
      ],
      submitText: 'Guardar',
      validate: (d) => {
        const precio = Number(d.precio)
        const incluidos = Number(d.incluidos)
        if (!Number.isFinite(precio) || precio < 0) return 'El precio no puede ser negativo.'
        if (!Number.isInteger(incluidos) || incluidos < 0) return 'Los DTEs incluidos deben ser un entero ≥ 0.'
        return null
      },
    })
    if (!datos) return
    const { error } = await guardarTimbradoConfig(emp.id, {
      activo: datos.activo === 'true',
      precio_dte_cents: Math.round(Number(datos.precio) * 100),
      timbres_incluidos: Number(datos.incluidos),
    })
    if (error) {
      notify({ variant: 'error', title: 'No se pudo guardar el modelo de cobro', text: error })
      return
    }
    notify({ variant: 'success', title: '🧾 Modelo de cobro guardado', duration: 1400 })
    void qc.invalidateQueries({ queryKey: superadminKeys.empresaTimbrado(emp.id) })
    void qc.invalidateQueries({ queryKey: superadminKeys.empresaTimbresResumen(emp.id) })
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

  async function exportarDatos() {
    setBusy(true)
    const { data, error } = await exportEmpresaData(emp.id)
    setBusy(false)
    if (error || !data) {
      notify({ variant: 'error', title: 'No se pudo exportar', text: error ?? 'Error desconocido' })
      return
    }
    const slug = emp.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'empresa'
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-${slug}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    notify({ variant: 'success', title: 'Export descargado', duration: 1500 })
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
            ['Moneda de cobro', monedaLabel(moneda)],
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

        {/* ── Comisión transaccional (F7) ── */}
        <Section
          title="Comisión transaccional"
          action={<button onClick={() => void configurarComision()} style={secondaryBtnStyle}>Configurar</button>}
        >
          {comisionRows.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
              Sin comisión configurada — los pagos en línea de esta empresa no generan
              comisión de plataforma.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {comisionRows.map(c => (
                <div key={c.canal} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                  <span style={{ fontWeight: 600, minWidth: '110px' }}>{canalComisionLabel(c.canal)}</span>
                  <span style={{ fontFamily: 'var(--at-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatPctComision(c.pct)}{c.fijo > 0 ? ` + ${c.fijo.toFixed(2)} fijo` : ''}
                  </span>
                  {!c.activo && <StatusBadge tone="warning">Inactiva</StatusBadge>}
                </div>
              ))}
            </div>
          )}
          {comisionResumen.length > 0 && (
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', marginTop: '12px' }}>
              <tbody>
                {comisionResumen.map(m => (
                  <BreakdownRow
                    key={m.mes}
                    label={`${m.mes} · ${m.pagos} pago${m.pagos !== 1 ? 's' : ''} cobrado${m.pagos !== 1 ? 's' : ''}`}
                    value={m.comision_total.toFixed(2)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* ── Límites del tenant ── */}
        <Section title="Límites">
          <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
            Estos límites son los que ve y aplica la empresa. El dueño puede ampliarlos
            self-service hasta el tope de su plan (el cobro es por uso).
          </p>
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

        {/* ── Timbrado fiscal (F8) ── */}
        <Section
          title="Timbrado fiscal (DTE)"
          action={<button onClick={() => void configurarTimbrado()} style={secondaryBtnStyle}>Configurar</button>}
        >
          {timbrado ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--at-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                ${(timbrado.precio_dte_cents / 100).toFixed(2)} / DTE
              </span>
              <span style={{ color: 'var(--at-ink-3)' }}>
                · {timbrado.timbres_incluidos} incluido{timbrado.timbres_incluidos !== 1 ? 's' : ''}/mes
              </span>
              {!timbrado.activo && <StatusBadge tone="warning">Inactivo</StatusBadge>}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
              Sin modelo de cobro — los DTEs de esta empresa no generan costo de timbrado.
            </div>
          )}
          {timbresResumen.length > 0 && (
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', marginTop: '12px' }}>
              <tbody>
                {timbresResumen.map(m => (
                  <BreakdownRow
                    key={m.mes}
                    label={`${m.mes} · ${m.timbres} timbre${m.timbres !== 1 ? 's' : ''} (${m.con_costo} con costo)`}
                    value={formatUsdCents(m.costo_total_cents)}
                  />
                ))}
              </tbody>
            </table>
          )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '14px', borderBottom: '1px solid var(--at-line)', paddingBottom: '14px' }}>
            <div style={{ flex: '1 1 280px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
              <strong>Exportar datos (JSON).</strong> Respaldo completo de proyectos, unidades,
              lecturas, pagos y usuarios — recomendado antes de cualquier purga.
            </div>
            <button onClick={() => void exportarDatos()} disabled={busy} style={secondaryBtnStyle}>
              Exportar datos
            </button>
          </div>
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

// F7: canales de comisión (deben casar con el CHECK de comision_config).
const CANALES_COMISION = [
  { value: 'default', label: 'Todos los canales (default)' },
  { value: 'qpaypro', label: 'QPayPro' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'paypal', label: 'PayPal' },
] as const

function canalComisionLabel(canal: string): string {
  return CANALES_COMISION.find(c => c.value === canal)?.label ?? canal
}

function formatPctComision(pct: number): string {
  // 0.025 → "2.5%" (sin ceros colgantes).
  return `${parseFloat((pct * 100).toFixed(2))}%`
}

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

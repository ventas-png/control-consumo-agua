import { useState } from 'react'
import { EmptyState } from '../shared/EmptyState'
import { InputField } from '../shared/InputField'
import { StatusBadge } from '../shared/StatusBadge'
import { StatTile } from '../shared/StatTile'
import { KpiCard } from '../shared/KpiCard'
import { Skeleton } from '../shared/Skeleton'
import { Button } from '../shared/Button'
import { BrandLogo } from '../shared/BrandLogo'
import { CommandPalette, type CommandItem } from '../shared/CommandPalette'
import { DataTable, type DataTableColumn } from '../shared/DataTable'
import { openPromptDialog, openTextPrompt } from '../shared/PromptDialog'
import { confirm, notify } from '../shared/Dialog'
import { SetupWizard } from '../onboarding/SetupWizard'
import type { UserSession } from '../../types'

// F3.13: Component Showcase (design system reference).
// Página dev-only que renderiza todos los shared components con sus
// variantes. Alternativa pragmática a Storybook — sin nuevas
// dependencias, mismo valor:
//   - Visualizar componentes en aislamiento
//   - Validar variantes (variant, size, error states, hover)
//   - Documentación ejecutable
//   - QA visual rápido cuando se hacen cambios al design system
//
// Acceso: /dev/components (solo cuando NODE_ENV !== 'production', o
// gated por flag). Sin ruta hardcoded en el sidebar.

const MOCK_USER: UserSession = {
  user_id: 'demo',
  email: 'demo@test.com',
  name: 'Usuario Demo',
  role: 'admin',
  company_id: 'demo',
  login_time: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}

const MOCK_TABLE_DATA = [
  { id: '1', concepto: 'Cuota mantenimiento', monto: 1500, estado: 'pagado' as const, fecha: '2026-01-15' },
  { id: '2', concepto: 'Cuota extraordinaria', monto: 800, estado: 'pendiente' as const, fecha: '2026-02-01' },
  { id: '3', concepto: 'Mora', monto: 250, estado: 'moroso' as const, fecha: '2026-02-15' },
]

const MOCK_COMMAND_ITEMS: CommandItem[] = [
  { id: 'cuotas', label: 'Cuotas', icon: '💳', group: 'Cobranza', onSelect: () => notify({ variant: 'info', title: 'Cuotas' }) },
  { id: 'visitantes', label: 'Visitantes', icon: '🚪', group: 'Seguridad', onSelect: () => notify({ variant: 'info', title: 'Visitantes' }) },
  { id: 'mascotas', label: 'Mascotas', icon: '🐾', group: 'Comunidad', onSelect: () => notify({ variant: 'info', title: 'Mascotas' }) },
]

export function ComponentShowcase() {
  const [inputValue, setInputValue] = useState('')
  const [errorInputValue, setErrorInputValue] = useState('')
  const [showCmd, setShowCmd] = useState(false)
  const [wizardKey, setWizardKey] = useState(0)

  return (
    <div style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 800, color: 'var(--at-ink)' }}>
          🎨 Component Showcase
        </h1>
        <p style={{ margin: 0, color: 'var(--at-ink-3)', fontSize: '14px' }}>
          Design system reference — todos los componentes shared con sus variantes.
          Solo accesible en dev mode.
        </p>
      </header>

      <Section title="🏷️ StatusBadge — variantes de tono">
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <StatusBadge tone="success">Pagado</StatusBadge>
          <StatusBadge tone="warning">Pendiente</StatusBadge>
          <StatusBadge tone="danger">Moroso</StatusBadge>
          <StatusBadge tone="info">Borrador</StatusBadge>
          <StatusBadge tone="neutral">Archivado</StatusBadge>
        </div>
      </Section>

      <Section title="📊 KpiCard / StatTile">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          <KpiCard label="Total recaudado" value="Q 124,500.00" icon="💰" />
          <KpiCard label="Cuotas pendientes" value="32" icon="⚠️" gradient="warning" />
          <StatTile label="Unidades" value="48" icon="🏠" />
          <StatTile label="Residentes" value="142" icon="👥" tone="success" />
        </div>
      </Section>

      <Section title="📋 EmptyState — variantes">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <Card>
            <EmptyState icon="📦" title="Sin paquetes" description="Aún no se han recibido paquetes." />
          </Card>
          <Card>
            <EmptyState icon="🐾" title="Sin mascotas" description="Registra la primera mascota del condominio."
              action={<Button onClick={() => notify({ variant: 'info', title: 'Click!' })}>+ Nueva mascota</Button>} />
          </Card>
        </div>
      </Section>

      <Section title="🔤 InputField — variantes">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', maxWidth: '700px' }}>
          <InputField label="Nombre" value={inputValue} onChange={setInputValue} placeholder="Ej: Juan Pérez" required />
          <InputField label="Email" value={inputValue} onChange={setInputValue} type="email" autoComplete="email" helpText="Usado para notificaciones." />
          <InputField label="Teléfono" value={inputValue} onChange={setInputValue} type="tel" disabled />
          <InputField label="Con error" value={errorInputValue} onChange={setErrorInputValue} error="Este campo es obligatorio." />
        </div>
      </Section>

      <Section title="💬 Dialog APIs — confirm / notify / openPromptDialog">
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Button onClick={() => notify({ variant: 'success', title: 'Operación exitosa', text: 'Los datos se guardaron correctamente.' })}>
            notify success
          </Button>
          <Button onClick={() => notify({ variant: 'warning', title: 'Atención', text: 'Revisa los datos antes de continuar.' })}>
            notify warning
          </Button>
          <Button onClick={() => notify({ variant: 'error', title: 'Error', text: 'No se pudo completar la operación.' })}>
            notify error
          </Button>
          <Button onClick={() => notify({ variant: 'info', title: 'Información' })}>notify info</Button>
          <Button onClick={async () => {
            const r = await confirm({ title: '¿Confirmar acción?', text: 'Esta operación es reversible.', icon: 'question' })
            notify({ variant: 'info', title: r.isConfirmed ? 'Confirmaste' : 'Cancelaste' })
          }}>
            confirm (question)
          </Button>
          <Button onClick={async () => {
            const r = await confirm({ title: '¿Eliminar?', text: 'Esta acción no se puede deshacer.', icon: 'warning', variant: 'danger', confirmText: 'Sí, eliminar' })
            notify({ variant: r.isConfirmed ? 'success' : 'info', title: r.isConfirmed ? 'Eliminado' : 'Cancelado' })
          }}>
            confirm (danger)
          </Button>
          <Button onClick={async () => {
            const value = await openTextPrompt({ title: 'Renombrar', label: 'Nuevo nombre', required: true })
            if (value) notify({ variant: 'success', title: 'Renombrado', text: `Nuevo nombre: ${value}` })
          }}>
            openTextPrompt
          </Button>
          <Button onClick={async () => {
            const r = await openPromptDialog({
              title: 'Formulario demo',
              description: 'Ejemplo de openPromptDialog con varios tipos de control.',
              fields: [
                { name: 'nombre', label: 'Nombre', required: true, autoFocus: true },
                { name: 'monto', label: 'Monto', type: 'number', min: 0, step: 0.01 },
                { name: 'notas', label: 'Notas', control: 'textarea', rows: 3 },
                { name: 'estado', label: 'Estado', control: 'select', options: [
                  { value: 'activo', label: 'Activo' },
                  { value: 'inactivo', label: 'Inactivo' },
                ] },
                { name: 'aceptar', label: 'Acepto los términos', control: 'checkbox', required: true },
              ],
              validate: (data) => data.aceptar === 'true' ? null : 'Debes aceptar los términos',
            })
            if (r) notify({ variant: 'success', title: 'Form enviado', text: JSON.stringify(r) })
          }}>
            openPromptDialog (multi-field)
          </Button>
        </div>
      </Section>

      <Section title="📊 DataTable — con sort, search, filter">
        <DataTable<typeof MOCK_TABLE_DATA[number]>
          data={MOCK_TABLE_DATA}
          rowKey="id"
          searchableKeys={['concepto']}
          searchPlaceholder="Buscar concepto..."
          emptyState={{ icon: '💳', title: 'Sin cuotas' }}
          defaultSort={{ key: 'fecha', direction: 'desc' }}
          columns={[
            { key: 'concepto', header: 'Concepto', sortable: true },
            { key: 'monto', header: 'Monto', sortable: true, align: 'right', render: (r) => <span style={{ fontWeight: 700 }}>Q {r.monto.toFixed(2)}</span> },
            { key: 'fecha', header: 'Fecha', sortable: true, hideOnMobile: true },
            { key: 'estado', header: 'Estado', render: (r) => (
              <StatusBadge tone={r.estado === 'pagado' ? 'success' : r.estado === 'pendiente' ? 'warning' : 'danger'}>
                {r.estado}
              </StatusBadge>
            ) },
          ] satisfies DataTableColumn<typeof MOCK_TABLE_DATA[number]>[]}
        />
      </Section>

      <Section title="🔍 CommandPalette (Cmd+K / Ctrl+K)">
        <p style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Presiona <kbd style={kbdStyle}>Ctrl+K</kbd> (o <kbd style={kbdStyle}>⌘+K</kbd> en Mac) para abrir.
          Está siempre montado en esta página (escucha el shortcut global).
        </p>
        <CommandPalette items={MOCK_COMMAND_ITEMS} placeholder="Buscar acción..." />
        <Button onClick={() => setShowCmd(s => !s)}>
          {showCmd ? 'Cerrar trigger' : 'Abrir con botón'}
        </Button>
        {showCmd && (
          <p style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '8px' }}>
            (Para abrirlo programáticamente, usa el shortcut o un event listener custom.)
          </p>
        )}
      </Section>

      <Section title="🪄 SetupWizard">
        <p style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Wizard de onboarding para empresas nuevas. Click para abrir:
        </p>
        <Button onClick={() => setWizardKey(k => k + 1)}>
          🚀 Abrir wizard
        </Button>
        <SetupWizard key={wizardKey} currentUser={MOCK_USER} autoOpen={wizardKey > 0} />
      </Section>

      <Section title="💀 Skeleton — loaders">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <Card>
            <Skeleton style={{ height: '20px', marginBottom: '8px' }} />
            <Skeleton style={{ height: '14px', width: '60%', marginBottom: '8px' }} />
            <Skeleton style={{ height: '14px', width: '80%' }} />
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Skeleton style={{ width: '48px', height: '48px', borderRadius: '50%' }} />
              <div style={{ flex: 1 }}>
                <Skeleton style={{ height: '18px', marginBottom: '6px' }} />
                <Skeleton style={{ height: '12px', width: '70%' }} />
              </div>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="🎨 BrandLogo">
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <BrandLogo size={32} />
          <BrandLogo size={48} />
          <BrandLogo size={64} />
        </div>
      </Section>

      <Section title="🎯 Buttons">
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Button onClick={() => {}}>Primary (default)</Button>
          <Button onClick={() => {}} variant="secondary">Secondary</Button>
          <Button onClick={() => {}} variant="danger">Danger</Button>
          <Button onClick={() => {}} size="sm">Small</Button>
          <Button onClick={() => {}} disabled>Disabled</Button>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '40px' }}>
      <h2 style={{
        margin: '0 0 12px',
        fontSize: '18px',
        fontWeight: 700,
        color: 'var(--at-ink)',
        paddingBottom: '8px',
        borderBottom: '1.5px solid var(--at-line)',
      }}>
        {title}
      </h2>
      <div style={{ marginTop: '12px' }}>{children}</div>
    </section>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      border: '1.5px solid var(--at-line)',
      borderRadius: '12px',
      padding: '16px',
    }}>
      {children}
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  fontSize: '11px',
  padding: '2px 6px',
  border: '1px solid var(--at-line)',
  borderRadius: '4px',
  background: 'var(--at-surface-2)',
  fontFamily: 'inherit',
  color: 'var(--at-ink-2)',
}

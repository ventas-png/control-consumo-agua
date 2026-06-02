import type { Meta, StoryObj } from '@storybook/react'
import { StatTile } from './StatTile'

const meta: Meta<typeof StatTile> = {
  title: 'Shared/StatTile',
  component: StatTile,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  argTypes: {
    tone: { control: 'select', options: ['success', 'warning', 'danger', 'info', 'neutral'] },
  },
}

export default meta
type Story = StoryObj<typeof StatTile>

export const Default: Story = {
  args: {
    label: 'Total recaudado',
    value: '$ 124,580.00',
  },
}

export const WithHint: Story = {
  args: {
    label: 'Ingresos del mes',
    value: '$ 24,580',
    hint: '47 cuotas pagadas',
  },
}

export const WithIcon: Story = {
  args: {
    label: 'Visitantes hoy',
    value: 18,
    icon: '👥',
    tone: 'info',
  },
}

export const Grid: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      <StatTile label="Activas" value="247" tone="success" />
      <StatTile label="En trial" value="18" tone="info" />
      <StatTile label="MRR" value="$ 24,580" hint="USD / mes" />
      <StatTile label="Churn 30d" value="3.2%" hint="2 canceladas" tone="warning" />
    </div>
  ),
}

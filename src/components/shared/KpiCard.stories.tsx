import type { Meta, StoryObj } from '@storybook/react'
import { KpiCard } from './KpiCard'

const meta: Meta<typeof KpiCard> = {
  title: 'Shared/KpiCard',
  component: KpiCard,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    Story => <div style={{ maxWidth: 280 }}><Story /></div>,
  ],
}

export default meta
type Story = StoryObj<typeof KpiCard>

export const Default: Story = {
  args: {
    label: 'Consumo del período',
    value: '124.50',
    unit: 'm³',
    icon: '💧',
  },
}

export const WithGradient: Story = {
  args: {
    label: 'Ingresos del mes',
    value: '24,580',
    unit: 'USD',
    icon: '💰',
    gradient: 'linear-gradient(135deg, #10b981, #0d9488)',
  },
}

export const Loading: Story = {
  args: {
    label: 'Cuotas pagadas',
    value: '0',
    loading: true,
  },
}

export const Interactive: Story = {
  args: {
    label: 'Tickets abiertos',
    value: 8,
    icon: '🔧',
    onClick: () => alert('Clic en card'),
  },
}

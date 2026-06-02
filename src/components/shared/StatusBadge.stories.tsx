import type { Meta, StoryObj } from '@storybook/react'
import { StatusBadge } from './StatusBadge'

const meta: Meta<typeof StatusBadge> = {
  title: 'Shared/StatusBadge',
  component: StatusBadge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    tone:  { control: 'select', options: ['success', 'warning', 'danger', 'info', 'neutral'] },
    size:  { control: 'select', options: ['sm', 'md'] },
    solid: { control: 'boolean' },
    dot:   { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof StatusBadge>

export const Success: Story = {
  args: { tone: 'success', children: '✓ Pagado' },
}

export const Warning: Story = {
  args: { tone: 'warning', children: '⚠ Pendiente' },
}

export const Danger: Story = {
  args: { tone: 'danger', children: '✗ Moroso' },
}

export const Info: Story = {
  args: { tone: 'info', children: 'Trial' },
}

export const FromEstado: Story = {
  args: { estado: 'pagado' },
}

export const Solid: Story = {
  args: { tone: 'success', solid: true, children: 'Activo' },
}

export const WithDot: Story = {
  args: { tone: 'warning', dot: true, children: 'En revisión' },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <StatusBadge tone="success">Activo</StatusBadge>
      <StatusBadge tone="warning">Pendiente</StatusBadge>
      <StatusBadge tone="danger">Cancelado</StatusBadge>
      <StatusBadge tone="info">En revisión</StatusBadge>
      <StatusBadge tone="neutral">Borrador</StatusBadge>
    </div>
  ),
}

import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState } from './EmptyState'

const meta: Meta<typeof EmptyState> = {
  title: 'Shared/EmptyState',
  component: EmptyState,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof EmptyState>

export const Default: Story = {
  args: {
    title: 'No hay datos',
  },
}

export const WithDescription: Story = {
  args: {
    icon: '🐕',
    title: 'No hay mascotas registradas',
    description: 'Agrega la primera mascota desde el botón "Nueva mascota".',
  },
}

export const WithAction: Story = {
  args: {
    icon: '📋',
    title: 'Sin proformas registradas',
    description: 'Empieza creando tu primera proforma para llevar control de los costos.',
    action: (
      <button style={{ padding: '8px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
        + Nueva proforma
      </button>
    ),
  },
}

export const Compact: Story = {
  args: {
    icon: '💬',
    title: 'Sin sugerencias',
    compact: true,
  },
}

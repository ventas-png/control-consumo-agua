import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'Shared/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger', 'success', 'warning', 'outline-primary'],
    },
    size:     { control: 'select', options: ['sm', 'md', 'lg'] },
    loading:  { control: 'boolean' },
    disabled: { control: 'boolean' },
    block:    { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { children: 'Guardar cambios', variant: 'primary' },
}

export const Secondary: Story = {
  args: { children: 'Cancelar', variant: 'secondary' },
}

export const Danger: Story = {
  args: { children: 'Eliminar', variant: 'danger' },
}

export const Ghost: Story = {
  args: { children: 'Acción secundaria', variant: 'ghost' },
}

export const Loading: Story = {
  args: { children: 'Guardando', variant: 'primary', loading: true, loadingText: 'Guardando…' },
}

export const WithIconLeft: Story = {
  args: { children: 'Crear nuevo', variant: 'primary', iconLeft: '+' },
}

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="success">Success</Button>
      <Button variant="warning">Warning</Button>
      <Button variant="outline-primary">Outline</Button>
    </div>
  ),
}

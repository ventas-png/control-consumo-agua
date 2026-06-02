import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { InputField } from './InputField'

const meta: Meta<typeof InputField> = {
  title: 'Shared/InputField',
  component: InputField,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    Story => <div style={{ maxWidth: 360 }}><Story /></div>,
  ],
}

export default meta
type Story = StoryObj<typeof InputField>

// Wrapper para que las stories sean controladas
function Controlled(props: Omit<React.ComponentProps<typeof InputField>, 'value' | 'onChange'>) {
  const [v, setV] = useState('')
  return <InputField {...props} value={v} onChange={setV} />
}

export const Default: Story = {
  render: () => <Controlled label="Nombre completo" placeholder="Ej: Ana López" />,
}

export const Required: Story = {
  render: () => <Controlled label="Email" type="email" required placeholder="ana@empresa.com" autoComplete="email" />,
}

export const WithError: Story = {
  render: () => (
    <InputField
      label="Contraseña"
      type="password"
      required
      error="La contraseña debe tener al menos 8 caracteres"
      value="12"
      onChange={() => {}}
    />
  ),
}

export const WithHelpText: Story = {
  render: () => <Controlled label="NIT" helpText="Sin guiones ni espacios" placeholder="1234567890123" />,
}

export const Disabled: Story = {
  render: () => <InputField label="Email" value="usuario@empresa.com" onChange={() => {}} disabled />,
}

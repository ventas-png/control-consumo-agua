import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { LocationPicker } from './LocationPicker'
import type { LatLng } from './MapView'

// serv:S15 — demo del selector de ubicación (click/arrastre para elegir coords).
const meta: Meta<typeof LocationPicker> = {
  title: 'Mapa/LocationPicker',
  component: LocationPicker,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof LocationPicker>

export const Interactivo: Story = {
  render: () => {
    const [coords, setCoords] = useState<LatLng | null>(null)
    return (
      <div style={{ maxWidth: 560 }}>
        <LocationPicker value={coords} onChange={setCoords} />
        <pre style={{ marginTop: 12, fontSize: 12, color: 'var(--at-ink-2)' }}>
          {coords ? JSON.stringify(coords, null, 2) : 'Sin selección'}
        </pre>
      </div>
    )
  },
}

export const ConValorInicial: Story = {
  render: () => {
    const [coords, setCoords] = useState<LatLng | null>({ lat: 14.6349, lng: -90.5069 })
    return (
      <div style={{ maxWidth: 560 }}>
        <LocationPicker value={coords} onChange={setCoords} center={[14.6349, -90.5069]} zoom={14} />
        <pre style={{ marginTop: 12, fontSize: 12, color: 'var(--at-ink-2)' }}>
          {coords ? JSON.stringify(coords, null, 2) : 'Sin selección'}
        </pre>
      </div>
    )
  },
}

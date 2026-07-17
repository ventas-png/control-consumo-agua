// SB 9+: los tipos se importan del paquete del framework, no del renderer.
import type { Preview } from '@storybook/react-vite'
import '../src/index.css'
import '../src/components/shared/shared.css'

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light',   value: '#f8fafc' },
        { name: 'surface', value: '#ffffff' },
        { name: 'dark',    value: '#0f172a' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date:  /Date$/,
      },
    },
  },
}

export default preview

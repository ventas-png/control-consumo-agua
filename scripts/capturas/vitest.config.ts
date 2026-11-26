// Configuración SÓLO para generar capturas de manuales: monta componentes reales con
// datos de demostración y vuelca su HTML. No corre con `npm test` (otro sufijo).
import { mergeConfig } from 'vitest/config'
import base from '../../vite.config'

export default mergeConfig(base, {
  test: {
    include: ['scripts/capturas/**/*.captura.tsx'],
    testTimeout: 60000,
  },
})

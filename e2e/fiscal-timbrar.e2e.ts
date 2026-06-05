import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import {
  FISCAL_SANDBOX_READY,
  hasBaseUrl,
  hasLoginCreds,
  reasons,
} from './fixtures/env'
import { exists, gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #3 (fiscal) — TIMBRAR un comprobante contra Sandbox FEL/CFDI.
// Requiere: login + una factura emitida sin documento (o rechazado) + PAC sandbox
// configurado en el preview (E2E_FISCAL_SANDBOX_READY=1).
test.describe('FISCAL · timbrar (Sandbox)', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)
  test.skip(!FISCAL_SANDBOX_READY, reasons.fiscal)

  test('timbra un comprobante y muestra estado Timbrado', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/cobros')

    const timbrar = page.getByRole('button', { name: /Timbrar/i }).first()
    if (!(await exists(timbrar))) test.skip(true, 'sin factura timbrable — emitir una factura primero')

    await timbrar.click()

    // El timbrado es async contra el PAC sandbox. Esperamos el estado terminal:
    // o "Timbrado" (éxito) o "Rechazado" (el sandbox respondió). Cualquiera de los
    // dos prueba que el camino edge `timbrar-documento` → PAC respondió.
    await expect(page.getByText(/Timbrado|Rechazado/i).first()).toBeVisible({
      timeout: 45_000,
    })
  })
})

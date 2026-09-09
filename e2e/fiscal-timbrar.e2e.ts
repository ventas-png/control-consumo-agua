import { test, expect, type APIRequestContext } from '@playwright/test'

import { iniciarSesionApi } from './fixtures/api'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, hasSupabaseApi, reasons, SUPABASE } from './fixtures/env'
import { capturarLectura, esperarCargoEnCobros } from './fixtures/sembrar'
import { gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #3 (fiscal) — TIMBRAR un comprobante contra el Sandbox.
//
// ESTA PRUEBA YA NO SE OMITE, Y YA NO TIMBRA LO QUE ENCUENTRE. Antes hacía dos
// cosas frágiles: se saltaba entera si no existía E2E_FISCAL_SANDBOX_READY, y
// cuando corría tomaba «el primer botón Timbrar de la tabla» — es decir, el
// comprobante de otra corrida, o el de un dato real del tenant compartido.
// Timbrar es una operación FISCAL: hacerla sobre una fila ajena no es un
// detalle de estilo.
//
// Ahora la prueba fabrica su propio comprobante de principio a fin: captura una
// lectura (que nace como cargo pendiente), emite ESA factura y timbra ESA
// factura, localizada por el id del registro. Si el sandbox fiscal no está
// configurado, la prueba FALLA con el error del edge en vez de desaparecer en
// un skip — que es la diferencia entre saber y suponer.
test.describe('FISCAL · timbrar (Sandbox)', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)
  test.skip(!hasSupabaseApi, reasons.supabaseApi)

  let registroId: string | null = null
  let timbrado = false

  test.beforeEach(() => {
    registroId = null
    timbrado = false
  })

  // LIMPIEZA CONDICIONADA, A PROPÓSITO. Un comprobante TIMBRADO es un artefacto
  // fiscal: aunque sea de sandbox, borrarlo desde una prueba sería exactamente
  // la costumbre que no queremos que exista en este repositorio. Sólo se retira
  // el registro cuando la prueba NO llegó a timbrar, que es cuando sigue siendo
  // un cargo cualquiera. Nunca lanza: una limpieza no convierte un verde en
  // rojo ni tapa el fallo real de un rojo.
  test.afterEach(async ({ request }) => {
    const id = registroId
    registroId = null
    if (!id || timbrado) {
      if (id && timbrado) {
        console.warn(`[e2e] registro ${id} timbrado: se conserva (no se borra un comprobante fiscal)`)
      }
      return
    }
    await borrarRegistro(request, id)
  })

  test('emite y timbra su propio comprobante, y muestra estado Timbrado', async ({ page }) => {
    await login(page)

    // 1 · El cargo. No se busca uno existente: se crea, y se espera la
    //     respuesta real del INSERT (capturarLectura exige el 2xx y devuelve el
    //     id de la fila que el propio POST devolvió).
    await gotoSection(page, '/lecturas')
    const id = await capturarLectura(page)
    expect(
      id,
      'no se pudo capturar una lectura: el tenant de pruebas necesita unidad, contador y tarifa vigente',
    ).toBeTruthy()
    registroId = id

    // 2 · La fila, localizada por id. Nunca «la primera».
    await gotoSection(page, '/cobros')
    const fila = await esperarCargoEnCobros(page, id!)

    // 3 · Emitir ESA factura, esperando el PATCH de ESE registro con 2xx.
    const emitir = fila.locator('button[title^="Emitir factura"]')
    await expect(emitir, 'el cargo recién creado debería ser emitible').toHaveCount(1)
    const [respEmitir] = await Promise.all([
      page.waitForResponse(
        r => r.request().method() === 'PATCH' && r.url().includes(`/rest/v1/registros`) && r.url().includes(id!),
        { timeout: 30_000 },
      ),
      emitir.click(),
    ])
    expect(respEmitir.status(), 'la emisión de la factura debe responder 2xx').toBeLessThan(300)

    // 4 · Timbrar ESA factura. El botón sólo aparece sobre una factura ya
    //     emitida (CobrosSection: puedeTimbrarFactura), así que su presencia
    //     confirma además que el paso anterior surtió efecto en la UI.
    const timbrar = fila.locator('button[title*="imbrar"]')
    await expect(timbrar, 'tras emitir, la fila debe ofrecer Timbrar').toHaveCount(1, { timeout: 20_000 })
    const [respTimbrar] = await Promise.all([
      page.waitForResponse(
        r => r.url().includes('/functions/v1/timbrar-documento') && r.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      timbrar.click(),
    ])
    expect(
      respTimbrar.status(),
      'timbrar-documento debe responder 2xx; un 4xx/5xx aquí es el sandbox fiscal sin configurar',
    ).toBeLessThan(300)
    timbrado = true

    // 5 · El desenlace, EN ESA FILA. «Timbrado» y no «Timbrado|Rechazado»: un
    //     rechazo del PAC es un resultado negativo del camino que esta prueba
    //     existe para cubrir, y darlo por bueno era aceptar de antemano que el
    //     comprobante no se emitiera.
    await expect(fila.getByText(/Timbrado/i).first()).toBeVisible({ timeout: 60_000 })
  })
})

/** Retira el cargo que la prueba creó cuando todavía es seguro hacerlo (no se
 *  timbró). Va con el JWT del admin y por RLS, sin service_role. No lanza. */
async function borrarRegistro(request: APIRequestContext, id: string): Promise<void> {
  try {
    const jwt = await iniciarSesionApi(request)
    const res = await request.delete(
      `${SUPABASE.url}/rest/v1/registros?id=eq.${encodeURIComponent(id)}`,
      {
        headers: {
          apikey: SUPABASE.publishableKey,
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
      },
    )
    if (!res.ok()) console.warn(`[e2e] no se pudo retirar el registro ${id} (status ${res.status()})`)
  } catch (err) {
    console.warn(`[e2e] limpieza del registro ${id} incompleta: ${(err as Error).message}`)
  }
}

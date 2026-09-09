import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { capturarLectura, esperarCargoEnCobros } from './fixtures/sembrar'
import { gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #1 (agua) — capturar LECTURA → emitir COBRO/Factura.
// Requiere datos sembrados (unidad + contador + tarifa vigente; cargo pendiente).
// Cada paso se guarda en runtime: si falta el dato, se skipea (no falla).
//
// EL BOTÓN DE EMITIR SE DIRECCIONA POR SU `title`: la barra de /cobros tiene
// acciones MASIVAS («Emitir facturas», «Emitir período») siempre presentes
// aunque la tabla esté vacía, y el localizador por nombre de rol agarraba una
// de ellas — abría un diálogo de confirmación en vez de emitir la fila. La
// aserción es que ese botón desaparezca, no que exista el texto "Emitida".
test.describe('AGUA · lectura → cobro', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('captura una lectura de medidor', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/lecturas')

    // UNA SOLA FORMA DE ESCRIBIR UNA LECTURA, la del fixture. Esta prueba
    // tenía la suya —seleccionaba unidad y contador a mano y escribía los
    // minutos desde epoch— mientras las otras dos capturas de la suite pasaban
    // por `capturarLectura`. Dos mecanismos para la misma escritura son dos
    // maneras distintas de chocar con uq_registros_llave_natural, y arreglar
    // una no arregla la otra. El fixture además AFIRMA el 2xx del INSERT y
    // busca un valor libre ante un 409; el `fill` suelto daba por buena la
    // captura con que el botón desapareciera, que es un efecto de la UI y no
    // la confirmación de que la fila entró.
    //
    // La aserción de éxito —el formulario se cierra— sigue existiendo, ahora
    // dentro de `capturarLectura`; el par con `agua-lectura-validaciones` (ahí
    // el rechazo deja el botón EN pantalla) queda intacto.
    const registroId = await capturarLectura(page)
    if (registroId === null) {
      test.skip(true, 'sin unidad o contador sembrados: no hay captura posible')
    }
    expect(registroId, 'la captura tiene que devolver el id del registro creado').toBeTruthy()
  })

  test('emite factura de un cargo pendiente', async ({ page }) => {
    await login(page)

    // FABRICA SU PROPIO CARGO. Un registro de lectura nace con
    // factura_estado 'pendiente', o sea que capturar una lectura ES crear el
    // cargo que esta prueba emite. Antes el cargo venía de una siembra manual
    // por SQL y emitirlo lo gastaba: la corrida siguiente se omitía con «sin
    // cargos pendientes» — un skip inesperado, es decir rojo, sin que nada
    // estuviera roto.
    //
    // Se captura aquí y no se confía en que la prueba de arriba ya lo hizo:
    // las pruebas no pueden depender del orden en que Playwright las corra.
    await gotoSection(page, '/lecturas')
    const registroId = await capturarLectura(page)
    if (registroId === null) {
      test.skip(true, 'sin unidad o contador para capturar: no se puede fabricar el cargo')
    }

    // SE EMITE LA FILA PROPIA, NO «LA PRIMERA». El localizador anterior tomaba
    // el primer botón de la tabla, que en el tenant compartido es la fila de
    // otra corrida; y cuando la tabla no lo tenía todavía, la prueba se OMITÍA
    // con «la lectura capturada no aparece como cargo emitible» — un skip
    // inesperado, es decir rojo, que es exactamente lo que dejó la suite roja
    // del 3 al 8 de septiembre. Ahora se espera a que la fila aparezca (por su
    // id) y se emite ésa: si no aparece, es un fallo con nombre.
    await gotoSection(page, '/cobros')
    const fila = await esperarCargoEnCobros(page, registroId!)

    const emitir = fila.locator('button[title^="Emitir factura"]')
    await expect(emitir, 'el cargo recién creado debería ser emitible').toHaveCount(1)
    await emitir.click()
    await expect(emitir, 'tras emitir, la fila ya no ofrece emitir').toHaveCount(0, { timeout: 20_000 })
  })
})

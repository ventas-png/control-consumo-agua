import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { capturarLectura } from './fixtures/sembrar'
import { chooseFirstRealOption, exists, gotoSection } from './fixtures/ui'

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

    const unidad = page.getByLabel(/Seleccionar Unidad/i)
    if (!(await exists(unidad))) test.skip(true, 'UI de lecturas no disponible para este rol')
    const u = await chooseFirstRealOption(unidad)
    test.skip(u === null, 'sin unidades sembradas')

    const contador = page.getByLabel(/Seleccionar Contador/i)
    const c = await chooseFirstRealOption(contador)
    test.skip(c === null, 'la unidad no tiene contador sembrado')

    // LA LECTURA CRECE CON EL RELOJ, y no es una constante. La clave natural
    // uq_registros_llave_natural es (contador_id, lectura_actual, fecha): con
    // un '999999' fijo, la segunda corrida DEL MISMO DÍA choca con el índice,
    // el guardado se rechaza y la prueba se cae sin que nada esté roto. Los
    // minutos desde epoch crecen siempre, así que cada corrida trae un valor
    // nuevo y además mayor que el que dejó la anterior — que es lo que
    // validarLectura exige para no tratarlo como retroceso del medidor.
    const lectura = String(Math.floor(Date.now() / 60_000))
    await page.getByPlaceholder('Ingrese lectura del medidor').fill(lectura)
    const guardar = page.getByRole('button', { name: /Guardar Lectura/i })
    await guardar.click()

    // ÉXITO = EL FORMULARIO SE CIERRA. La aserción anterior era la contraria
    // («el form sigue operable») y estaba INVERTIDA: LecturasSection sólo llama
    // a limpiarFormulario() en los caminos de guardado, y eso borra el contador
    // seleccionado, con lo que el bloque {contadorSeleccionado && …} —input y
    // botón incluidos— se desmonta. Un rechazo de validación, en cambio, hace
    // `return notify(...)` ANTES y deja el formulario en pantalla. Es decir: la
    // prueba pasaba cuando la lectura NO se guardaba y fallaba cuando sí.
    //
    // Se vio en el run 32888464432: el primer intento guardó de verdad (botón
    // desmontado → rojo) y el reintento pasó porque para entonces la app ya
    // rechazaba la lectura. Quedó marcada como "flaky", que es como se ve un
    // verde falso cuando el mundo deja de cooperar.
    await expect(guardar).toBeHidden({ timeout: 20_000 })
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
    if (!(await capturarLectura(page))) {
      test.skip(true, 'sin unidad o contador para capturar: no se puede fabricar el cargo')
    }

    await gotoSection(page, '/cobros')
    const emitibles = page.locator('button[title^="Emitir factura"]')
    if (!(await exists(emitibles.first()))) {
      test.skip(true, 'la lectura capturada no aparece como cargo emitible en /cobros')
    }

    const antes = await emitibles.count()
    await emitibles.first().click()
    await expect(emitibles).toHaveCount(antes - 1, { timeout: 20_000 })
  })
})

import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { chooseFirstRealOption, exists, gotoSection } from './fixtures/ui'

// EDGE CASES DE DINERO (P2 #8) — validaciones del flujo lectura → cobro que
// protegen la integridad del dinero: la app debe RECHAZAR datos que generarían
// cobros corruptos. Complementa agua-lectura-cobro.e2e.ts (happy path).
//
// CÓMO SE AFIRMA UN RECHAZO, Y POR QUÉ ASÍ. El mensaje de error va en un toast
// (notify) que se desvanece: afirmarlo es pedir una carrera. Lo estable —y
// además lo que ve el operador— es el estado que el rechazo deja en pantalla:
//   · el campo readonly «Consumo Calculado» pasa a "<consumo> (ERROR)";
//   · el formulario SIGUE montado. LecturasSection sólo llama a
//     limpiarFormulario() en los caminos de guardado —y eso desmonta el bloque
//     {contadorSeleccionado && …}—, así que "el botón de guardar sigue ahí"
//     equivale a "NO se guardó nada". Es la aserción espejo de la de
//     agua-lectura-cobro, donde el éxito es justamente que desaparezca. Que el
//     par siga siendo un par lo vigila scripts/__tests__/e2e-preflight.test.mjs.
//
// Los textos asertados salen de src/. La versión anterior de este archivo
// esperaba /Consumo Negativo|mayor o igual a la anterior/, y NINGUNA de las dos
// frases existe en el código —el mensaje real de validarLectura es «La lectura
// actual no puede ser negativa.»—, así que no podía pasar nunca; su fallo
// («element(s) not found» tras 15 s) se leía igual que una regresión de la app.
// Ahora hay una guarda estática que lo detecta en npm test.

test.describe('AGUA · validaciones de lectura (edge cases de dinero)', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('sin unidad seleccionada no hay forma de guardar una lectura', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/lecturas')

    const unidad = page.getByLabel(/Seleccionar Unidad/i)
    if (!(await exists(unidad))) test.skip(true, 'UI de lecturas no disponible para este rol')

    // ANTES esta prueba hacía clic en «Guardar Lectura» sin elegir unidad y
    // esperaba el aviso "Seleccione una unidad primero". Ese clic es imposible:
    // el formulario entero vive dentro de {unidadSeleccionada && …}, así que el
    // botón NO EXISTE todavía. La prueba se skipeaba en cada corrida con la
    // razón equivocada ("UI de lecturas no disponible para este rol" — la UI
    // estaba disponible), y ese skip inesperado ponía el job en rojo.
    //
    // La garantía real es más fuerte que el aviso: la acción inválida ni
    // siquiera se puede intentar. Eso es lo que se prueba. El guard de
    // handleGuardar queda como defensa en profundidad.
    await expect(page.getByRole('button', { name: /Guardar Lectura/i })).toHaveCount(0)
  })

  test('lectura menor a la anterior (consumo negativo) es rechazada', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/lecturas')

    const unidad = page.getByLabel(/Seleccionar Unidad/i)
    if (!(await exists(unidad))) test.skip(true, 'UI de lecturas no disponible para este rol')
    const u = await chooseFirstRealOption(unidad)
    test.skip(u === null, 'sin unidades sembradas')

    const contador = page.getByLabel(/Seleccionar Contador/i)
    const c = await chooseFirstRealOption(contador)
    test.skip(c === null, 'la unidad no tiene contador sembrado')

    // Un valor negativo garantiza consumo < 0 sea cual sea la lectura anterior
    // sembrada. La app debe rechazarlo SIN crear el registro.
    await page.getByPlaceholder('Ingrese lectura del medidor').fill('-5')

    // El rechazo ya es visible ANTES de pulsar: el consumo calculado se marca
    // en rojo con "(ERROR)" en cuanto validarLectura dice que no.
    await expect(page.locator('#lectura-consumo')).toHaveValue(/\(ERROR\)/)

    const guardar = page.getByRole('button', { name: /Guardar Lectura/i })
    await guardar.click()

    // Nada se guardó: el formulario sigue montado con el valor inválido dentro.
    await expect(guardar).toBeVisible()
    await expect(page.getByPlaceholder('Ingrese lectura del medidor')).toHaveValue('-5')
  })
})

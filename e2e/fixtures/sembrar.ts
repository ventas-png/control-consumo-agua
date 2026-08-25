// ════════════════════════════════════════════════════════════════════════════
// Cada spec de dinero CREA por la UI el dato que va a consumir.
// ════════════════════════════════════════════════════════════════════════════
// EL PROBLEMA QUE ESTO RESUELVE. Los caminos de dinero son destructivos por
// naturaleza: emitir gasta una cuota pendiente, pagar gasta una emitida,
// capturar una lectura gasta el hueco del período. La suite pasó en verde el
// run 32889832167 y, con el mismo código, la corrida SIGUIENTE se habría
// omitido con «sin cuotas pendientes» — un skip inesperado, es decir rojo,
// sin que nada estuviera roto. Un verde que sólo ocurre una vez no es un
// verde: es una foto.
//
// La alternativa era reponer el tenant por SQL antes de cada corrida (a mano,
// o metiendo la service_role como secreto de GitHub). Las dos son peores: la
// primera no escala y la segunda mete una llave de administrador en CI. Que
// cada prueba fabrique su propio dato POR LA MISMA UI que después ejercita
// deja la suite cerrada sobre sí misma — y de paso prueba el alta, que antes
// no se ejercitaba en ningún lado.
//
// Todo lo creado lleva un marcador con la marca de tiempo de la corrida, para
// que se distinga de la siembra manual y se pueda limpiar sin ambigüedad.

import { expect, type Page } from '@playwright/test'

import { chooseFirstRealOption } from './ui'

/** Marca única por corrida: aparece en las notas de lo que creamos. */
export function marcaDeCorrida(prefijo: string): string {
  return `${prefijo} ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
}

/**
 * Crea una cuota PENDIENTE desde «+ Nueva cuota» y devuelve cuántos botones de
 * emitir hay después. La cuota nace pendiente (el alta no emite), que es
 * justamente el estado que «emite una cuota pendiente» necesita consumir.
 */
export async function crearCuotaPendiente(page: Page, monto = '250'): Promise<void> {
  const emitibles = page.locator('button[title^="Emitir cuota"]')
  const antes = await emitibles.count()

  await page.getByRole('button', { name: /Nueva cuota/i }).click()

  // La unidad es opcional, pero elegirla acerca la cuota a una real de
  // cobranza; si el proyecto no tiene unidades activas, seguimos sin ella.
  await chooseFirstRealOption(page.locator('#cuota-unidad')).catch(() => null)
  await page.locator('#cuota-monto').fill(monto)
  await page.locator('#cuota-notas').fill(marcaDeCorrida('E2E · creada por la suite'))

  // El vencimiento a 30 días: con `hoy` la cuota nace vencida y el botón de
  // pagar no aparece (esVencida: hay fecha, ya pasó, y no está pagada).
  const vence = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  await page.locator('#cuota-vencimiento').fill(vence)

  await page.getByRole('button', { name: /^Guardar$/ }).click()

  // El alta terminó cuando hay UN emitible más. Afirmarlo aquí —y no dar por
  // hecho que el clic bastó— evita que un fallo del alta se manifieste más
  // tarde como un skip confuso en la prueba que sigue.
  await expect(emitibles).toHaveCount(antes + 1, { timeout: 20_000 })
}

/**
 * Captura una lectura de medidor y deja un CARGO PENDIENTE (el registro nace
 * con factura_estado 'pendiente'), que es lo que consume «emite factura de un
 * cargo pendiente».
 *
 * @returns false si el tenant no tiene unidad o contador que permitan capturar
 *          — el caller decide si eso es un skip legítimo.
 */
export async function capturarLectura(page: Page): Promise<boolean> {
  const unidad = page.getByLabel(/Seleccionar Unidad/i)
  if ((await unidad.count()) === 0) return false
  if ((await chooseFirstRealOption(unidad)) === null) return false
  if ((await chooseFirstRealOption(page.getByLabel(/Seleccionar Contador/i))) === null) return false

  // La lectura crece con el reloj: uq_registros_llave_natural es
  // (contador_id, lectura_actual, fecha), así que un valor fijo chocaría con
  // el índice en la segunda corrida del mismo día. Los minutos desde epoch
  // crecen siempre y además superan a la lectura anterior, que es lo que
  // validarLectura exige para no leerlo como retroceso del medidor.
  await page.getByPlaceholder('Ingrese lectura del medidor').fill(String(Math.floor(Date.now() / 60_000)))

  const guardar = page.getByRole('button', { name: /Guardar Lectura/i })
  await guardar.click()
  // Guardar desmonta el formulario (limpiarFormulario borra el contador). Es
  // la señal de que la lectura entró; un rechazo lo dejaría en pantalla.
  await expect(guardar).toBeHidden({ timeout: 20_000 })
  return true
}

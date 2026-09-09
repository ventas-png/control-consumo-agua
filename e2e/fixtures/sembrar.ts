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

import { expect, type Locator, type Page, type Response } from '@playwright/test'

import { chooseFirstRealOption } from './ui'

/**
 * Distancias, a partir de la última lectura mostrada, que `capturarLectura`
 * prueba hasta encontrar un valor libre. Doblan para cubrir 64 valores ya
 * ocupados en 7 intentos; un paso de uno en uno se quedaría corto en un día
 * con varias corridas. El salto sólo infla el consumo del sandbox (validarLectura
 * avisa de un salto anómalo pero NO lo bloquea: devuelve `valid: true`).
 */
const SALTOS_DE_LECTURA = [1, 2, 4, 8, 16, 32, 64] as const

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

  // CAM SIN UNIDAD, y no una cuota de mantenimiento con unidad. No es un
  // capricho: es el único alta que se puede repetir.
  //
  // uq_cuotas_condominio_llave_natural es (unidad_id, periodo, concepto) con
  // WHERE deleted_at IS NULL AND unidad_id IS NOT NULL. Con una unidad fija,
  // el período por defecto (el mes en curso) y el concepto por defecto
  // ('mantenimiento'), la SEGUNDA alta del mes choca con el índice:
  // handleGuardar avisa «Cuota ya existe» y vuelve sin insertar nada. Eso pasó
  // en el run 32892210359 — la primera prueba creó su cuota y la segunda se
  // quedó sin ninguna, con 0 botones donde esperaba 1. Y no habría bastado con
  // variar el período: el mes sólo da doce valores al año, así que la segunda
  // corrida del mismo mes volvería a chocar.
  //
  // El índice exime a propósito las filas con unidad_id NULL, y el schema
  // (cuotaInputSchema.superRefine) permite unidad nula EXACTAMENTE para 'CAM'
  // — "la única cuota global a nivel proyecto sin unidad específica". Índice y
  // schema coinciden en que ése es el caso sin límite, así que es el que se
  // usa. Las transiciones que la prueba ejercita (emitir → pagar) son las
  // mismas para cualquier concepto.
  await page.locator('#cuota-concepto').selectOption('CAM')
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
 * Lee «Última Lectura» del bloque de info del contador, que LecturasSection
 * pinta en cuanto hay contador seleccionado (`ultimaLectura`, calculado del
 * historial). Es el mismo número que la app usará como `lectura_anterior` al
 * guardar, así que basarse en él es basarse en el estado real y no en una
 * suposición sobre el reloj.
 *
 * OJO: ES UNA COTA INFERIOR, NO EL MÁXIMO. `getUltimaLectura` ordena el
 * historial SÓLO por `fecha` descendente, y `fecha` se graba como el mediodía
 * del día capturado (`new Date(fechaLecturaActual + 'T12:00:00')`), así que
 * TODAS las lecturas del mismo día empatan. El empate lo rompe el orden en que
 * vienen los registros —`useRegistrosQuery` pide `fecha desc, id asc`—, o sea
 * el UUID más chico del día, que no es la lectura más alta ni la más reciente.
 * Con dos capturas el mismo día, la segunda puede ver el valor de la primera…
 * o el de cualquier otra. Por eso quien la usa camina hacia arriba hasta
 * encontrar un valor libre en vez de dar por buena `anterior + 1`.
 *
 * Un contador sin historial muestra 0 —`getUltimaLectura` devuelve
 * `{ lectura: 0, esPrimera: true }`—, así que la primera captura escribe 1.
 */
async function ultimaLecturaMostrada(page: Page): Promise<number> {
  // El bloque es <div><small>Última Lectura</small><div>{valor}</div>…</div>:
  // se ancla en la etiqueta y se sube al contenedor, que es lo único estable
  // (no hay data-testid en este componente).
  const bloque = page.locator('div').filter({
    has: page.getByText('Última Lectura', { exact: true }),
  }).last()

  await expect(
    bloque,
    'no aparece el bloque «Última Lectura»: sin contador seleccionado no hay captura posible',
  ).toBeVisible({ timeout: 20_000 })

  const texto = (await bloque.innerText()).replace('Última Lectura', ' ')
  const valor = Number((texto.match(/-?\d+(?:[.,]\d+)?/) ?? ['NaN'])[0].replace(',', '.'))
  expect(
    Number.isFinite(valor),
    `«Última Lectura» no trae un número legible (leído: ${JSON.stringify(texto.slice(0, 80))})`,
  ).toBe(true)
  return valor
}

/**
 * Captura una lectura de medidor y deja un CARGO PENDIENTE (el registro nace
 * con factura_estado 'pendiente'), que es lo que consumen «emite factura de un
 * cargo pendiente» y el spec fiscal.
 *
 * DEVUELVE EL ID DEL REGISTRO CREADO, y no un booleano, porque quien la llama
 * necesita apuntar a ESE cargo y no al primero que encuentre en la tabla.
 *
 * LA CARRERA QUE ESTO CIERRA. La versión anterior daba por buena la captura
 * cuando el botón «Guardar Lectura» desaparecía. Desaparece porque
 * `limpiarFormulario()` borra el contador seleccionado y desmonta el bloque —
 * es un efecto de la UI, no la confirmación de que la fila entró. Entre el clic
 * y el desmontaje sigue viva la petición: si el INSERT era rechazado (llave
 * natural repetida, RLS, tarifa faltante) la pantalla podía haberse limpiado
 * igual, y la prueba seguía adelante para caerse más tarde, en otro sitio y con
 * un síntoma que no nombraba la causa. Ahora se espera la RESPUESTA del POST a
 * /rest/v1/registros, se exige 2xx, y el id sale de la fila que la propia
 * respuesta devuelve (crearRegistro hace insert().select()): que la fila vuelva
 * ES la confirmación de que el registro existe.
 *
 * @returns el id del registro creado, o null si el tenant no tiene unidad o
 *          contador que permitan capturar — el caller decide si eso es un skip
 *          legítimo.
 */
export async function capturarLectura(page: Page): Promise<string | null> {
  const unidad = page.getByLabel(/Seleccionar Unidad/i)
  if ((await unidad.count()) === 0) return null
  if ((await chooseFirstRealOption(unidad)) === null) return null
  if ((await chooseFirstRealOption(page.getByLabel(/Seleccionar Contador/i))) === null) return null

  // LA LECTURA SALE DEL ESTADO, NO DEL RELOJ — Y EL 409 SE MIDE, NO SE ADIVINA.
  //
  // uq_registros_llave_natural es (contador_id, lectura_actual, fecha), y
  // validarLectura exige además que el valor SUPERE al anterior para no leerlo
  // como retroceso del medidor.
  //
  // Antes se usaban los minutos desde epoch, y funcionó mientras hubo UNA sola
  // captura por corrida. Al volver obligatorio el spec fiscal pasaron a ser
  // tres, y dos capturas del mismo minuto —o cualquier REINTENTO, que ocurre
  // segundos después— repiten el valor: 409. Subir la resolución del reloj
  // habría sido apostar a que dos escrituras no caigan en la misma unidad de
  // tiempo, y de paso inflaba el medidor del sandbox en millones de m³.
  //
  // «Última lectura más uno» tampoco basta, y la corrida que lo probó está
  // documentada arriba en `ultimaLecturaMostrada`: la pantalla no muestra el
  // MÁXIMO del contador, muestra el registro de UUID más chico entre los del
  // día, porque el historial se ordena sólo por `fecha` y todas las lecturas
  // del mismo día llevan la misma (el mediodía). Con eso, la primera captura
  // de la corrida guardó y la SEGUNDA volvió a leer el mismo número y volvió a
  // pedir el mismo valor: 409 en los tres intentos.
  //
  // Así que el valor se BUSCA. Se empieza en `anterior + 1` y, ante un 409
  // —que es exactamente «ese valor ya existe para este contador y esta
  // fecha»—, se salta al siguiente hueco doblando la distancia: 1, 2, 4, 8…
  // Doblar y no sumar de a uno importa porque el tenant es compartido y el día
  // acumula capturas de corridas anteriores: siete intentos cubren 64 valores
  // ocupados en vez de 7. Cualquier otro código corta el bucle en el acto: un
  // 403 de RLS o un 400 de validación no se arreglan cambiando el número, y
  // reintentarlos sólo escondería la causa.
  const anterior = await ultimaLecturaMostrada(page)
  const campo = page.getByPlaceholder('Ingrese lectura del medidor')
  const guardar = page.getByRole('button', { name: /Guardar Lectura/i })

  let respuesta: Response | null = null
  for (const salto of SALTOS_DE_LECTURA) {
    await campo.fill(String(anterior + salto))
    const [r] = await Promise.all([
      page.waitForResponse(
        req => req.request().method() === 'POST' && /\/rest\/v1\/registros(\?|$)/.test(req.url()),
        { timeout: 30_000 },
      ),
      guardar.click(),
    ])
    respuesta = r
    // 409 = choque con la llave natural: el mismo valor ya está tomado para
    // este contador y esta fecha. Es el único caso que se reintenta, y el
    // rechazo deja el formulario en pantalla (handleGuardar hace `return`
    // antes de limpiarlo), así que el siguiente intento puede reescribir.
    if (r.status() !== 409) break
  }

  if (!respuesta) throw new Error('SALTOS_DE_LECTURA quedó vacío: no se intentó ninguna captura')

  expect(
    respuesta.status(),
    'el INSERT de la lectura tiene que responder 2xx; si no, el cargo no existe',
  ).toBeLessThan(300)

  const filas = (await respuesta.json()) as Array<{ id?: string }>
  const id = Array.isArray(filas) ? filas[0]?.id : undefined
  expect(id, 'el INSERT devolvió 2xx pero sin la fila creada').toBeTruthy()

  // Y recién ahora el desmontaje del formulario, que sigue siendo una señal
  // útil —un rechazo de validación lo deja en pantalla— pero ya no es LA señal.
  await expect(guardar).toBeHidden({ timeout: 20_000 })
  return id as string
}

/**
 * Confirma que el cargo recién capturado APARECE en /cobros y devuelve su fila,
 * localizada por el id del registro y no por su posición.
 *
 * `data-registro-id` existe en la tabla de /cobros justamente para esto: sin él
 * la única forma de tocar una fila es «la primera», que en un tenant compartido
 * es la fila de otra corrida.
 */
export function filaDeCobro(page: Page, registroId: string): Locator {
  return page.locator(`tr[data-registro-id="${registroId}"]`)
}

export async function esperarCargoEnCobros(page: Page, registroId: string): Promise<Locator> {
  const fila = filaDeCobro(page, registroId)
  await expect(
    fila,
    'el registro creado no aparece en /cobros: sin él no hay nada que emitir ni timbrar',
  ).toHaveCount(1, { timeout: 30_000 })
  return fila
}

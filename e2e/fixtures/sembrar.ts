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

import { iniciarSesionApi, maxLecturaDeContador } from './api'
import { hasSupabaseApi } from './env'
import { chooseFirstRealOption } from './ui'

/**
 * Cuántos valores consecutivos prueba `escribirEnElPrimerValorLibre` antes de
 * rendirse. Es una RED, no el mecanismo: el valor de partida sale del máximo
 * real del contador (`maxLecturaDeContador`), así que el primer intento ya
 * debería entrar. Lo único que puede ocuparlo entre la consulta y la escritura
 * es otra corrida escribiendo en el mismo contador, y ahí la distancia es el
 * número de escritores simultáneos: unos pocos, no decenas.
 *
 * La versión anterior hacía lo contrario —saltos 1, 2, 4… 64 desde lo que
 * mostraba la pantalla— y era una apuesta mal contada: siete intentos NO cubren
 * 64 valores ocupados, sólo siete posiciones concretas. Con 8 y 16 tomados, el
 * salto de 8 choca y el de 16 también, y el hueco de 9 nunca se prueba.
 */
const INTENTOS_DE_ESCRITURA = 12

/**
 * Escribe empezando en `desde` y, ante un 409 —que significa exactamente «ese
 * valor ya está tomado para este contador y esta fecha»—, prueba el siguiente
 * entero. Cualquier otro código corta en el acto: un 403 de RLS o un 400 de
 * validación no se arreglan cambiando el número, y reintentarlos escondería la
 * causa.
 *
 * Devuelve la ÚLTIMA respuesta aunque sea 409: quien llama la afirma y así el
 * fallo dice «no se encontró hueco» con el status a la vista, en vez de lanzar
 * un error propio que oculte lo que respondió el servidor.
 *
 * Es genérica en la respuesta (sólo pide `status()`) para poder ejercitarla sin
 * navegador: ver `e2e/fixtures/__tests__/valor-libre.test.ts`.
 */
export async function escribirEnElPrimerValorLibre<T extends { status(): number }>(
  desde: number,
  escribir: (valor: number) => Promise<T>,
  intentos: number = INTENTOS_DE_ESCRITURA,
): Promise<{ valor: number; respuesta: T; intentos: number }> {
  let respuesta: T | null = null
  let valor = desde
  for (let n = 0; n < intentos; n++) {
    valor = desde + n
    respuesta = await escribir(valor)
    if (respuesta.status() !== 409) return { valor, respuesta, intentos: n + 1 }
  }
  if (!respuesta) throw new Error('escribirEnElPrimerValorLibre se llamó con intentos <= 0')
  return { valor, respuesta, intentos }
}

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
 * o el de cualquier otra. Por eso el valor a escribir NO sale de aquí sino de
 * `maxLecturaDeContador`, que lo mide contra la base; esto se conserva sólo
 * como piso (y como la única fuente cuando no hay API configurada, corriendo en
 * local) y porque su ausencia delata que no hay contador seleccionado.
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
 * El máximo real del contador, medido contra la base con el JWT del mismo
 * usuario que está usando la UI. Devuelve null cuando no hay API configurada
 * —correr en local sin E2E_SUPABASE_* es legítimo; en CI esas variables son
 * obligatorias y el preflight lo exige— y entonces la captura cae a lo que
 * muestra la pantalla, que es una cota inferior válida.
 *
 * Se inicia sesión por API en vez de rescatar el token del localStorage: el
 * formato de almacenamiento de supabase-js es un detalle interno suyo (cambia
 * de versión, puede venir troceado), y `iniciarSesionApi` ya es el camino que
 * usan los demás specs.
 */
async function maxLecturaConocida(page: Page, contadorId: string): Promise<number | null> {
  if (!hasSupabaseApi) return null
  const jwt = await iniciarSesionApi(page.request)
  return await maxLecturaDeContador(page.request, jwt, contadorId)
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
  const contadorId = await chooseFirstRealOption(page.getByLabel(/Seleccionar Contador/i))
  if (contadorId === null) return null

  // EL VALOR SALE DEL MÁXIMO REAL, MEDIDO POR API. NO DEL RELOJ NI DE LA UI.
  //
  // uq_registros_llave_natural es (contador_id, lectura_actual, fecha), y
  // validarLectura exige además que el valor SUPERE al anterior para no leerlo
  // como retroceso del medidor. «Máximo del contador + 1» cumple las dos por
  // definición, y es la ÚNICA forma de acertar al primer intento.
  //
  // Las dos versiones anteriores fallaron por adivinar en vez de medir:
  //
  //   · los minutos desde epoch: dos capturas del mismo minuto —o cualquier
  //     REINTENTO, que ocurre segundos después— repiten el valor. 409.
  //   · «última lectura mostrada + 1»: la pantalla NO muestra el máximo (ver
  //     `ultimaLecturaMostrada`), así que la segunda captura de la corrida
  //     volvía a leer el mismo número y a pedir el mismo valor. 409 otra vez.
  //
  // La consulta pide `order=lectura_actual.desc&limit=1` con el filtro del
  // índice parcial: la ordena la base, no el cliente, y trae UNA fila.
  //
  // Lo que queda para la caminata secuencial es sólo la CARRERA: que otra
  // corrida escriba en el mismo contador entre la consulta y el guardado. Ahí
  // la distancia es el número de escritores simultáneos, así que sumar de a uno
  // es exactamente lo que corresponde.
  const mostrada = await ultimaLecturaMostrada(page)
  const maximo = await maxLecturaConocida(page, contadorId)
  const desde = Math.max(mostrada, maximo ?? mostrada) + 1

  const campo = page.getByPlaceholder('Ingrese lectura del medidor')
  const guardar = page.getByRole('button', { name: /Guardar Lectura/i })

  // El rechazo por llave repetida deja el formulario EN pantalla —handleGuardar
  // hace `return` antes de `limpiarFormulario()`—, así que el intento siguiente
  // puede reescribir el campo sin recargar nada.
  const { respuesta, intentos } = await escribirEnElPrimerValorLibre<Response>(desde, async valor => {
    await campo.fill(String(valor))
    const [r] = await Promise.all([
      page.waitForResponse(
        req => req.request().method() === 'POST' && /\/rest\/v1\/registros(\?|$)/.test(req.url()),
        { timeout: 30_000 },
      ),
      guardar.click(),
    ])
    return r
  })

  expect(
    respuesta.status(),
    `el INSERT de la lectura tiene que responder 2xx; si no, el cargo no existe ` +
    `(se probaron ${intentos} valores consecutivos desde ${desde})`,
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

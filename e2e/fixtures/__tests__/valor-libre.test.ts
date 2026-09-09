// Prueba de COMPORTAMIENTO de la búsqueda de valor libre en la captura de
// lecturas (e2e/fixtures/sembrar.ts). Corre con vitest, sin navegador: la
// función es genérica en la respuesta y sólo pide `status()`.
//
// POR QUÉ EXISTE. El 409 de uq_registros_llave_natural (contador_id,
// lectura_actual, fecha) tumbó la suite dos veces seguidas, y las dos veces el
// arreglo se «verificó» corriendo el E2E completo contra un tenant compartido:
// diez minutos por intento, y un verde que dependía de qué valores estuvieran
// ocupados ese día. Aquí las colisiones se FABRICAN, así que el caso que
// importa —varios valores ya tomados, uno detrás de otro— se ejercita siempre y
// en milisegundos.
//
// La versión anterior (saltos 1, 2, 4… 64) habría fallado la segunda prueba de
// este archivo: con 8 y 16 ocupados, el salto de 8 choca, el de 16 también, y
// el hueco de 9 no se prueba nunca.

import { describe, it, expect } from 'vitest'

import { escribirEnElPrimerValorLibre } from '../sembrar'

/** Un servidor de mentira: 409 para los valores ya tomados, `exito` para el
 *  resto. Registra qué valores se intentaron, en orden. */
function servidorConValoresTomados(tomados: number[], exito = 201) {
  const intentados: number[] = []
  return {
    intentados,
    escribir: async (valor: number) => {
      intentados.push(valor)
      return { status: () => (tomados.includes(valor) ? 409 : exito) }
    },
  }
}

describe('escribirEnElPrimerValorLibre', () => {
  it('escribe a la primera cuando el valor está libre', async () => {
    const servidor = servidorConValoresTomados([])
    const r = await escribirEnElPrimerValorLibre(100, servidor.escribir)
    expect(r.valor).toBe(100)
    expect(r.intentos).toBe(1)
    expect(r.respuesta.status()).toBe(201)
    expect(servidor.intentados).toEqual([100])
  })

  it('reproduce VARIOS 409 seguidos y encuentra el primer hueco', async () => {
    // Cinco valores consecutivos tomados: es lo que deja un día con varias
    // corridas sobre el mismo contador.
    const servidor = servidorConValoresTomados([10, 11, 12, 13, 14])
    const r = await escribirEnElPrimerValorLibre(10, servidor.escribir)
    expect(r.valor).toBe(15)
    expect(r.intentos).toBe(6)
    expect(r.respuesta.status()).toBe(201)
    // Consecutivos y sin saltarse ninguno: el hueco de 15 es el PRIMERO libre.
    expect(servidor.intentados).toEqual([10, 11, 12, 13, 14, 15])
  })

  it('encuentra un hueco que los saltos exponenciales se habrían salteado', async () => {
    // Con la versión de saltos (1, 2, 4, 8, 16…) desde 0: el 8 choca, el 16
    // choca, y el 9 —libre— no se prueba jamás.
    const servidor = servidorConValoresTomados([1, 2, 4, 8, 16])
    const r = await escribirEnElPrimerValorLibre(8, servidor.escribir)
    expect(r.valor).toBe(9)
    expect(r.intentos).toBe(2)
  })

  it('NO reintenta ante un código que no sea 409', async () => {
    // Un 403 de RLS o un 400 de validación no se arreglan cambiando el número.
    // Reintentarlos gastaría intentos y escondería la causa real.
    const intentados: number[] = []
    const r = await escribirEnElPrimerValorLibre(1, async valor => {
      intentados.push(valor)
      return { status: () => 403 }
    })
    expect(r.intentos).toBe(1)
    expect(r.respuesta.status()).toBe(403)
    expect(intentados).toEqual([1])
  })

  it('se rinde tras el máximo de intentos y DEVUELVE el 409, no lo esconde', async () => {
    // Quien llama afirma el status: así el fallo dice «409» y cuántos valores
    // se probaron, en vez de un error propio que tape lo que respondió el
    // servidor.
    const servidor = servidorConValoresTomados([1, 2, 3])
    const r = await escribirEnElPrimerValorLibre(1, servidor.escribir, 3)
    expect(r.intentos).toBe(3)
    expect(r.respuesta.status()).toBe(409)
    expect(servidor.intentados).toEqual([1, 2, 3])
  })

  it('empieza EXACTAMENTE en el valor pedido: el máximo medido no se ajusta por las dudas', async () => {
    // El punto de partida sale de maxLecturaDeContador + 1. Si esta función
    // añadiera un margen «por si acaso», el consumo del sandbox crecería sin
    // motivo y el valor dejaría de ser reproducible.
    const servidor = servidorConValoresTomados([])
    await escribirEnElPrimerValorLibre(4321, servidor.escribir)
    expect(servidor.intentados).toEqual([4321])
  })
})

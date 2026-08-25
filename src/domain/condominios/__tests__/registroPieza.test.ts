// El doble registro: un segundo clic en Guardar mientras el aviso sigue en
// vuelo insertaba una pieza más.
//
// El escenario real: `setSaving(false)` corría justo después del INSERT, pero
// `avisarConReintento` viene DESPUÉS y puede tardar segundos (tres intentos con
// backoff) o quedarse esperando a que el operador conteste un diálogo. Durante
// todo ese rato el formulario seguía en pantalla con sus datos y el botón vivo.
// Aquí el INSERT se representa con una promesa diferida para poder pulsar dos
// veces exactamente en ese hueco.
import { describe, it, expect, vi } from 'vitest'
import { crearRegistrador, type RegistroPiezaDeps } from '../registroPieza'

/** Promesa que se resuelve cuando el test quiera. */
function diferida<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>(r => { resolver = r })
  return { promesa, resolver }
}

function deps(over: Partial<RegistroPiezaDeps> = {}): RegistroPiezaDeps {
  return {
    crear: async () => ({ id: 'p1', error: null }),
    cerrar: vi.fn(),
    onError: vi.fn(),
    ...over,
  }
}

describe('crearRegistrador', () => {
  it('el camino feliz: crea, cierra el formulario y luego avisa', async () => {
    const orden: string[] = []
    const registrar = crearRegistrador()
    const r = await registrar(deps({
      crear: async () => { orden.push('crear'); return { id: 'p1', error: null } },
      cerrar: () => { orden.push('cerrar') },
      avisar: async () => { orden.push('avisar') },
    }))
    expect(r).toEqual({ estado: 'guardado', id: 'p1' })
    // El orden ES el arreglo: cerrar DESPUÉS del insert y ANTES del aviso.
    expect(orden).toEqual(['crear', 'cerrar', 'avisar'])
  })

  it('DOBLE CLIC con el INSERT en vuelo: solo inserta una vez', async () => {
    const { promesa, resolver } = diferida<{ id: string | null; error: string | null }>()
    const crear = vi.fn(() => promesa)
    const registrar = crearRegistrador()

    const primero = registrar(deps({ crear }))
    const segundo = registrar(deps({ crear }))   // el operador vuelve a pulsar

    expect(await segundo).toEqual({ estado: 'ocupado' })
    expect(crear, 'el segundo clic no debe llegar a la base').toHaveBeenCalledTimes(1)

    resolver({ id: 'p1', error: null })
    expect(await primero).toEqual({ estado: 'guardado', id: 'p1' })
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('DOBLE CLIC mientras se AVISA (el hueco real): tampoco inserta de nuevo', async () => {
    // Este es el caso que estaba roto: el INSERT ya terminó, el aviso no.
    const { promesa: avisoLento, resolver: terminarAviso } = diferida<void>()
    const crear = vi.fn(async () => ({ id: 'p1', error: null }))
    const registrar = crearRegistrador()

    const primero = registrar(deps({ crear, avisar: () => avisoLento }))
    await Promise.resolve()   // deja correr el INSERT, no el aviso

    expect(await registrar(deps({ crear }))).toEqual({ estado: 'ocupado' })
    expect(crear).toHaveBeenCalledTimes(1)

    terminarAviso()
    await primero
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('reintentar el aviso NO repite el INSERT', async () => {
    // `avisarConReintento` reintenta por dentro tantas veces como haga falta;
    // el registrador no lo sabe ni le importa: el INSERT ya pasó.
    const crear = vi.fn(async () => ({ id: 'p1', error: null }))
    let intentos = 0
    const registrar = crearRegistrador()
    await registrar(deps({
      crear,
      avisar: async () => { intentos = 3 },   // tres reintentos dentro del aviso
    }))
    expect(intentos).toBe(3)
    expect(crear).toHaveBeenCalledTimes(1)
  })

  it('tras terminar, el formulario vuelve a poder guardar', async () => {
    const crear = vi.fn(async () => ({ id: 'p1', error: null }))
    const registrar = crearRegistrador()
    await registrar(deps({ crear }))
    await registrar(deps({ crear }))
    expect(crear, 'el cerrojo se suelta al terminar').toHaveBeenCalledTimes(2)
  })

  it('si el INSERT falla: informa, no cierra el formulario y libera el cerrojo', async () => {
    const cerrar = vi.fn()
    const onError = vi.fn()
    const registrar = crearRegistrador()
    const r = await registrar(deps({
      crear: async () => ({ id: null, error: 'duplicate key value violates unique constraint' }),
      cerrar, onError,
    }))
    expect(r).toEqual({ estado: 'error', mensaje: 'duplicate key value violates unique constraint' })
    expect(cerrar, 'los datos tecleados no se pierden si no se guardaron').not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('duplicate key value violates unique constraint')

    // Y se puede reintentar.
    const crear = vi.fn(async () => ({ id: 'p2', error: null }))
    expect(await registrar(deps({ crear }))).toEqual({ estado: 'guardado', id: 'p2' })
  })

  it('un INSERT sin error pero sin id tampoco se da por bueno', async () => {
    const onError = vi.fn()
    const registrar = crearRegistrador()
    const r = await registrar(deps({ crear: async () => ({ id: null, error: null }), onError }))
    expect(r.estado).toBe('error')
    expect(onError).toHaveBeenCalled()
  })

  it('sin `avisar` usa `onSinAviso` (salida, o pieza a la administración)', async () => {
    const onSinAviso = vi.fn()
    const registrar = crearRegistrador()
    await registrar(deps({ avisar: undefined, onSinAviso }))
    expect(onSinAviso).toHaveBeenCalledWith('p1')
  })

  it('si el aviso revienta, el cerrojo se suelta igual', async () => {
    const registrar = crearRegistrador()
    await expect(
      registrar(deps({ avisar: async () => { throw new Error('boom') } })),
    ).rejects.toThrow('boom')

    const crear = vi.fn(async () => ({ id: 'p2', error: null }))
    expect(await registrar(deps({ crear }))).toEqual({ estado: 'guardado', id: 'p2' })
  })
})

// Búsqueda de clientes de los selectores: sin acentos ni mayúsculas, todas las
// palabras en cualquier orden, números por sus dígitos y orden por relevancia.
import { describe, it, expect } from 'vitest'
import { buscarClientes, normalizarTexto, type ClienteBuscable } from '../busqueda'

const c = (id: string, nombre: string, codigo: string, extra: Partial<ClienteBuscable> = {}): ClienteBuscable =>
  ({ id, nombre, codigo, ...extra })

const lista: ClienteBuscable[] = [
  c('1', 'SERGIO RENATO ESTRADA HERNANDEZ', 'CLI-066'),
  c('2', 'Condominio Viñas del sur', 'CLI-112'),
  c('3', 'Byron Antonio Lopez Rodriguez', 'CVI-001', { telefono: '2310-5905', email: 'test@prestadora.com' }),
  c('4', 'Arminda Beatriz Cifuentes Areas', 'CVI-002'),
  c('5', 'Oscar López', 'CLI-116', { cui_dui: '2589 61234 0101', numero_facturacion: '1234567-8' }),
  c('6', 'Eva Maria Peña', 'CLI-113'),
  c('7', 'Óscar Solares', 'CLI-115'),
]
const ids = (r: ClienteBuscable[]) => r.map(x => x.id)

describe('normalizarTexto', () => {
  it('quita acentos, eñes y mayúsculas, y colapsa espacios', () => {
    expect(normalizarTexto('  Óscar   PEÑA López ')).toBe('oscar pena lopez')
    expect(normalizarTexto(null)).toBe('')
  })
})

describe('buscarClientes', () => {
  it('sin texto devuelve todos en orden alfabético sin distinguir mayúsculas', () => {
    expect(ids(buscarClientes(lista, '   '))).toEqual(['4', '3', '2', '6', '5', '7', '1'])
  })

  it('no distingue acentos en ningún sentido', () => {
    expect(ids(buscarClientes(lista, 'lopez'))).toEqual(['3', '5'])
    expect(ids(buscarClientes(lista, 'LÓPEZ'))).toEqual(['3', '5'])
    expect(ids(buscarClientes(lista, 'vinas'))).toEqual(['2'])
    expect(ids(buscarClientes(lista, 'pena'))).toEqual(['6'])
  })

  it('exige todas las palabras, en cualquier orden', () => {
    expect(ids(buscarClientes(lista, 'lopez byron'))).toEqual(['3'])
    expect(ids(buscarClientes(lista, 'oscar lopez'))).toEqual(['5'])
    expect(buscarClientes(lista, 'byron solares')).toEqual([])
  })

  it('busca por código, correo, DPI y NIT', () => {
    expect(ids(buscarClientes(lista, 'cli-066'))).toEqual(['1'])
    expect(ids(buscarClientes(lista, '066'))).toEqual(['1'])
    expect(ids(buscarClientes(lista, 'prestadora.com'))).toEqual(['3'])
    expect(ids(buscarClientes(lista, '1234567-8'))).toEqual(['5'])
  })

  it('compara los números por sus dígitos, con o sin espacios y guiones', () => {
    expect(ids(buscarClientes(lista, '23105905'))).toEqual(['3'])
    expect(ids(buscarClientes(lista, '2310 5905'))).toEqual(['3'])
    expect(ids(buscarClientes(lista, '2310-5905'))).toEqual(['3'])
    expect(ids(buscarClientes(lista, '2589612340101'))).toEqual(['5'])
  })

  it('ordena por relevancia: código exacto, nombre que empieza así, palabra que empieza así, el resto', () => {
    const l = [
      c('a', 'Zoila Carmen', 'CLI-200'),
      c('b', 'Carmen Ruiz', 'CLI-201'),
      c('c', 'Ana Carmen', 'CLI-202'),
      c('d', 'Encarmen Ola', 'CARMEN'),
    ]
    expect(ids(buscarClientes(l, 'carmen'))).toEqual(['d', 'b', 'c', 'a'])
  })

  it('no modifica la lista recibida', () => {
    const copia = [...lista]
    buscarClientes(lista, '')
    buscarClientes(lista, 'o')
    expect(lista).toEqual(copia)
  })
})

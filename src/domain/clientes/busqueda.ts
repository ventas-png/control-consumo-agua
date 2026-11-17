// Búsqueda de clientes para los selectores (asignar cliente a una unidad, etc.).
//
// Filtra una lista que ya está en memoria: no consulta la base ni decide nada.
// La búsqueda no distingue mayúsculas ni acentos («lopez» encuentra «López»).
// Cada palabra escrita debe aparecer en algún dato del cliente, en cualquier
// orden: «byron lopez» encuentra a «Byron Antonio López Rodríguez». Un número
// se compara solo por sus dígitos, así que «2310-5905» encuentra el teléfono
// 23105905.
import type { Cliente } from '../../types'

export type ClienteBuscable = Pick<Cliente, 'id' | 'nombre' | 'codigo'> &
  Partial<Pick<Cliente, 'email' | 'telefono' | 'whatsapp' | 'telefono_alterno' | 'cui_dui' | 'numero_facturacion'>>

/** Minúsculas, sin acentos ni diéresis, espacios colapsados. */
export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** Datos por los que se busca: los de texto y los números (teléfonos, DPI, NIT) como dígitos. */
function camposDe(c: ClienteBuscable): { texto: string; digitos: string[] } {
  const texto = [c.nombre, c.codigo, c.email, c.cui_dui, c.numero_facturacion]
    .map(normalizarTexto)
    .filter(Boolean)
    .join(' ')
  const digitos = [c.telefono, c.whatsapp, c.telefono_alterno, c.cui_dui, c.numero_facturacion]
    .map(soloDigitos)
    .filter(Boolean)
  return { texto, digitos }
}

function coincide(c: ClienteBuscable, palabras: string[], numero: string): boolean {
  const { texto, digitos } = camposDe(c)
  // Un número escrito con espacios o guiones («2310 5905») se busca entero.
  if (numero.length >= 3 && digitos.some(d => d.includes(numero))) return true
  return palabras.every(p => {
    if (texto.includes(p)) return true
    const d = soloDigitos(p)
    return d.length >= 3 && d === p.replace(/[\s-]/g, '') && digitos.some(x => x.includes(d))
  })
}

/**
 * Orden de los resultados: primero el código exacto, luego los nombres que
 * empiezan por lo escrito, luego los que tienen alguna palabra que empieza
 * así, y al final el resto. Dentro de cada grupo, alfabético.
 */
function rango(c: ClienteBuscable, consulta: string, primera: string): number {
  if (normalizarTexto(c.codigo) === consulta) return 0
  const nombre = normalizarTexto(c.nombre)
  if (nombre.startsWith(consulta)) return 1
  if (nombre.split(' ').some(w => w.startsWith(primera))) return 2
  return 3
}

const alfabetico = (a: ClienteBuscable, b: ClienteBuscable) =>
  a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })

/** Filtra y ordena. Sin texto, devuelve todos en orden alfabético. */
export function buscarClientes<T extends ClienteBuscable>(lista: readonly T[], texto: string): T[] {
  const consulta = normalizarTexto(texto)
  if (consulta === '') return [...lista].sort(alfabetico)
  const palabras = consulta.split(' ')
  const numero = /^[\d\s-]+$/.test(consulta) ? soloDigitos(consulta) : ''
  return lista
    .filter(c => coincide(c, palabras, numero))
    .map(c => ({ c, r: rango(c, consulta, palabras[0]) }))
    .sort((a, b) => a.r - b.r || alfabetico(a.c, b.c))
    .map(x => x.c)
}


// cond:C9 — Tipos por dominio. Cada dominio vive en su propio archivo y se
// re-exporta aquí para preservar `import { Cliente, CuotaCondominio } from
// '@/types'` ya existente. Código nuevo puede importar directo desde el
// archivo del dominio (preferido).
export * from './agua'
export * from './comunicacion'
export * from './pagos'
export * from './energia'
export * from './plataforma'
export * from './condominios'

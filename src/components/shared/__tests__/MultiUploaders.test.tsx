// MultiImageUploader y MultiFileUploader: la lista que devuelven es siempre la
// vigente (dos acciones seguidas no se pisan con una lista vieja), quitar saca
// de la lista ANTES de borrar del bucket, `borrarAlQuitar={false}` no borra,
// `onSubiendo` avisa de la subida y la casilla de agregar se usa con teclado.
// ImageGallery: miniaturas con nombre y Escape que cierra sólo la foto.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useState } from 'react'

const mocks = vi.hoisted(() => ({
  removeMedia: vi.fn(async (_bucket: string, _paths: string[]) => ({ error: null as string | null })),
  removeCondominiosMedia: vi.fn(async (_paths: string[]) => ({ error: null as string | null })),
  uploadMedia: vi.fn(),
  uploadCondominiosMedia: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/shared/storage', () => ({
  removeMedia: mocks.removeMedia,
  removeCondominiosMedia: mocks.removeCondominiosMedia,
  uploadMedia: mocks.uploadMedia,
  uploadCondominiosMedia: mocks.uploadCondominiosMedia,
}))
vi.mock('../../../lib/fileValidation', () => ({
  validateFileMagic: vi.fn(async () => ({ ok: true, detected: 'image/jpeg' })),
  buildUploadPath: (carpeta: string, nombre: string) => `${carpeta}/${nombre}`,
  resolveUploadContentType: () => 'application/pdf',
}))
vi.mock('../../../lib/imageCompress', () => ({ compressImage: vi.fn(async (f: File) => f) }))
vi.mock('../../../lib/platform', () => ({ isNative: () => false }))
vi.mock('../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
vi.mock('../MediaScopeContext', () => ({ useMediaScope: () => 'p1' }))
vi.mock('../SecureImage', () => ({ SecureImage: ({ alt }: { alt: string }) => <img alt={alt} /> }))
vi.mock('../SecureFileLink', () => ({ SecureFileLink: ({ children }: { children: React.ReactNode }) => <a href="#x">{children}</a> }))

const { MultiImageUploader } = await import('../ImageUploader')
const { MultiFileUploader } = await import('../FileUploader')
const { ImageGallery } = await import('../ImageGallery')

/** Una promesa que el test resuelve cuando quiere: simula la latencia de Storage. */
function diferida<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>(r => { resolver = r })
  return { promesa, resolver }
}

/** Padre real: guarda lo que el uploader devuelve, como el asistente de minutas. */
function ConEstado({ inicial, tipo, ...rest }: { inicial: string[]; tipo: 'foto' | 'doc'; borrarAlQuitar?: boolean; onSubiendo?: (v: boolean) => void; espia?: (v: string[]) => void }) {
  const [values, setValues] = useState(inicial)
  const onChange = (v: string[]) => { rest.espia?.(v); setValues(v) }
  return tipo === 'foto'
    ? <MultiImageUploader values={values} onChange={onChange} folder="minutas" borrarAlQuitar={rest.borrarAlQuitar} onSubiendo={rest.onSubiendo} />
    : <MultiFileUploader values={values} onChange={onChange} folder="minutas" maxFiles={4} borrarAlQuitar={rest.borrarAlQuitar} onSubiendo={rest.onSubiendo} />
}

const archivo = (nombre: string, tipo = 'image/jpeg') => new File(['x'], nombre, { type: tipo })
const elegir = (input: HTMLInputElement, files: File[]) => fireEvent.change(input, { target: { files } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.removeMedia.mockReset().mockResolvedValue({ error: null })
  mocks.removeCondominiosMedia.mockReset().mockResolvedValue({ error: null })
  mocks.uploadMedia.mockResolvedValue({ error: null })
  mocks.uploadCondominiosMedia.mockImplementation(async (path: string) => ({ data: { path }, error: null }))
})
afterEach(() => cleanup())

describe('MultiImageUploader', () => {
  it('quitar dos fotos seguidas antes de que responda Storage no revive la primera', async () => {
    const borrados = [diferida<{ error: null }>(), diferida<{ error: null }>()]
    let n = 0
    mocks.removeMedia.mockImplementation(() => borrados[n++].promesa)
    const espia = vi.fn()
    render(<ConEstado tipo="foto" inicial={['p1/minutas/a.jpg', 'p1/minutas/b.jpg', 'p1/minutas/c.jpg']} espia={espia} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto 1 de 3' }))
    // Sale de la lista al instante, antes de que Storage conteste.
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/b.jpg', 'p1/minutas/c.jpg'])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto 1 de 2' }))
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/c.jpg'])
    await act(async () => { borrados[0].resolver({ error: null }); borrados[1].resolver({ error: null }) })
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/c.jpg'])
    expect(mocks.removeMedia.mock.calls.map(c => c[1])).toEqual([['p1/minutas/a.jpg'], ['p1/minutas/b.jpg']])
  })

  it('una subida que termina después de quitar otra foto no la revive', async () => {
    const subida = diferida<{ error: null }>()
    mocks.uploadMedia.mockReturnValueOnce(subida.promesa)
    const espia = vi.fn()
    const { container } = render(<ConEstado tipo="foto" inicial={['p1/minutas/s1.jpg', 'p1/minutas/n1.jpg']} espia={espia} />)
    elegir(container.querySelector('input[type=file]')!, [archivo('n2.jpg')])
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto 2 de 2' }))
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/s1.jpg'])
    await act(async () => { subida.resolver({ error: null }) })
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/s1.jpg', 'p1/minutas/n2.jpg'])
  })

  it('con borrarAlQuitar={false} sólo la saca de la lista; onSubiendo avisa inicio y fin', async () => {
    const onSubiendo = vi.fn()
    const espia = vi.fn()
    const { container } = render(<ConEstado tipo="foto" inicial={['p1/minutas/a.jpg']} borrarAlQuitar={false} onSubiendo={onSubiendo} espia={espia} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar foto 1 de 1' }))
    await act(async () => {})
    expect(espia).toHaveBeenLastCalledWith([])
    expect(mocks.removeMedia).not.toHaveBeenCalled()

    elegir(container.querySelector('input[type=file]')!, [archivo('b.jpg')])
    await act(async () => {})
    expect(onSubiendo.mock.calls).toEqual([[true], [false]])
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/b.jpg'])
  })

  it('la casilla de agregar es un botón con nombre que se abre con Enter o Espacio', () => {
    const { container } = render(<ConEstado tipo="foto" inicial={['p1/minutas/a.jpg']} />)
    const agregar = screen.getByRole('button', { name: 'Agregar fotos (1 de 10)' })
    expect(agregar.tabIndex).toBe(0)
    const click = vi.spyOn(container.querySelector('input[type=file]') as HTMLInputElement, 'click')
    fireEvent.keyDown(agregar, { key: 'Enter' })
    fireEvent.keyDown(agregar, { key: ' ' })
    expect(click).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('img', { name: 'Foto 1' })).toBeTruthy()
  })

  it('quitar con el foco en la ✕ pasa el foco a la siguiente, no a <body>', () => {
    render(<ConEstado tipo="foto" inicial={['p1/minutas/a.jpg', 'p1/minutas/b.jpg']} borrarAlQuitar={false} />)
    const primera = screen.getByRole('button', { name: 'Quitar foto 1 de 2' })
    primera.focus()
    fireEvent.click(primera)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quitar foto 1 de 1' }))
    const ultima = screen.getByRole('button', { name: 'Quitar foto 1 de 1' })
    fireEvent.click(ultima)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Agregar fotos (0 de 10)' }))
  })
})

describe('MultiFileUploader', () => {
  it('quitar saca de la lista antes de borrar y la lista vigente sobrevive a dos quitas seguidas', async () => {
    const borrado = diferida<{ error: null }>()
    mocks.removeCondominiosMedia.mockReturnValueOnce(borrado.promesa)
    const espia = vi.fn()
    render(<ConEstado tipo="doc" inicial={['p1/minutas/acta.pdf', 'p1/minutas/cotizacion.xlsx']} espia={espia} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar acta.pdf' }))
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/cotizacion.xlsx'])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar cotizacion.xlsx' }))
    expect(espia).toHaveBeenLastCalledWith([])
    await act(async () => { borrado.resolver({ error: null }) })
    expect(espia).toHaveBeenLastCalledWith([])
  })

  it('con borrarAlQuitar={false} no borra; sube, avisa y se abre con teclado', async () => {
    const onSubiendo = vi.fn()
    const espia = vi.fn()
    const { container } = render(<ConEstado tipo="doc" inicial={['p1/minutas/acta.pdf']} borrarAlQuitar={false} onSubiendo={onSubiendo} espia={espia} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar acta.pdf' }))
    await act(async () => {})
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()

    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Adjuntar documentos (0 de 4)' }), { key: 'Enter' })
    expect(click).toHaveBeenCalledTimes(1)

    elegir(input, [archivo('contrato.pdf', 'application/pdf')])
    await act(async () => {})
    expect(onSubiendo.mock.calls).toEqual([[true], [false]])
    expect(espia).toHaveBeenLastCalledWith(['p1/minutas/contrato.pdf'])
  })
})

describe('ImageGallery', () => {
  const urls = ['p1/a.jpg', 'p1/b.jpg', 'p1/c.jpg']

  it('las miniaturas son botones con nombre; la última visible dice cuántas más hay', () => {
    render(<ImageGallery urls={urls} maxVisible={2} />)
    expect(screen.getByRole('button', { name: 'Ver foto 1 de 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver foto 2 de 3 (y 1 más)' })).toBeTruthy()
  })

  it('Escape cierra sólo la foto: no llega al modal que contiene la galería', () => {
    const delModal = vi.fn()
    const escuchar = (e: KeyboardEvent) => { if (!e.defaultPrevented) delModal() }
    document.addEventListener('keydown', escuchar)
    render(<ImageGallery urls={urls} />)
    const miniatura = screen.getByRole('button', { name: 'Ver foto 2 de 3' })
    miniatura.focus()
    fireEvent.click(miniatura)
    const foto = screen.getByRole('dialog', { name: 'Foto 2 de 3' })
    expect(document.activeElement).toBe(foto)
    expect(screen.getByRole('button', { name: 'Cerrar foto' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Foto siguiente' }))
    expect(screen.getByRole('dialog', { name: 'Foto 3 de 3' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(delModal).not.toHaveBeenCalled()
    // El foco vuelve a la miniatura que abrió la foto.
    expect(document.activeElement).toBe(miniatura)
    document.removeEventListener('keydown', escuchar)
  })
})

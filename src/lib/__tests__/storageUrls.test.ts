import { describe, it, expect } from 'vitest'
import { extractBucketPath } from '../extractBucketPath'

describe('extractBucketPath', () => {
  const bucket = 'condominios-media'

  it('devuelve el path para una publicUrl del bucket', () => {
    const url = 'https://nnsqmeigtgewatameexo.supabase.co/storage/v1/object/public/condominios-media/visitantes/123-abc.jpg'
    expect(extractBucketPath(url, bucket)).toBe('visitantes/123-abc.jpg')
  })

  it('devuelve el path para una signed URL del bucket (sin query)', () => {
    const url = 'https://x.supabase.co/storage/v1/object/sign/condominios-media/foo/bar.png?token=abc&exp=999'
    expect(extractBucketPath(url, bucket)).toBe('foo/bar.png')
  })

  it('null para URL de otro bucket', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/mudanza-docs/foo/bar.jpg'
    expect(extractBucketPath(url, bucket)).toBeNull()
  })

  it('null para URL externa (no es del storage layout)', () => {
    expect(extractBucketPath('https://cdn.externo.com/foo.jpg', bucket)).toBeNull()
  })

  it('asume bucket cuando recibe path bare', () => {
    expect(extractBucketPath('visitantes/x.jpg', bucket)).toBe('visitantes/x.jpg')
  })

  it('quita slashes iniciales en path bare', () => {
    expect(extractBucketPath('/visitantes/x.jpg', bucket)).toBe('visitantes/x.jpg')
  })

  it('decodifica %20 y otros encodings', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/condominios-media/foo/mi%20archivo.pdf'
    expect(extractBucketPath(url, bucket)).toBe('foo/mi archivo.pdf')
  })

  it('null para empty / undefined', () => {
    expect(extractBucketPath('', bucket)).toBeNull()
    expect(extractBucketPath(null, bucket)).toBeNull()
    expect(extractBucketPath(undefined, bucket)).toBeNull()
  })

  it('null para data: URI (base64) — caller debe pasarlo sin firmar', () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    expect(extractBucketPath(dataUri, bucket)).toBeNull()
  })
})

import { type CSSProperties, type ImgHTMLAttributes } from 'react'
import { useSignedUrl } from '../../lib/storageUrls'

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Bucket-relative path OR a legacy publicUrl pointing at the bucket. */
  src: string | null | undefined
  /** Default: 'condominios-media'. Other buckets (mudanza-docs, etc.) pass explicitly. */
  bucket?: string
  /** Optional shown while the signed URL is being fetched. */
  placeholder?: React.ReactNode
}

/**
 * Drop-in replacement for `<img>` whose `src` lives in a (possibly private)
 * Supabase Storage bucket. Re-signs the URL ~5 min before expiration so
 * long-open tabs keep working. See src/lib/storageUrls.ts for details.
 */
export function SecureImage({ src, bucket = 'condominios-media', placeholder = null, style, ...rest }: Props) {
  const url = useSignedUrl(src, bucket)
  if (!src) return null
  if (!url) return <>{placeholder}</>
  return <img src={url} style={style as CSSProperties} {...rest} />
}

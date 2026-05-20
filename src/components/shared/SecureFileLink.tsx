import { type AnchorHTMLAttributes, type ReactNode } from 'react'
import { useSignedUrl } from '../../lib/storageUrls'

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'> & {
  /** Bucket-relative path OR a legacy publicUrl pointing at the bucket. */
  src: string | null | undefined
  /** Default: 'condominios-media'. Other buckets pass explicitly. */
  bucket?: string
  /**
   * Anchor contents. Pass a render function to receive the signed URL so a
   * child <img> can reuse the same URL instead of signing it a second time.
   */
  children: ReactNode | ((signedUrl: string) => ReactNode)
}

/**
 * Anchor whose href points at a (possibly private) Supabase Storage object.
 * Signs the URL via useSignedUrl so the link keeps working after the S6 bucket
 * migration, which persists bare paths instead of public URLs. Renders nothing
 * until the signed URL resolves. See src/lib/storageUrls.ts for details.
 */
export function SecureFileLink({ src, bucket = 'condominios-media', children, ...rest }: Props) {
  const url = useSignedUrl(src, bucket)
  if (!src || !url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" {...rest}>
      {typeof children === 'function' ? children(url) : children}
    </a>
  )
}

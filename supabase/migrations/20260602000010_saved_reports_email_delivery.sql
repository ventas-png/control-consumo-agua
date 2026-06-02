-- ============================================================================
-- saved_reports email delivery — F4.5.1d
-- ============================================================================
-- 1. Storage bucket 'report-attachments' para guardar los archivos generados
--    antes de enviarlos por email. RLS per-tenant via path prefix.
-- 2. Seed template global 'saved_report_delivery' con HTML por defecto. Si la
--    company no tiene su propio template, send-email usa este (precedence ya
--    implementada en la edge function).
-- ============================================================================

-- ─── 1. Storage bucket ──────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-attachments', 'report-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Policy SELECT: el usuario puede leer archivos en su company prefix.
-- Path layout: {company_id}/{template_id}/{timestamp}.{format}
DROP POLICY IF EXISTS "report_attachments_select" ON storage.objects;
CREATE POLICY "report_attachments_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-attachments'
    AND (
      is_super_admin()
      OR (storage.foldername(name))[1] = get_my_company_id()::text
    )
  );

-- Policy INSERT: solo admin/owner sube reports a su propia carpeta.
DROP POLICY IF EXISTS "report_attachments_insert" ON storage.objects;
CREATE POLICY "report_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'report-attachments'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
    AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
  );

-- ─── 2. Seed template global 'saved_report_delivery' ────────────────────────
-- is_superadmin=true + company_id NULL = template global fallback.
INSERT INTO public.email_templates (company_id, is_superadmin, template_key, subject, html_body, is_active)
VALUES (
  NULL,
  true,
  'saved_report_delivery',
  'Reporte: {{report_name}}',
  $$
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
    <h1 style="color: #0f172a; font-size: 20px; margin: 0 0 8px;">📑 {{report_name}}</h1>
    <p style="color: #64748b; font-size: 13px; margin: 0 0 20px;">
      Reporte generado automáticamente el {{generated_at}}
    </p>

    <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
        <tr>
          <td style="color: #64748b; padding: 4px 0;">Filas:</td>
          <td style="color: #0f172a; font-weight: 600; text-align: right;">{{rows_count}}</td>
        </tr>
        <tr>
          <td style="color: #64748b; padding: 4px 0;">Formato:</td>
          <td style="color: #0f172a; font-weight: 600; text-align: right;">{{format}}</td>
        </tr>
        <tr>
          <td style="color: #64748b; padding: 4px 0;">Tabla fuente:</td>
          <td style="color: #0f172a; font-weight: 600; text-align: right;">{{source_table}}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="{{attachment_url}}"
         style="display: inline-block; background: #0d9488; color: white; padding: 12px 24px;
                border-radius: 8px; text-decoration: none; font-weight: 600;">
        📎 Descargar reporte
      </a>
    </div>

    <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 20px 0 0;">
      El enlace de descarga expira en 24 horas.<br />
      Este reporte fue configurado por el administrador de la empresa.
    </p>
  </div>
</body>
</html>
  $$,
  true
)
ON CONFLICT (company_id, template_key) DO UPDATE
  SET subject = EXCLUDED.subject,
      html_body = EXCLUDED.html_body,
      is_active = true,
      updated_at = now();

-- COMMENT ON POLICY ON storage.objects requiere ownership de la tabla, que
-- el rol de Supabase Preview no tiene. Envuelto en DO block tolerant para no
-- romper preview branches (es metadata; en prod ya esta aplicada via service
-- role).
DO $$
BEGIN
  EXECUTE $cmt$
    COMMENT ON POLICY "report_attachments_select" ON storage.objects IS
      'F4.5.1d — usuario puede leer reportes de su company. Path prefix = company_id.';
  $cmt$;
  EXECUTE $cmt$
    COMMENT ON POLICY "report_attachments_insert" ON storage.objects IS
      'F4.5.1d — admin/owner puede subir reportes a la carpeta de su company.';
  $cmt$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'COMMENT ON POLICY storage.objects skipped (no ownership en este rol)';
END $$;

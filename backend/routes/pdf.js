const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth } = require('../middleware/auth');
const { generateReportePDF } = require('../services/pdf');

// GET /api/pdf/reporte
router.get('/reporte', requireAuth, async (req, res) => {
  const [{ data: registros, error: regError }, { data: empresa }] = await Promise.all([
    supabase.from('registros').select('*').order('fecha', { ascending: false }),
    supabase.from('empresa').select('*').limit(1).single().catch(() => ({ data: null }))
  ]);

  if (regError) return res.status(500).json({ error: regError.message });

  const filename = `reporte_agua_${new Date().toISOString().split('T')[0]}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = generateReportePDF(registros || [], empresa || {});
  doc.pipe(res);
  doc.end();
});

module.exports = router;

const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/empresa
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('empresa').select('*').limit(1).single();
  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }
  res.json(data || {});
});

// PUT /api/empresa
router.put('/', requireAuth, requireRole(['admin']), async (req, res) => {
  const { id, ...updates } = req.body;
  let result;

  if (id) {
    const { data, error } = await supabase
      .from('empresa')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  } else {
    const { data, error } = await supabase
      .from('empresa')
      .insert(updates)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  }

  res.json(result);
});

module.exports = router;

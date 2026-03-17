const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /api/clientes
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('clientes').select('*').order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/clientes
router.post('/', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
  const { nombre, codigo, medidor, email, direccion, telefono, tarifa, canon, lectura_inicial } = req.body;

  if (!nombre || nombre.length < 2) {
    return res.status(400).json({ error: 'Nombre debe tener al menos 2 caracteres' });
  }
  if (!codigo || codigo.length < 3) {
    return res.status(400).json({ error: 'Código debe tener al menos 3 caracteres' });
  }

  const { data, error } = await supabase
    .from('clientes')
    .insert({
      nombre: nombre.trim(),
      codigo: codigo.trim(),
      medidor: medidor?.trim() || null,
      email: email?.trim() || null,
      direccion: direccion?.trim() || null,
      telefono: telefono?.trim() || null,
      tarifa: parseFloat(tarifa) || 0,
      canon: parseFloat(canon) || 0,
      lectura_inicial: parseFloat(lectura_inicial) || 0
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('security_logs').insert({
    user_id: req.session.user.id,
    event_type: 'client_created',
    details: { cliente_codigo: codigo },
    ip_address: req.ip
  }).catch(() => {});

  res.status(201).json(data);
});

// DELETE /api/clientes/:id
router.delete('/:id', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from('clientes').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('security_logs').insert({
    user_id: req.session.user.id,
    event_type: 'client_deleted',
    details: { cliente_id: id },
    ip_address: req.ip
  }).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;

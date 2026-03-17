// Client portal routes — authenticated as role='cliente'
// Clients can view their readings, history, and register/pay bills.
const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const clienteOnly = [requireAuth, requireRole(['cliente'])];

// GET /api/portal/me — current client profile + pending balance
router.get('/me', ...clienteOnly, async (req, res) => {
  const { cliente_id } = req.session.user;

  const [clienteRes, registrosRes] = await Promise.all([
    supabase.from('clientes').select('*').eq('id', cliente_id).single(),
    supabase
      .from('registros')
      .select('id, fecha, mes, consumo, monto_calculado, tipo_cobro, estado, lectura_anterior, lectura_actual')
      .eq('cliente_id', cliente_id)
      .order('fecha', { ascending: false })
      .limit(12)
  ]);

  if (clienteRes.error) return res.status(404).json({ error: 'Cliente no encontrado' });

  const saldoPendiente = (registrosRes.data || [])
    .filter(r => r.estado === 'pendiente' || r.estado === 'mora')
    .reduce((acc, r) => acc + parseFloat(r.monto_calculado || 0), 0);

  res.json({
    cliente: clienteRes.data,
    lecturas: registrosRes.data || [],
    saldo_pendiente: saldoPendiente.toFixed(2)
  });
});

// GET /api/portal/lecturas — paginated reading history
router.get('/lecturas', ...clienteOnly, async (req, res) => {
  const { cliente_id } = req.session.user;
  const page  = Math.max(0, parseInt(req.query.page  || '0'));
  const limit = Math.min(50, parseInt(req.query.limit || '12'));

  const { data, error, count } = await supabase
    .from('registros')
    .select('*', { count: 'exact' })
    .eq('cliente_id', cliente_id)
    .order('fecha', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (error) return res.status(500).json({ error: 'Error al obtener lecturas' });
  res.json({ lecturas: data, total: count, page, limit });
});

// GET /api/portal/pagos — payment history
router.get('/pagos', ...clienteOnly, async (req, res) => {
  const { cliente_id } = req.session.user;
  const { data, error } = await supabase
    .from('pagos')
    .select('*')
    .eq('cliente_id', cliente_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al obtener pagos' });
  res.json({ pagos: data });
});

// POST /api/portal/pagos/boleta — client uploads payment receipt
router.post('/pagos/boleta', ...clienteOnly, async (req, res) => {
  const { cliente_id } = req.session.user;
  const { registro_id, monto, referencia, boleta_base64, notas } = req.body;

  if (!monto || !boleta_base64) {
    return res.status(400).json({ error: 'monto y boleta_base64 son requeridos' });
  }
  if (parseFloat(monto) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  }

  // Verify registro belongs to this client (if provided)
  if (registro_id) {
    const { data: reg } = await supabase
      .from('registros').select('id').eq('id', registro_id).eq('cliente_id', cliente_id).single();
    if (!reg) return res.status(403).json({ error: 'Registro no pertenece a este cliente' });
  }

  const { data, error } = await supabase
    .from('pagos')
    .insert({
      registro_id: registro_id || null,
      cliente_id,
      monto: parseFloat(monto),
      metodo: 'transferencia',
      referencia,
      boleta_url: boleta_base64,   // stored as base64; move to Supabase Storage in production
      estado: 'pendiente',
      notas
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Error al registrar boleta' });
  res.status(201).json({ pago: data });
});

// POST /api/portal/pagos/paypal/create — create a PayPal order
router.post('/pagos/paypal/create', ...clienteOnly, async (req, res) => {
  const { cliente_id } = req.session.user;
  const { registro_id, monto } = req.body;

  if (!monto || parseFloat(monto) <= 0) {
    return res.status(400).json({ error: 'monto inválido' });
  }

  const PAYPAL_CLIENT_ID     = process.env.PAYPAL_CLIENT_ID;
  const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
  const PAYPAL_BASE          = process.env.PAYPAL_SANDBOX === 'true'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'PayPal no configurado en el servidor' });
  }

  try {
    // Get access token
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64'),
        'Content-Type':  'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('PayPal token failed');

    // Create order
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: parseFloat(monto).toFixed(2) },
          description: 'Pago de consumo de agua'
        }]
      })
    });
    const order = await orderRes.json();
    if (!order.id) throw new Error('PayPal order creation failed');

    // Store pending payment record
    await supabase.from('pagos').insert({
      registro_id: registro_id || null,
      cliente_id,
      monto: parseFloat(monto),
      metodo: 'paypal',
      paypal_order_id: order.id,
      estado: 'pendiente'
    }).catch(() => {});

    res.json({ order_id: order.id });
  } catch (err) {
    console.error('PayPal create error:', err);
    res.status(500).json({ error: 'Error al crear orden PayPal' });
  }
});

// POST /api/portal/pagos/paypal/capture — capture a PayPal order after approval
router.post('/pagos/paypal/capture', ...clienteOnly, async (req, res) => {
  const { cliente_id } = req.session.user;
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id requerido' });

  const PAYPAL_CLIENT_ID     = process.env.PAYPAL_CLIENT_ID;
  const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
  const PAYPAL_BASE          = process.env.PAYPAL_SANDBOX === 'true'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  try {
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64'),
        'Content-Type':  'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();

    const captureRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${order_id}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type':  'application/json'
      }
    });
    const captured = await captureRes.json();

    if (captured.status === 'COMPLETED') {
      // Update payment record
      await supabase
        .from('pagos')
        .update({ estado: 'verificado' })
        .eq('paypal_order_id', order_id)
        .eq('cliente_id', cliente_id);

      // Mark the linked registro as paid if exists
      const { data: pago } = await supabase
        .from('pagos').select('registro_id').eq('paypal_order_id', order_id).single();
      if (pago?.registro_id) {
        await supabase
          .from('registros')
          .update({ estado: 'pagado' })
          .eq('id', pago.registro_id);
      }

      return res.json({ ok: true, status: 'COMPLETED' });
    }
    res.status(400).json({ error: 'El pago no fue completado', status: captured.status });
  } catch (err) {
    console.error('PayPal capture error:', err);
    res.status(500).json({ error: 'Error al capturar pago PayPal' });
  }
});

module.exports = router;

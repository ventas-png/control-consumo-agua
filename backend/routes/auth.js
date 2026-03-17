const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { loginLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/email');

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password
  });

  if (error || !data?.session) {
    await supabase.from('security_logs').insert({
      event_type: 'failed_login',
      details: { email, reason: error?.message },
      ip_address: req.ip,
      user_agent: req.headers['user-agent']
    }).catch(() => {});
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const { data: profile } = await supabase
    .from('app_users')
    .select('full_name, role')
    .eq('id', data.user.id)
    .single();

  const dbRole = profile?.role || 'visor';
  let role = dbRole;
  if (dbRole === 'operador') role = 'operator';
  if (dbRole === 'visor') role = 'viewer';

  req.session.user = {
    id: data.user.id,
    email: data.user.email,
    name: profile?.full_name || data.user.email,
    role,
    dbRole,
    loginTime: new Date().toISOString()
  };

  await supabase.from('security_logs').insert({
    user_id: data.user.id,
    event_type: 'login_success',
    details: { email },
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  }).catch(() => {});

  res.json({ user: req.session.user });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  const userId = req.session.user?.id;
  if (userId) {
    await supabase.from('security_logs').insert({
      user_id: userId,
      event_type: 'logout',
      details: {},
      ip_address: req.ip,
      user_agent: req.headers['user-agent']
    }).catch(() => {});
  }
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not log out' });
    res.clearCookie('agua.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: req.session.user });
});

// POST /api/auth/password-reset/request
router.post('/password-reset/request', passwordResetLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const { data, error } = await supabase.rpc('request_password_reset', {
    email_input: email.toLowerCase().trim(),
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  });

  // Always respond success to prevent email enumeration
  if (!error && data?.success && data?.token) {
    sendPasswordResetEmail(email, data.token, req).catch(err =>
      console.error('Password reset email failed:', err)
    );
  }

  res.json({ success: true });
});

// POST /api/auth/password-reset/validate
router.post('/password-reset/validate', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const { data, error } = await supabase.rpc('validate_reset_token', { token_input: token });

  if (error || !data?.valid) {
    return res.status(400).json({ valid: false });
  }
  res.json({ valid: true, email: data.email });
});

// POST /api/auth/password-reset/update
router.post('/password-reset/update', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password required' });
  }

  const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters with 1 uppercase letter and 1 number'
    });
  }

  // Validate token and get user_id
  const { data: tokenData, error: tokenError } = await supabase
    .from('password_reset_tokens')
    .select('user_id, email')
    .eq('token', token)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (tokenError || !tokenData) {
    return res.status(400).json({ error: 'Token inválido o expirado' });
  }

  // Update the actual password via Admin API
  const { error: updateError } = await supabase.auth.admin.updateUserById(
    tokenData.user_id,
    { password: newPassword }
  );

  if (updateError) {
    console.error('Password update error:', updateError);
    return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
  }

  // Mark token as used
  await supabase
    .from('password_reset_tokens')
    .update({ used: true })
    .eq('token', token);

  await supabase.from('security_logs').insert({
    user_id: tokenData.user_id,
    event_type: 'password_reset_completed',
    details: { email: tokenData.email },
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  }).catch(() => {});

  res.json({ success: true });
});

module.exports = router;

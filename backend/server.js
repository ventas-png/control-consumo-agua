require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const helmet = require('helmet');
const path = require('path');

const { csrfMiddleware } = require('./middleware/csrf');
const { generalLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const clientesRoutes = require('./routes/clientes');
const registrosRoutes = require('./routes/registros');
const empresaRoutes = require('./routes/empresa');
const pdfRoutes = require('./routes/pdf');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://cdn.jsdelivr.net',
        'https://cdnjs.cloudflare.com',
        'https://unpkg.com'
      ],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false // needed for map tiles
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ── Sessions ──────────────────────────────────────────────────────────────────
app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }),  // prune every 24h
  secret: process.env.SESSION_SECRET,
  name: 'agua.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000   // 8 hours
  }
}));

// ── Rate limiting + CSRF ──────────────────────────────────────────────────────
app.use('/api', generalLimiter);
app.use('/api', csrfMiddleware);

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/csrf-token', (req, res) => {
  // csrfMiddleware already ensured req.session.csrfToken exists
  res.json({ token: req.session.csrfToken });
});

app.use('/api/auth', authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/registros', registrosRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/pdf', pdfRoutes);

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL}`);
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const { initSqlJsDatabase, initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      frameSrc: ["https://js.stripe.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.stripe.com"]
    }
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/health', (req, res) => {
  try {
    const { getDb } = require('./database');
    const db = getDb();
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get();
    const admin = db.prepare('SELECT email FROM admins LIMIT 1').get();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      adminCount: adminCount?.count || 0,
      adminEmail: admin?.email || 'none'
    });
  } catch (error) {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), dbError: error.message });
  }
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/services/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/service.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// Tool pages
app.get('/tools/credit-calculator', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/tools/credit-calculator.html'));
});

app.get('/tools/business-name', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/tools/business-name.html'));
});

app.get('/tools/funding-quiz', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/tools/funding-quiz.html'));
});

// Contact page
app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/contact.html'));
});

// Login/Register pages
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/register.html'));
});

// 404 handler for non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>404 - Page Not Found</title>
      <style>
        body { font-family: 'Inter', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f7fafc; }
        .container { text-align: center; }
        h1 { font-size: 6rem; color: #1a365d; margin: 0; }
        p { color: #718096; margin: 1rem 0 2rem; }
        a { background: #1a365d; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; }
        a:hover { background: #2c5282; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>404</h1>
        <p>Page not found</p>
        <a href="/">Go Home</a>
      </div>
    </body>
    </html>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('Initializing database...');
    await initSqlJsDatabase();
    initializeDatabase();
    console.log('Database ready!');

    // Load routes after database is ready
    const authRoutes = require('./routes/auth');
    const serviceRoutes = require('./routes/services');
    const orderRoutes = require('./routes/orders');
    const leadRoutes = require('./routes/leads');
    const adminRoutes = require('./routes/admin');
    const paymentRoutes = require('./routes/payments');
    const documentRoutes = require('./routes/documents');
    const chatRoutes = require('./routes/chat');

    // API Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/services', serviceRoutes);
    app.use('/api/orders', orderRoutes);
    app.use('/api/leads', leadRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use('/api/documents', documentRoutes);
    app.use('/api/chat', chatRoutes);

    app.listen(PORT, () => {
      console.log(`His Secret Vault server running on port ${PORT}`);
      console.log(`Visit http://localhost:${PORT}`);
      console.log(`Admin: http://localhost:${PORT}/admin`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/hissecretvault.db');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db = null;
let SQL = null;

// Wrapper to provide better-sqlite3-like interface
class DatabaseWrapper {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        try {
          self.database.run(sql, params);
          return { changes: self.database.getRowsModified() };
        } catch (e) {
          console.error('SQL Error:', e.message, 'Query:', sql);
          throw e;
        }
      },
      get(...params) {
        try {
          const stmt = self.database.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        } catch (e) {
          console.error('SQL Error:', e.message, 'Query:', sql);
          throw e;
        }
      },
      all(...params) {
        try {
          const results = [];
          const stmt = self.database.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        } catch (e) {
          console.error('SQL Error:', e.message, 'Query:', sql);
          throw e;
        }
      }
    };
  }

  exec(sql) {
    try {
      this.database.exec(sql);
    } catch (e) {
      console.error('SQL Exec Error:', e.message);
      throw e;
    }
  }

  pragma(pragma) {
    try {
      this.database.exec(`PRAGMA ${pragma}`);
    } catch (e) {
      // Ignore pragma errors
    }
  }

  save() {
    const data = this.database.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// Initialize database
async function initSqlJsDatabase() {
  SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new DatabaseWrapper(new SQL.Database(buffer));
  } else {
    db = new DatabaseWrapper(new SQL.Database());
  }

  db.pragma('foreign_keys = ON');

  return db;
}

// Initialize database schema
function initializeDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initSqlJsDatabase() first.');
  }

  db.exec(`
    -- Users table (clients)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      email_verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );

    -- Admin users table
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    -- AI Modes (11 available modes)
    CREATE TABLE IF NOT EXISTS ai_modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      is_free INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    -- Subscription Plans (Basic, Pro, Plus)
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      billing_cycle TEXT DEFAULT 'monthly',
      included_modes TEXT,
      features TEXT,
      display_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    -- Pre-Made Bundles (Wealth Builder, Business Starter, etc.)
    CREATE TABLE IF NOT EXISTS bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      billing_cycle TEXT DEFAULT 'monthly',
      included_modes TEXT,
      features TEXT,
      display_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    -- Custom Bundle Pricing
    CREATE TABLE IF NOT EXISTS custom_bundle_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode_count INTEGER UNIQUE NOT NULL,
      price REAL NOT NULL,
      name TEXT NOT NULL
    );

    -- User Subscriptions (tracks which plan/bundle each user has)
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subscription_type TEXT NOT NULL,
      plan_id INTEGER,
      bundle_id INTEGER,
      custom_modes TEXT,
      stripe_subscription_id TEXT,
      stripe_customer_id TEXT,
      status TEXT DEFAULT 'active',
      current_period_start DATETIME,
      current_period_end DATETIME,
      cancel_at_period_end INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
      FOREIGN KEY (bundle_id) REFERENCES bundles(id)
    );

    -- Done-For-You Services Catalog
    CREATE TABLE IF NOT EXISTS dfy_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      features TEXT,
      process_steps TEXT,
      active INTEGER DEFAULT 1
    );

    -- Done-For-You Service Orders
    CREATE TABLE IF NOT EXISTS dfy_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      stripe_payment_id TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'pending',
      current_step INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (service_id) REFERENCES dfy_services(id)
    );

    -- Legacy services table (keeping for backwards compatibility)
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      price_min REAL NOT NULL,
      price_max REAL,
      billing_type TEXT DEFAULT 'one-time',
      features TEXT,
      active INTEGER DEFAULT 1
    );

    -- Legacy orders table (keeping for backwards compatibility)
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      stripe_payment_id TEXT,
      stripe_subscription_id TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    -- Order progress tracking (legacy)
    CREATE TABLE IF NOT EXISTS order_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- DFY Order progress tracking
    CREATE TABLE IF NOT EXISTS dfy_order_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dfy_order_id INTEGER NOT NULL,
      step_number INTEGER NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (dfy_order_id) REFERENCES dfy_orders(id)
    );

    -- Documents table
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      category TEXT,
      uploaded_by TEXT DEFAULT 'client',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- Leads table (from lead magnets)
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      source TEXT NOT NULL,
      quiz_results TEXT,
      credit_score_estimate INTEGER,
      business_name_checked TEXT,
      funding_eligibility TEXT,
      converted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Contact submissions
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'new',
      responded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Chat messages
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_id INTEGER,
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Email templates
    CREATE TABLE IF NOT EXISTS email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      trigger_event TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Email logs
    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      template_id INTEGER,
      subject TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES email_templates(id)
    );

    -- Revenue tracking
    CREATE TABLE IF NOT EXISTS revenue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT DEFAULT 'payment',
      stripe_payment_id TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- Sessions table for auth
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      admin_id INTEGER,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (admin_id) REFERENCES admins(id)
    );
  `);

  // Create indexes
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dfy_orders_user ON dfy_orders(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dfy_orders_status ON dfy_orders(status)`);
  } catch (e) {
    // Indexes might already exist
  }

  // Insert AI Modes (11 total)
  const aiModes = [
    ['General Chat', 'general-chat', 'Basic AI assistant for general questions', 1, 1],
    ['Social Media', 'social-media', 'AI-powered social media content creation', 0, 2],
    ['Marketing', 'marketing', 'Marketing strategy and content generation', 0, 3],
    ['Credit Mastery', 'credit-mastery', 'Credit repair guidance and strategy', 0, 4],
    ['Business Formation', 'business-formation', 'Business formation guidance and assistance', 0, 5],
    ['Get Funding', 'get-funding', 'Funding options and application assistance', 0, 6],
    ['AI for Business', 'ai-for-business', 'AI tools and strategies for business growth', 0, 7],
    ['eBook Creator', 'ebook-creator', 'AI-powered eBook creation and publishing', 0, 8],
    ['Tax Expert', 'tax-expert', 'Tax planning and strategy guidance', 0, 9],
    ['Real Estate', 'real-estate', 'Real estate investing and strategy', 0, 10],
    ['Investing', 'investing', 'Investment strategies and portfolio guidance', 0, 11]
  ];

  const insertMode = db.prepare(`
    INSERT OR IGNORE INTO ai_modes (name, slug, description, is_free, display_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  aiModes.forEach(mode => {
    try {
      insertMode.run(...mode);
    } catch (e) {
      // Mode might already exist
    }
  });

  // Insert Subscription Plans
  const subscriptionPlans = [
    [
      'Basic',
      'basic',
      'Perfect for getting started with AI assistance',
      14.99,
      'monthly',
      JSON.stringify(['general-chat', 'social-media', 'marketing']),
      JSON.stringify(['General Chat AI', 'Social Media Content', 'Marketing Assistant', '24/7 Access']),
      1
    ],
    [
      'Pro',
      'pro',
      'Everything in Basic plus business growth tools',
      49.99,
      'monthly',
      JSON.stringify(['general-chat', 'social-media', 'marketing', 'credit-mastery', 'business-formation']),
      JSON.stringify(['All Basic Features', 'Credit Mastery', 'Business Formation Guide', 'Priority Support', 'Advanced AI Models']),
      2
    ],
    [
      'Plus',
      'plus',
      'Complete access to all AI modes and premium features',
      79.99,
      'monthly',
      JSON.stringify(['general-chat', 'social-media', 'marketing', 'credit-mastery', 'business-formation', 'get-funding', 'ai-for-business', 'ebook-creator']),
      JSON.stringify(['All Pro Features', 'Get Funding AI', 'AI for Business', 'eBook Creator', 'Unlimited Conversations', 'VIP Support']),
      3
    ]
  ];

  const insertPlan = db.prepare(`
    INSERT OR IGNORE INTO subscription_plans (name, slug, description, price, billing_cycle, included_modes, features, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  subscriptionPlans.forEach(plan => {
    try {
      insertPlan.run(...plan);
    } catch (e) {
      // Plan might already exist
    }
  });

  // Insert Pre-Made Bundles
  const bundles = [
    [
      'Wealth Builder',
      'wealth-builder',
      'Master your finances and build lasting wealth',
      29,
      'monthly',
      JSON.stringify(['credit-mastery', 'tax-expert', 'investing', 'real-estate', 'get-funding']),
      JSON.stringify(['Credit Mastery', 'Tax Expert AI', 'Investing Strategies', 'Real Estate AI', 'Funding Guidance']),
      1
    ],
    [
      'Business Starter',
      'business-starter',
      'Everything you need to start and grow your business',
      25,
      'monthly',
      JSON.stringify(['business-formation', 'get-funding', 'marketing', 'tax-expert']),
      JSON.stringify(['Business Formation', 'Funding Access', 'Marketing Tools', 'Tax Planning', 'Business Grants Info']),
      2
    ],
    [
      'Content Creator',
      'content-creator',
      'Create engaging content across all platforms',
      19,
      'monthly',
      JSON.stringify(['social-media', 'marketing', 'ebook-creator', 'ai-for-business']),
      JSON.stringify(['Social Media AI', 'Marketing Content', 'eBook Creator', 'AI Business Tools', 'Content Calendar']),
      3
    ],
    [
      'Credit & Finance',
      'credit-finance',
      'Take control of your credit and financial future',
      22,
      'monthly',
      JSON.stringify(['credit-mastery', 'get-funding', 'tax-expert', 'investing']),
      JSON.stringify(['Credit Repair AI', 'Funding Options', 'Tax Strategies', 'Investment Guidance', 'Financial Planning']),
      4
    ]
  ];

  const insertBundle = db.prepare(`
    INSERT OR IGNORE INTO bundles (name, slug, description, price, billing_cycle, included_modes, features, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  bundles.forEach(bundle => {
    try {
      insertBundle.run(...bundle);
    } catch (e) {
      // Bundle might already exist
    }
  });

  // Insert Custom Bundle Pricing
  const customPricing = [
    [3, 19, 'Pick 3 Modes'],
    [5, 29, 'Pick 5 Modes'],
    [8, 39, 'Pick 8 Modes'],
    [11, 49, 'All 11 Modes']
  ];

  const insertCustomPricing = db.prepare(`
    INSERT OR IGNORE INTO custom_bundle_pricing (mode_count, price, name)
    VALUES (?, ?, ?)
  `);

  customPricing.forEach(pricing => {
    try {
      insertCustomPricing.run(...pricing);
    } catch (e) {
      // Pricing might already exist
    }
  });

  // Insert Done-For-You Services
  const dfyServices = [
    [
      'Business Formation',
      'business-formation',
      'done-for-you',
      'Complete business formation service with filing, EIN, and compliance setup',
      497,
      JSON.stringify(['State Filing', 'Operating Agreement', 'EIN Number', 'Registered Agent (1 Year)', 'Banking Setup Guidance', 'Compliance Calendar']),
      JSON.stringify(['Initial Consultation', 'Document Preparation', 'State Filing', 'EIN Application', 'Delivery & Setup'])
    ],
    [
      'Automated Credit Repair',
      'credit-repair-auto',
      'done-for-you',
      'Professional automated credit repair service with dispute management',
      500,
      JSON.stringify(['Credit Report Analysis', 'Automated Dispute Letters', 'Creditor Negotiations', 'Monthly Progress Reports', 'Credit Education', '90-Day Program']),
      JSON.stringify(['Credit Analysis', 'Strategy Development', 'Dispute Filing', 'Creditor Outreach', 'Progress Monitoring'])
    ],
    [
      'Funding Solutions',
      'funding-solutions',
      'done-for-you',
      'Complete funding package to secure business financing',
      697,
      JSON.stringify(['Funding Analysis', 'Lender Matching', 'Application Preparation', 'Credit Optimization', 'Up to $150K Funding', 'SBA Loan Assistance']),
      JSON.stringify(['Financial Assessment', 'Credit Review', 'Lender Matching', 'Application Support', 'Funding Acquisition'])
    ],
    [
      'Credit Repair Pro (B2B)',
      'credit-repair-b2b',
      'done-for-you',
      'White-label credit repair software for business clients',
      997,
      JSON.stringify(['White-Label Platform', 'Unlimited Clients', 'Automated Disputes', 'Client Portal', 'Reporting Dashboard', 'Training & Support']),
      JSON.stringify(['Platform Setup', 'Training', 'Client Onboarding', 'Ongoing Support', 'Monthly Reporting'])
    ]
  ];

  const insertDfyService = db.prepare(`
    INSERT OR IGNORE INTO dfy_services (name, slug, category, description, price, features, process_steps)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  dfyServices.forEach(service => {
    try {
      insertDfyService.run(...service);
    } catch (e) {
      // Service might already exist
    }
  });

  // Insert default services
  const services = [
    ['LLC Formation - Basic', 'llc-basic', 'business-formation', 'Start your business with our basic LLC formation package', 497, null, 'one-time', JSON.stringify(['State Filing', 'Operating Agreement', 'EIN Number', 'Basic Support'])],
    ['LLC Formation - Premium', 'llc-premium', 'business-formation', 'Complete LLC formation with all the bells and whistles', 997, null, 'one-time', JSON.stringify(['State Filing', 'Operating Agreement', 'EIN Number', 'Registered Agent (1 Year)', 'Business Bank Account Setup', 'Priority Support', 'Compliance Calendar'])],
    ['Corporation Formation', 'corp-formation', 'business-formation', 'Form your C-Corp or S-Corp with expert guidance', 697, 997, 'one-time', JSON.stringify(['State Filing', 'Articles of Incorporation', 'Bylaws', 'EIN Number', 'Stock Certificates', 'Corporate Minutes Template'])],
    ['Credit Repair - Standard', 'credit-repair-standard', 'credit-repair', 'Professional credit repair services to boost your score', 297, null, 'monthly', JSON.stringify(['Credit Report Analysis', 'Dispute Letters', 'Creditor Negotiations', 'Monthly Progress Reports', 'Credit Education'])],
    ['Credit Repair - Accelerated', 'credit-repair-accelerated', 'credit-repair', 'Fast-track your credit repair with our accelerated program', 497, null, 'monthly', JSON.stringify(['Everything in Standard', 'Priority Processing', 'Aggressive Dispute Strategy', 'Weekly Updates', '1-on-1 Coaching'])],
    ['Business Funding - Starter', 'funding-starter', 'funding', 'Get the funding your business needs to grow', 697, null, 'one-time', JSON.stringify(['Funding Analysis', 'Lender Matching', 'Application Preparation', 'Up to $50K Funding'])],
    ['Business Funding - Growth', 'funding-growth', 'funding', 'Larger funding solutions for established businesses', 1297, null, 'one-time', JSON.stringify(['Everything in Starter', 'Multiple Funding Sources', 'Line of Credit Setup', 'Up to $150K Funding'])],
    ['Business Funding - Enterprise', 'funding-enterprise', 'funding', 'Maximum funding for serious business expansion', 1997, null, 'one-time', JSON.stringify(['Everything in Growth', 'SBA Loan Assistance', 'Equipment Financing', 'Real Estate Funding', 'Up to $500K+ Funding'])]
  ];

  const insertService = db.prepare(`
    INSERT OR IGNORE INTO services (name, slug, category, description, price_min, price_max, billing_type, features)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  services.forEach(service => {
    try {
      insertService.run(...service);
    } catch (e) {
      // Service might already exist
    }
  });

  // Create default admin user
  const hashedPassword = bcrypt.hashSync('Waliboys7$', 10);
  try {
    // Delete old admin and create new one
    db.prepare('DELETE FROM admins').run();
    db.prepare(`
      INSERT INTO admins (email, password, name, role)
      VALUES (?, ?, ?, ?)
    `).run('infohissecretvault23@gmail.com', hashedPassword, 'Admin', 'superadmin');
  } catch (e) {
    // Admin might already exist
  }

  // Insert default email templates
  const templates = [
    ['welcome', 'Welcome to His Secret Vault!', 'Dear {{first_name}},\n\nWelcome to His Secret Vault! We\'re excited to help you on your business journey.\n\nYour account has been created successfully. You can now log in to your dashboard to track your services and progress.\n\nBest regards,\nThe His Secret Vault Team', 'user_registration'],
    ['order_confirmation', 'Order Confirmation - His Secret Vault', 'Dear {{first_name}},\n\nThank you for your order! Your {{service_name}} service has been confirmed.\n\nOrder Details:\n- Service: {{service_name}}\n- Amount: ${{amount}}\n- Order ID: {{order_id}}\n\nWe\'ll begin working on your order immediately. You can track progress in your dashboard.\n\nBest regards,\nThe His Secret Vault Team', 'order_placed'],
    ['progress_update', 'Progress Update - {{service_name}}', 'Dear {{first_name}},\n\nGreat news! There\'s been progress on your {{service_name}} order.\n\nCurrent Status: {{status}}\nStep Completed: {{step_name}}\n\nLog in to your dashboard for more details.\n\nBest regards,\nThe His Secret Vault Team', 'progress_update'],
    ['lead_followup', 'Your Results Are Ready - His Secret Vault', 'Dear {{first_name}},\n\nThank you for using our {{tool_name}} tool!\n\n{{results}}\n\nReady to take the next step? Our team is here to help you achieve your business and financial goals.\n\nSchedule a free consultation today!\n\nBest regards,\nThe His Secret Vault Team', 'lead_created']
  ];

  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO email_templates (name, subject, body, trigger_event)
    VALUES (?, ?, ?, ?)
  `);

  templates.forEach(template => {
    try {
      insertTemplate.run(...template);
    } catch (e) {
      // Template might already exist
    }
  });

  // Save database to file
  db.save();

  console.log('Database initialized successfully!');
}

// Get database instance (must be called after init)
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initSqlJsDatabase() first.');
  }
  return db;
}

module.exports = {
  initSqlJsDatabase,
  initializeDatabase,
  getDb,
  get db() { return db; }
};

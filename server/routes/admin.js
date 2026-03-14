const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

// Admin auth middleware
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Dashboard statistics
router.get('/dashboard', adminAuth, (req, res) => {
  try {
    const db = getDb();

    // Get counts
    const totalClients = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    const pendingContacts = db.prepare("SELECT COUNT(*) as count FROM contacts WHERE status = 'new'").get().count;

    // Subscription stats
    const activeSubscriptions = db.prepare("SELECT COUNT(*) as count FROM user_subscriptions WHERE status = 'active'").get().count;
    const subscriptionsByPlan = db.prepare(`
      SELECT
        sp.name as plan_name,
        COUNT(*) as count
      FROM user_subscriptions us
      JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.status = 'active' AND us.subscription_type = 'plan'
      GROUP BY sp.name
    `).all();

    const subscriptionsByBundle = db.prepare(`
      SELECT
        b.name as bundle_name,
        COUNT(*) as count
      FROM user_subscriptions us
      JOIN bundles b ON us.bundle_id = b.id
      WHERE us.status = 'active' AND us.subscription_type = 'bundle'
      GROUP BY b.name
    `).all();

    const customBundles = db.prepare(`
      SELECT COUNT(*) as count FROM user_subscriptions
      WHERE status = 'active' AND subscription_type = 'custom'
    `).get().count;

    // MRR (Monthly Recurring Revenue)
    const mrrData = db.prepare(`
      SELECT
        COALESCE(SUM(sp.price), 0) as plan_mrr
      FROM user_subscriptions us
      JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.status = 'active' AND us.subscription_type = 'plan'
    `).get();

    const bundleMrr = db.prepare(`
      SELECT
        COALESCE(SUM(b.price), 0) as bundle_mrr
      FROM user_subscriptions us
      JOIN bundles b ON us.bundle_id = b.id
      WHERE us.status = 'active' AND us.subscription_type = 'bundle'
    `).get();

    const mrr = (mrrData.plan_mrr || 0) + (bundleMrr.bundle_mrr || 0);

    // DFY Orders
    const dfyOrders = {
      pending: db.prepare("SELECT COUNT(*) as count FROM dfy_orders WHERE status = 'pending'").get().count,
      active: db.prepare("SELECT COUNT(*) as count FROM dfy_orders WHERE status = 'active'").get().count,
      completed: db.prepare("SELECT COUNT(*) as count FROM dfy_orders WHERE status = 'completed'").get().count
    };

    // DFY Revenue
    const dfyRevenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM dfy_orders WHERE payment_status = 'paid'
    `).get().total;

    const dfyRevenueMonth = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM dfy_orders
      WHERE payment_status = 'paid' AND created_at >= date('now', '-30 days')
    `).get().total;

    // Recent signups
    const recentSignups = db.prepare(`
      SELECT first_name, last_name, email, created_at FROM users
      ORDER BY created_at DESC LIMIT 10
    `).all();

    // Recent DFY orders
    const recentDfyOrders = db.prepare(`
      SELECT
        dfy.id,
        dfy.status,
        dfy.amount,
        dfy.created_at,
        u.first_name,
        u.last_name,
        u.email,
        s.name as service_name
      FROM dfy_orders dfy
      JOIN users u ON dfy.user_id = u.id
      JOIN dfy_services s ON dfy.service_id = s.id
      ORDER BY dfy.created_at DESC
      LIMIT 10
    `).all();

    // Recent leads
    const recentLeads = db.prepare(`
      SELECT * FROM leads ORDER BY created_at DESC LIMIT 10
    `).all();

    // Revenue by month (last 6 months) - MRR tracking
    const revenueByMonth = db.prepare(`
      SELECT
        strftime('%Y-%m', created_at) as month,
        COUNT(*) as subscriptions
      FROM user_subscriptions
      WHERE created_at >= date('now', '-6 months')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month
    `).all();

    res.json({
      stats: {
        totalClients,
        activeSubscriptions,
        totalLeads,
        pendingContacts,
        mrr,
        dfyRevenue,
        dfyRevenueMonth
      },
      subscriptionsByPlan,
      subscriptionsByBundle,
      customBundles,
      dfyOrders,
      recentSignups,
      recentDfyOrders,
      recentLeads,
      revenueByMonth
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Client management
router.get('/clients', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT u.*,
        (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
        (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE user_id = u.id AND payment_status = 'paid') as total_spent
      FROM users u
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      query += ` AND u.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const clients = db.prepare(query).all(...params);

    const total = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;

    res.json({
      clients,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Get single client with details
router.get('/clients/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const client = db.prepare(`
      SELECT * FROM users WHERE id = ?
    `).get(req.params.id);

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get subscription info
    const subscription = db.prepare(`
      SELECT
        us.*,
        sp.name as plan_name,
        sp.price as plan_price,
        b.name as bundle_name,
        b.price as bundle_price
      FROM user_subscriptions us
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      LEFT JOIN bundles b ON us.bundle_id = b.id
      WHERE us.user_id = ? AND us.status = 'active'
      ORDER BY us.created_at DESC
      LIMIT 1
    `).get(req.params.id);

    if (subscription) {
      subscription.custom_modes = subscription.custom_modes ? JSON.parse(subscription.custom_modes) : null;
    }

    // Get AI modes the client has access to
    let accessibleModes = [];
    if (subscription) {
      if (subscription.subscription_type === 'plan' && subscription.plan_id) {
        const plan = db.prepare('SELECT included_modes FROM subscription_plans WHERE id = ?').get(subscription.plan_id);
        accessibleModes = JSON.parse(plan.included_modes || '[]');
      } else if (subscription.subscription_type === 'bundle' && subscription.bundle_id) {
        const bundle = db.prepare('SELECT included_modes FROM bundles WHERE id = ?').get(subscription.bundle_id);
        accessibleModes = JSON.parse(bundle.included_modes || '[]');
      } else if (subscription.subscription_type === 'custom') {
        accessibleModes = subscription.custom_modes || [];
      }
    }

    // Get DFY orders
    const dfyOrders = db.prepare(`
      SELECT dfy.*, s.name as service_name, s.category
      FROM dfy_orders dfy
      JOIN dfy_services s ON dfy.service_id = s.id
      WHERE dfy.user_id = ?
      ORDER BY dfy.created_at DESC
    `).all(req.params.id);

    // Legacy orders
    const orders = db.prepare(`
      SELECT o.*, s.name as service_name, s.category
      FROM orders o
      JOIN services s ON o.service_id = s.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `).all(req.params.id);

    const documents = db.prepare(`
      SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.params.id);

    // Calculate total spent
    const subscriptionTotal = subscription && subscription.status === 'active' ? (subscription.plan_price || subscription.bundle_price || 0) : 0;
    const dfyTotal = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM dfy_orders
      WHERE user_id = ? AND payment_status = 'paid'
    `).get(req.params.id).total;

    res.json({
      client,
      subscription,
      accessibleModes,
      dfyOrders,
      orders,
      documents,
      totalSpent: subscriptionTotal + dfyTotal
    });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// Update client
router.put('/clients/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { firstName, lastName, email, phone, status } = req.body;

    db.prepare(`
      UPDATE users SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(firstName, lastName, email, phone, status, req.params.id);

    res.json({ message: 'Client updated successfully' });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

// Order management
router.get('/orders', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, category, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*, u.first_name, u.last_name, u.email, s.name as service_name, s.category
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN services s ON o.service_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ` AND o.status = ?`;
      params.push(status);
    }

    if (category) {
      query += ` AND s.category = ?`;
      params.push(category);
    }

    query += ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const orders = db.prepare(query).all(...params);

    const total = db.prepare(`SELECT COUNT(*) as count FROM orders`).get().count;

    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get single order with progress
router.get('/orders/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare(`
      SELECT o.*, u.first_name, u.last_name, u.email, u.phone,
        s.name as service_name, s.category, s.features
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN services s ON o.service_id = s.id
      WHERE o.id = ?
    `).get(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const progress = db.prepare(`
      SELECT * FROM order_progress WHERE order_id = ? ORDER BY step_number
    `).all(req.params.id);

    const documents = db.prepare(`
      SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC
    `).all(req.params.id);

    res.json({
      ...order,
      features: JSON.parse(order.features || '[]'),
      progress,
      documents
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Update order
router.put('/orders/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, notes } = req.body;

    db.prepare(`
      UPDATE orders SET
        status = COALESCE(?, status),
        notes = COALESCE(?, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, notes, req.params.id);

    res.json({ message: 'Order updated successfully' });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// Update order progress step
router.put('/orders/:orderId/progress/:stepId', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, notes } = req.body;

    db.prepare(`
      UPDATE order_progress SET
        status = ?,
        notes = ?,
        completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ? AND order_id = ?
    `).run(status, notes, status, req.params.stepId, req.params.orderId);

    // If completed, start next step
    if (status === 'completed') {
      const currentStep = db.prepare('SELECT step_number FROM order_progress WHERE id = ?').get(req.params.stepId);
      db.prepare(`
        UPDATE order_progress SET status = 'in_progress'
        WHERE order_id = ? AND step_number = ? AND status = 'pending'
      `).run(req.params.orderId, currentStep.step_number + 1);
    }

    res.json({ message: 'Progress updated successfully' });
  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Leads management
router.get('/leads', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { source, converted, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM leads WHERE 1=1`;
    const params = [];

    if (source) {
      query += ` AND source = ?`;
      params.push(source);
    }

    if (converted !== undefined) {
      query += ` AND converted = ?`;
      params.push(converted === 'true' ? 1 : 0);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const leads = db.prepare(query).all(...params);

    const total = db.prepare(`SELECT COUNT(*) as count FROM leads`).get().count;

    res.json({
      leads: leads.map(l => ({
        ...l,
        quiz_results: JSON.parse(l.quiz_results || '{}')
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// Mark lead as converted
router.put('/leads/:id/convert', adminAuth, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE leads SET converted = 1 WHERE id = ?').run(req.params.id);
    res.json({ message: 'Lead marked as converted' });
  } catch (error) {
    console.error('Convert lead error:', error);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// Contact messages
router.get('/contacts', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM contacts WHERE 1=1`;
    const params = [];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const contacts = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM contacts`).get().count;

    res.json({
      contacts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Update contact status
router.put('/contacts/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status } = req.body;
    db.prepare(`
      UPDATE contacts SET
        status = ?,
        responded_at = CASE WHEN ? = 'responded' THEN CURRENT_TIMESTAMP ELSE responded_at END
      WHERE id = ?
    `).run(status, status, req.params.id);

    res.json({ message: 'Contact updated successfully' });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Email templates
router.get('/email-templates', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const templates = db.prepare('SELECT * FROM email_templates ORDER BY name').all();
    res.json(templates);
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Update email template
router.put('/email-templates/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { subject, body, active } = req.body;

    db.prepare(`
      UPDATE email_templates SET
        subject = COALESCE(?, subject),
        body = COALESCE(?, body),
        active = COALESCE(?, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(subject, body, active, req.params.id);

    res.json({ message: 'Template updated successfully' });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Services management
router.get('/services', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const services = db.prepare('SELECT * FROM services ORDER BY category, price_min').all();
    res.json(services.map(s => ({
      ...s,
      features: JSON.parse(s.features || '[]')
    })));
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// Update service
router.put('/services/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { name, description, priceMin, priceMax, features, active } = req.body;

    db.prepare(`
      UPDATE services SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        price_min = COALESCE(?, price_min),
        price_max = COALESCE(?, price_max),
        features = COALESCE(?, features),
        active = COALESCE(?, active)
      WHERE id = ?
    `).run(
      name,
      description,
      priceMin,
      priceMax,
      features ? JSON.stringify(features) : null,
      active,
      req.params.id
    );

    res.json({ message: 'Service updated successfully' });
  } catch (error) {
    console.error('Update service error:', error);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// Revenue analytics
router.get('/analytics/revenue', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const period = Math.min(Math.max(parseInt(req.query.period) || 30, 1), 365);
    const periodFilter = `-${period} days`;

    const revenueByDay = db.prepare(`
      SELECT
        date(recorded_at) as date,
        SUM(amount) as total,
        COUNT(*) as transactions
      FROM revenue
      WHERE recorded_at >= date('now', ?)
      GROUP BY date(recorded_at)
      ORDER BY date
    `).all(periodFilter);

    const revenueByService = db.prepare(`
      SELECT
        s.name,
        s.category,
        SUM(r.amount) as total,
        COUNT(*) as transactions
      FROM revenue r
      JOIN orders o ON r.order_id = o.id
      JOIN services s ON o.service_id = s.id
      WHERE r.recorded_at >= date('now', ?)
      GROUP BY s.id
      ORDER BY total DESC
    `).all(periodFilter);

    const summary = db.prepare(`
      SELECT
        SUM(amount) as total,
        COUNT(*) as transactions,
        AVG(amount) as average
      FROM revenue
      WHERE recorded_at >= date('now', ?)
    `).get(periodFilter);

    res.json({
      revenueByDay,
      revenueByService,
      summary
    });
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Update admin profile
router.put('/profile', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { name, email } = req.body;
    const adminId = req.admin.adminId;

    // Check if email is already taken by another admin
    if (email) {
      const existing = db.prepare('SELECT id FROM admins WHERE email = ? AND id != ?').get(email, adminId);
      if (existing) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    db.prepare(`
      UPDATE admins SET
        name = COALESCE(?, name),
        email = COALESCE(?, email)
      WHERE id = ?
    `).run(name, email, adminId);

    // Save database
    db.save();

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update admin profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ============================================
// SUBSCRIPTIONS MANAGEMENT
// ============================================

// Get all subscriptions
router.get('/subscriptions', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { type, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        us.*,
        u.first_name,
        u.last_name,
        u.email,
        sp.name as plan_name,
        sp.price as plan_price,
        b.name as bundle_name,
        b.price as bundle_price
      FROM user_subscriptions us
      JOIN users u ON us.user_id = u.id
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      LEFT JOIN bundles b ON us.bundle_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      query += ` AND us.subscription_type = ?`;
      params.push(type);
    }

    if (status) {
      query += ` AND us.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY us.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const subscriptions = db.prepare(query).all(...params);

    // Parse custom_modes JSON
    const parsedSubscriptions = subscriptions.map(sub => ({
      ...sub,
      custom_modes: sub.custom_modes ? JSON.parse(sub.custom_modes) : null
    }));

    const total = db.prepare(`SELECT COUNT(*) as count FROM user_subscriptions`).get().count;

    res.json({
      subscriptions: parsedSubscriptions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// Get single subscription details
router.get('/subscriptions/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const subscription = db.prepare(`
      SELECT
        us.*,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        sp.name as plan_name,
        sp.price as plan_price,
        sp.included_modes as plan_modes,
        b.name as bundle_name,
        b.price as bundle_price,
        b.included_modes as bundle_modes
      FROM user_subscriptions us
      JOIN users u ON us.user_id = u.id
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      LEFT JOIN bundles b ON us.bundle_id = b.id
      WHERE us.id = ?
    `).get(req.params.id);

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Parse JSON fields
    subscription.custom_modes = subscription.custom_modes ? JSON.parse(subscription.custom_modes) : null;
    subscription.plan_modes = subscription.plan_modes ? JSON.parse(subscription.plan_modes) : null;
    subscription.bundle_modes = subscription.bundle_modes ? JSON.parse(subscription.bundle_modes) : null;

    res.json(subscription);
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// Cancel subscription
router.put('/subscriptions/:id/cancel', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { immediate } = req.body;

    if (immediate) {
      db.prepare(`
        UPDATE user_subscriptions SET
          status = 'cancelled',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.params.id);
    } else {
      db.prepare(`
        UPDATE user_subscriptions SET
          cancel_at_period_end = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.params.id);
    }

    db.save();
    res.json({ message: 'Subscription cancelled successfully' });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// ============================================
// PLANS & BUNDLES MANAGEMENT
// ============================================

// Get all plans and bundles
router.get('/plans', adminAuth, (req, res) => {
  try {
    const db = getDb();

    const plans = db.prepare(`
      SELECT * FROM subscription_plans ORDER BY display_order
    `).all().map(p => ({
      ...p,
      included_modes: JSON.parse(p.included_modes || '[]'),
      features: JSON.parse(p.features || '[]')
    }));

    const bundles = db.prepare(`
      SELECT * FROM bundles ORDER BY display_order
    `).all().map(b => ({
      ...b,
      included_modes: JSON.parse(b.included_modes || '[]'),
      features: JSON.parse(b.features || '[]')
    }));

    const customPricing = db.prepare(`
      SELECT * FROM custom_bundle_pricing ORDER BY mode_count
    `).all();

    const aiModes = db.prepare(`
      SELECT * FROM ai_modes ORDER BY display_order
    `).all();

    res.json({ plans, bundles, customPricing, aiModes });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// Update plan
router.put('/plans/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { name, description, price, includedModes, features, active } = req.body;

    db.prepare(`
      UPDATE subscription_plans SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        included_modes = COALESCE(?, included_modes),
        features = COALESCE(?, features),
        active = COALESCE(?, active)
      WHERE id = ?
    `).run(
      name,
      description,
      price,
      includedModes ? JSON.stringify(includedModes) : null,
      features ? JSON.stringify(features) : null,
      active,
      req.params.id
    );

    db.save();
    res.json({ message: 'Plan updated successfully' });
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// Update bundle
router.put('/bundles/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { name, description, price, includedModes, features, active } = req.body;

    db.prepare(`
      UPDATE bundles SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        included_modes = COALESCE(?, included_modes),
        features = COALESCE(?, features),
        active = COALESCE(?, active)
      WHERE id = ?
    `).run(
      name,
      description,
      price,
      includedModes ? JSON.stringify(includedModes) : null,
      features ? JSON.stringify(features) : null,
      active,
      req.params.id
    );

    db.save();
    res.json({ message: 'Bundle updated successfully' });
  } catch (error) {
    console.error('Update bundle error:', error);
    res.status(500).json({ error: 'Failed to update bundle' });
  }
});

// ============================================
// DFY ORDERS MANAGEMENT
// ============================================

// Get all DFY orders
router.get('/dfy-orders', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, category, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        dfy.*,
        u.first_name,
        u.last_name,
        u.email,
        s.name as service_name,
        s.category
      FROM dfy_orders dfy
      JOIN users u ON dfy.user_id = u.id
      JOIN dfy_services s ON dfy.service_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ` AND dfy.status = ?`;
      params.push(status);
    }

    if (category) {
      query += ` AND s.category = ?`;
      params.push(category);
    }

    query += ` ORDER BY dfy.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const orders = db.prepare(query).all(...params);

    const total = db.prepare(`SELECT COUNT(*) as count FROM dfy_orders`).get().count;

    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get DFY orders error:', error);
    res.status(500).json({ error: 'Failed to fetch DFY orders' });
  }
});

// Get single DFY order with progress
router.get('/dfy-orders/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare(`
      SELECT
        dfy.*,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        s.name as service_name,
        s.category,
        s.features,
        s.process_steps
      FROM dfy_orders dfy
      JOIN users u ON dfy.user_id = u.id
      JOIN dfy_services s ON dfy.service_id = s.id
      WHERE dfy.id = ?
    `).get(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'DFY order not found' });
    }

    const progress = db.prepare(`
      SELECT * FROM dfy_order_progress WHERE dfy_order_id = ? ORDER BY step_number
    `).all(req.params.id);

    const documents = db.prepare(`
      SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC
    `).all(req.params.id);

    res.json({
      ...order,
      features: JSON.parse(order.features || '[]'),
      process_steps: JSON.parse(order.process_steps || '[]'),
      progress,
      documents
    });
  } catch (error) {
    console.error('Get DFY order error:', error);
    res.status(500).json({ error: 'Failed to fetch DFY order' });
  }
});

// Update DFY order
router.put('/dfy-orders/:id', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, currentStep, notes } = req.body;

    db.prepare(`
      UPDATE dfy_orders SET
        status = COALESCE(?, status),
        current_step = COALESCE(?, current_step),
        notes = COALESCE(?, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, currentStep, notes, req.params.id);

    db.save();
    res.json({ message: 'DFY order updated successfully' });
  } catch (error) {
    console.error('Update DFY order error:', error);
    res.status(500).json({ error: 'Failed to update DFY order' });
  }
});

// Update DFY order progress step
router.put('/dfy-orders/:orderId/progress/:stepId', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { status, notes } = req.body;

    db.prepare(`
      UPDATE dfy_order_progress SET
        status = ?,
        notes = ?,
        completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ? AND dfy_order_id = ?
    `).run(status, notes, status, req.params.stepId, req.params.orderId);

    // If completed, start next step
    if (status === 'completed') {
      const currentStep = db.prepare('SELECT step_number FROM dfy_order_progress WHERE id = ?').get(req.params.stepId);
      db.prepare(`
        UPDATE dfy_order_progress SET status = 'in_progress'
        WHERE dfy_order_id = ? AND step_number = ? AND status = 'pending'
      `).run(req.params.orderId, currentStep.step_number + 1);
    }

    db.save();
    res.json({ message: 'Progress updated successfully' });
  } catch (error) {
    console.error('Update DFY progress error:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

module.exports = router;

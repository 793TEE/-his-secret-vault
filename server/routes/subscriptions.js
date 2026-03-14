const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const { sendOrderConfirmation } = require('../services/email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

// Initialize Stripe (only if key is provided)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// GET /api/subscriptions/plans — all plans, bundles, and custom pricing
router.get('/plans', (req, res) => {
  try {
    const db = getDb();
    const plans = db.prepare('SELECT * FROM subscription_plans WHERE active = 1 ORDER BY display_order').all();
    const bundles = db.prepare('SELECT * FROM bundles WHERE active = 1 ORDER BY display_order').all();
    const customPricing = db.prepare('SELECT * FROM custom_bundle_pricing ORDER BY mode_count').all();
    const aiModes = db.prepare('SELECT * FROM ai_modes ORDER BY display_order').all();

    // Parse JSON fields
    const parsePlans = (items) => items.map(item => ({
      ...item,
      features: tryParse(item.features),
      included_modes: tryParse(item.included_modes)
    }));

    res.json({
      plans: parsePlans(plans),
      bundles: parsePlans(bundles),
      customPricing,
      aiModes
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

// GET /api/subscriptions/dfy-services — DFY service catalog
router.get('/dfy-services', (req, res) => {
  try {
    const db = getDb();
    const services = db.prepare('SELECT * FROM dfy_services WHERE active = 1').all();
    const parsed = services.map(s => ({
      ...s,
      features: tryParse(s.features),
      process_steps: tryParse(s.process_steps)
    }));
    res.json({ services: parsed });
  } catch (error) {
    console.error('Get DFY services error:', error);
    res.status(500).json({ error: 'Failed to load services' });
  }
});

// GET /api/subscriptions/me — alias used by dashboard (returns flat subscription object)
router.get('/me', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const sub = db.prepare(`
      SELECT us.*, sp.name as plan_name, sp.price as plan_price, sp.features as plan_features,
             sp.included_modes as plan_modes, b.name as bundle_name, b.price as bundle_price,
             b.features as bundle_features, b.included_modes as bundle_modes
      FROM user_subscriptions us
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      LEFT JOIN bundles b ON us.bundle_id = b.id
      WHERE us.user_id = ? AND us.status = 'active'
      ORDER BY us.created_at DESC
      LIMIT 1
    `).get(req.user.userId);

    if (!sub) return res.json(null);

    res.json({
      ...sub,
      plan_features: tryParse(sub.plan_features),
      plan_modes: tryParse(sub.plan_modes),
      bundle_features: tryParse(sub.bundle_features),
      bundle_modes: tryParse(sub.bundle_modes),
      custom_modes: tryParse(sub.custom_modes),
      // aliases for dashboard compatibility
      ai_modes: tryParse(sub.plan_modes || sub.bundle_modes)
    });
  } catch (error) {
    console.error('Get subscription (me) error:', error);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

// GET /api/subscriptions/my — current user's active subscription (wrapped)
router.get('/my', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const sub = db.prepare(`
      SELECT us.*, sp.name as plan_name, sp.price as plan_price, sp.features as plan_features,
             sp.included_modes as plan_modes, b.name as bundle_name, b.price as bundle_price,
             b.features as bundle_features, b.included_modes as bundle_modes
      FROM user_subscriptions us
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      LEFT JOIN bundles b ON us.bundle_id = b.id
      WHERE us.user_id = ? AND us.status = 'active'
      ORDER BY us.created_at DESC
      LIMIT 1
    `).get(req.user.userId);

    if (!sub) {
      return res.json({ subscription: null });
    }

    res.json({
      subscription: {
        ...sub,
        plan_features: tryParse(sub.plan_features),
        plan_modes: tryParse(sub.plan_modes),
        bundle_features: tryParse(sub.bundle_features),
        bundle_modes: tryParse(sub.bundle_modes),
        custom_modes: tryParse(sub.custom_modes)
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

// GET /api/subscriptions/dfy-orders — user's DFY orders
router.get('/dfy-orders', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const orders = db.prepare(`
      SELECT do.*, ds.name as service_name, ds.category
      FROM dfy_orders do
      JOIN dfy_services ds ON do.service_id = ds.id
      WHERE do.user_id = ?
      ORDER BY do.created_at DESC
    `).all(req.user.userId);

    const ordersWithProgress = orders.map(order => {
      const steps = db.prepare(`
        SELECT * FROM dfy_order_progress WHERE dfy_order_id = ? ORDER BY step_number
      `).all(order.id);
      return { ...order, progress: steps };
    });

    res.json({ orders: ordersWithProgress });
  } catch (error) {
    console.error('Get DFY orders error:', error);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// POST /api/subscriptions/create-intent — Stripe setup intent for subscription
router.post('/create-intent', authMiddleware, async (req, res) => {
  try {
    const { planSlug, planType } = req.body; // planType: 'plan' | 'bundle'
    const db = getDb();

    let item;
    if (planType === 'plan') {
      item = db.prepare('SELECT * FROM subscription_plans WHERE slug = ? AND active = 1').get(planSlug);
    } else {
      item = db.prepare('SELECT * FROM bundles WHERE slug = ? AND active = 1').get(planSlug);
    }

    if (!item) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (!stripe) {
      return res.json({
        clientSecret: 'demo_seti_' + Date.now(),
        planName: item.name,
        price: item.price,
        demoMode: true
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      usage: 'off_session',
      metadata: { planSlug, planType, userId: req.user.userId }
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      planName: item.name,
      price: item.price
    });
  } catch (error) {
    console.error('Create setup intent error:', error);
    res.status(500).json({ error: 'Failed to create intent' });
  }
});

// POST /api/subscriptions/subscribe — finalize subscription after payment method collected
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { planSlug, planType, paymentMethodId, demoMode } = req.body;
    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get plan
    let item, columnName;
    if (planType === 'plan') {
      item = db.prepare('SELECT * FROM subscription_plans WHERE slug = ? AND active = 1').get(planSlug);
      columnName = 'plan_id';
    } else {
      item = db.prepare('SELECT * FROM bundles WHERE slug = ? AND active = 1').get(planSlug);
      columnName = 'bundle_id';
    }

    if (!item) return res.status(404).json({ error: 'Plan not found' });

    // Cancel any existing active subscription for this user
    const existingSub = db.prepare(`
      SELECT * FROM user_subscriptions WHERE user_id = ? AND status = 'active'
    `).get(req.user.userId);

    if (existingSub && existingSub.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.cancel(existingSub.stripe_subscription_id);
      } catch (e) {
        console.error('Failed to cancel old Stripe sub:', e.message);
      }
    }

    if (existingSub) {
      db.prepare(`UPDATE user_subscriptions SET status = 'cancelled' WHERE id = ?`).run(existingSub.id);
    }

    let stripeSubId = null;
    let stripeCustomerId = null;

    if (stripe && !demoMode) {
      // Get or create Stripe customer
      const existingCustomers = await stripe.customers.list({ email: user.email, limit: 1 });
      let customer;
      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        // Attach payment method to existing customer
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
        await stripe.customers.update(customer.id, {
          invoice_settings: { default_payment_method: paymentMethodId }
        });
      } else {
        customer = await stripe.customers.create({
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
          payment_method: paymentMethodId,
          invoice_settings: { default_payment_method: paymentMethodId }
        });
      }
      stripeCustomerId = customer.id;

      // Create price on the fly
      const price = await stripe.prices.create({
        unit_amount: Math.round(item.price * 100),
        currency: 'usd',
        recurring: { interval: 'month' },
        product_data: { name: item.name }
      });

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        default_payment_method: paymentMethodId,
        expand: ['latest_invoice.payment_intent']
      });

      stripeSubId = subscription.id;
    }

    // Persist to DB
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const subResult = db.prepare(`
      INSERT INTO user_subscriptions
        (user_id, subscription_type, ${columnName}, stripe_subscription_id, stripe_customer_id,
         status, current_period_start, current_period_end)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      req.user.userId,
      planType,
      item.id,
      stripeSubId || ('demo_sub_' + Date.now()),
      stripeCustomerId,
      now.toISOString(),
      periodEnd.toISOString()
    );

    // Send confirmation email
    sendOrderConfirmation(
      user.email,
      user.first_name,
      `${item.name} Subscription`,
      Math.round(item.price * 100),
      subResult.lastInsertRowid
    ).catch(e => console.error('Subscription email error:', e.message));

    res.json({
      message: 'Subscription created successfully',
      subscriptionId: subResult.lastInsertRowid,
      planName: item.name
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: error.message || 'Failed to create subscription' });
  }
});

// POST /api/subscriptions/cancel — cancel user's subscription
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const sub = db.prepare(`
      SELECT * FROM user_subscriptions WHERE user_id = ? AND status = 'active'
    `).get(req.user.userId);

    if (!sub) return res.status(404).json({ error: 'No active subscription found' });

    if (stripe && sub.stripe_subscription_id && !sub.stripe_subscription_id.startsWith('demo_')) {
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true
      });
      db.prepare(`
        UPDATE user_subscriptions SET cancel_at_period_end = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(sub.id);
      return res.json({ message: 'Subscription will cancel at end of billing period' });
    }

    db.prepare(`
      UPDATE user_subscriptions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(sub.id);

    res.json({ message: 'Subscription cancelled' });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// POST /api/subscriptions/dfy-intent — payment intent for DFY one-time service
router.post('/dfy-intent', authMiddleware, async (req, res) => {
  try {
    const { serviceSlug } = req.body;
    const db = getDb();

    const service = db.prepare('SELECT * FROM dfy_services WHERE slug = ? AND active = 1').get(serviceSlug);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    if (!stripe) {
      return res.json({
        clientSecret: 'demo_pi_' + Date.now(),
        serviceName: service.name,
        price: service.price,
        demoMode: true
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(service.price * 100),
      currency: 'usd',
      receipt_email: user.email,
      metadata: {
        userId: req.user.userId,
        serviceSlug,
        serviceName: service.name
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      serviceName: service.name,
      price: service.price
    });
  } catch (error) {
    console.error('DFY intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// POST /api/subscriptions/dfy-confirm — confirm DFY purchase and save order
router.post('/dfy-confirm', authMiddleware, async (req, res) => {
  try {
    const { paymentIntentId, serviceSlug, demoMode } = req.body;
    const db = getDb();

    const service = db.prepare('SELECT * FROM dfy_services WHERE slug = ? AND active = 1').get(serviceSlug);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);

    const orderResult = db.prepare(`
      INSERT INTO dfy_orders (user_id, service_id, stripe_payment_id, amount, status, payment_status)
      VALUES (?, ?, ?, ?, 'pending', 'paid')
    `).run(
      req.user.userId,
      service.id,
      paymentIntentId || ('demo_pi_' + Date.now()),
      service.price
    );

    const orderId = orderResult.lastInsertRowid;

    // Create progress steps
    const steps = getDFYProgressSteps(service.category);
    const insertStep = db.prepare(`
      INSERT INTO dfy_order_progress (dfy_order_id, step_number, step_name, status)
      VALUES (?, ?, ?, ?)
    `);
    steps.forEach((step, i) => {
      insertStep.run(orderId, i + 1, step, i === 0 ? 'in_progress' : 'pending');
    });

    // Send confirmation email
    sendOrderConfirmation(
      user.email,
      user.first_name,
      service.name,
      Math.round(service.price * 100),
      orderId
    ).catch(e => console.error('DFY email error:', e.message));

    res.json({ message: 'Order confirmed', orderId, serviceName: service.name });
  } catch (error) {
    console.error('DFY confirm error:', error);
    res.status(500).json({ error: 'Failed to confirm order' });
  }
});

function getDFYProgressSteps(category) {
  const steps = {
    'done-for-you': ['Order Received', 'Initial Consultation', 'Document Preparation', 'Processing', 'Review & Delivery']
  };
  // Match by service slug keywords
  return steps['done-for-you'];
}

function tryParse(val) {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return val; }
}

module.exports = router;

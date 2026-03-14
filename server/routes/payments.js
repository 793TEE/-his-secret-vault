const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

// Initialize Stripe (only if key is provided)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Middleware to verify user token
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

// Create payment intent
router.post('/create-intent', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { serviceId, amount } = req.body;

    // Verify service exists
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Get user info
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!stripe) {
      // Demo mode - return mock intent
      return res.json({
        clientSecret: 'demo_secret_' + Date.now(),
        demoMode: true,
        message: 'Stripe not configured - running in demo mode'
      });
    }

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      metadata: {
        userId: req.user.userId,
        serviceId: serviceId,
        serviceName: service.name
      },
      receipt_email: user.email
    });

    res.json({
      clientSecret: paymentIntent.client_secret
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Create subscription (for monthly services)
router.post('/create-subscription', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { serviceId, paymentMethodId } = req.body;

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
    if (!service || service.billing_type !== 'monthly') {
      return res.status(400).json({ error: 'Invalid service for subscription' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);

    if (!stripe) {
      // Demo mode
      const orderId = db.prepare(`
        INSERT INTO orders (user_id, service_id, amount, status, payment_status, stripe_subscription_id)
        VALUES (?, ?, ?, 'active', 'paid', ?)
      `).run(req.user.userId, serviceId, service.price_min, 'demo_sub_' + Date.now()).lastInsertRowid;

      return res.json({
        subscriptionId: 'demo_sub_' + Date.now(),
        orderId,
        demoMode: true
      });
    }

    // Create or get Stripe customer
    let customerId;
    const existingCustomer = await stripe.customers.list({ email: user.email, limit: 1 });

    if (existingCustomer.data.length > 0) {
      customerId = existingCustomer.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        payment_method: paymentMethodId,
        invoice_settings: { default_payment_method: paymentMethodId }
      });
      customerId = customer.id;
    }

    // Create price if it doesn't exist (in production, prices should be pre-created)
    const price = await stripe.prices.create({
      unit_amount: Math.round(service.price_min * 100),
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: { name: service.name }
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent']
    });

    // Create order
    const orderId = db.prepare(`
      INSERT INTO orders (user_id, service_id, amount, status, payment_status, stripe_subscription_id)
      VALUES (?, ?, ?, 'active', 'paid', ?)
    `).run(req.user.userId, serviceId, service.price_min, subscription.id).lastInsertRowid;

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      orderId
    });
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Confirm payment and create order
router.post('/confirm', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { paymentIntentId, serviceId, amount, demoMode } = req.body;

    // Create order
    const result = db.prepare(`
      INSERT INTO orders (user_id, service_id, stripe_payment_id, amount, status, payment_status)
      VALUES (?, ?, ?, ?, 'active', 'paid')
    `).run(req.user.userId, serviceId, paymentIntentId || 'demo_' + Date.now(), amount);

    const orderId = result.lastInsertRowid;

    // Get service for progress steps
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);

    // Create initial progress steps
    const progressSteps = getProgressSteps(service.category);
    const insertProgress = db.prepare(`
      INSERT INTO order_progress (order_id, step_number, step_name, status)
      VALUES (?, ?, ?, ?)
    `);

    progressSteps.forEach((step, index) => {
      insertProgress.run(orderId, index + 1, step, index === 0 ? 'in_progress' : 'pending');
    });

    // Record revenue
    db.prepare(`
      INSERT INTO revenue (order_id, amount, type, stripe_payment_id)
      VALUES (?, ?, 'payment', ?)
    `).run(orderId, amount, paymentIntentId || 'demo_' + Date.now());

    res.json({
      message: 'Payment confirmed successfully',
      orderId
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.json({ received: true, message: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getDb();

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      db.prepare(`UPDATE orders SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_id = ?`).run(pi.id);
      db.prepare(`UPDATE dfy_orders SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_id = ?`).run(pi.id);
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      db.prepare(`UPDATE orders SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_id = ?`).run(pi.id);
      db.prepare(`UPDATE dfy_orders SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE stripe_payment_id = ?`).run(pi.id);
      break;
    }

    case 'invoice.payment_succeeded': {
      // Subscription renewed
      const invoice = event.data.object;
      if (invoice.subscription) {
        const periodEnd = new Date(invoice.lines.data[0]?.period?.end * 1000).toISOString();
        db.prepare(`
          UPDATE user_subscriptions
          SET status = 'active', current_period_end = ?, updated_at = CURRENT_TIMESTAMP
          WHERE stripe_subscription_id = ?
        `).run(periodEnd, invoice.subscription);
      }
      break;
    }

    case 'invoice.payment_failed': {
      // Subscription payment failed
      const invoice = event.data.object;
      if (invoice.subscription) {
        console.log('Subscription payment failed for:', invoice.subscription);
        // Don't immediately cancel — Stripe will retry. Log it.
        db.prepare(`
          UPDATE user_subscriptions SET updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = ?
        `).run(invoice.subscription);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      db.prepare(`
        UPDATE user_subscriptions
        SET status = ?,
            cancel_at_period_end = ?,
            current_period_end = COALESCE(?, current_period_end),
            updated_at = CURRENT_TIMESTAMP
        WHERE stripe_subscription_id = ?
      `).run(
        sub.status === 'active' ? 'active' : sub.status === 'canceled' ? 'cancelled' : sub.status,
        sub.cancel_at_period_end ? 1 : 0,
        periodEnd,
        sub.id
      );
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      db.prepare(`
        UPDATE user_subscriptions SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE stripe_subscription_id = ?
      `).run(sub.id);
      break;
    }

    default:
      console.log(`Unhandled webhook event: ${event.type}`);
  }

  res.json({ received: true });
});

// Get Stripe publishable key
router.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'demo_pk_test',
    demoMode: !process.env.STRIPE_PUBLISHABLE_KEY
  });
});

function getProgressSteps(category) {
  const steps = {
    'business-formation': [
      'Information Gathering',
      'Document Preparation',
      'State Filing Submitted',
      'EIN Application',
      'Operating Agreement/Bylaws',
      'Final Review & Delivery'
    ],
    'credit-repair': [
      'Credit Report Analysis',
      'Dispute Strategy Development',
      'Round 1 Disputes Sent',
      'Round 1 Results Review',
      'Round 2 Disputes (if needed)',
      'Ongoing Monitoring'
    ],
    'funding': [
      'Application Review',
      'Credit Analysis',
      'Lender Matching',
      'Application Submission',
      'Approval & Funding',
      'Post-Funding Support'
    ]
  };

  return steps[category] || ['Processing', 'Review', 'Completion'];
}

module.exports = router;

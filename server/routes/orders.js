const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

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

// Get user's orders
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const orders = db.prepare(`
      SELECT o.*, s.name as service_name, s.category
      FROM orders o
      JOIN services s ON o.service_id = s.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `).all(req.user.userId);

    res.json(orders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get single order with progress
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare(`
      SELECT o.*, s.name as service_name, s.category, s.features
      FROM orders o
      JOIN services s ON o.service_id = s.id
      WHERE o.id = ? AND o.user_id = ?
    `).get(req.params.id, req.user.userId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Get progress steps
    const progress = db.prepare(`
      SELECT * FROM order_progress
      WHERE order_id = ?
      ORDER BY step_number
    `).all(req.params.id);

    res.json({
      ...order,
      features: JSON.parse(order.features || '[]'),
      progress
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Create new order
router.post('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { serviceId, amount, notes } = req.body;

    // Verify service exists
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Create order
    const result = db.prepare(`
      INSERT INTO orders (user_id, service_id, amount, notes, status, payment_status)
      VALUES (?, ?, ?, ?, 'pending', 'pending')
    `).run(req.user.userId, serviceId, amount, notes);

    const orderId = result.lastInsertRowid;

    // Create initial progress steps based on service category
    const progressSteps = getProgressSteps(service.category);
    const insertProgress = db.prepare(`
      INSERT INTO order_progress (order_id, step_number, step_name, status)
      VALUES (?, ?, ?, 'pending')
    `);

    progressSteps.forEach((step, index) => {
      insertProgress.run(orderId, index + 1, step);
    });

    res.status(201).json({
      message: 'Order created successfully',
      orderId
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Helper function to get progress steps by category
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

const express = require('express');
const { getDb } = require('../database');

const router = express.Router();

// Get all services
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { category } = req.query;
    let query = 'SELECT * FROM services WHERE active = 1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY category, price_min';
    const services = db.prepare(query).all(...params);

    // Parse features JSON
    const formatted = services.map(s => ({
      ...s,
      features: JSON.parse(s.features || '[]')
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// Get service by slug
router.get('/:slug', (req, res) => {
  try {
    const db = getDb();
    const service = db.prepare('SELECT * FROM services WHERE slug = ? AND active = 1').get(req.params.slug);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({
      ...service,
      features: JSON.parse(service.features || '[]')
    });
  } catch (error) {
    console.error('Get service error:', error);
    res.status(500).json({ error: 'Failed to fetch service' });
  }
});

// Get services by category
router.get('/category/:category', (req, res) => {
  try {
    const db = getDb();
    const services = db.prepare('SELECT * FROM services WHERE category = ? AND active = 1 ORDER BY price_min').all(req.params.category);

    const formatted = services.map(s => ({
      ...s,
      features: JSON.parse(s.features || '[]')
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get category services error:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

module.exports = router;

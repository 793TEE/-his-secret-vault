const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    // Check if user exists
    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = db.prepare(`
      INSERT INTO users (email, password, first_name, last_name, phone)
      VALUES (?, ?, ?, ?, ?)
    `).run(email, hashedPassword, firstName, lastName, phone || null);

    // Generate token
    const token = jwt.sign({ userId: result.lastInsertRowid, type: 'user' }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: result.lastInsertRowid,
        email,
        firstName,
        lastName
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, type: 'user' }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body;

    console.log('Admin login attempt:', { email, passwordLength: password?.length });

    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
    if (!admin) {
      console.log('Admin not found for email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('Admin found, comparing password...');
    const validPassword = await bcrypt.compare(password, admin.password);
    console.log('Password valid:', validPassword);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    db.prepare('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);

    const token = jwt.sign({ adminId: admin.id, type: 'admin', role: admin.role }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      message: 'Admin login successful',
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', (req, res) => {
  try {
    const db = getDb();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type === 'admin') {
      const admin = db.prepare('SELECT id, email, name, role FROM admins WHERE id = ?').get(decoded.adminId);
      if (!admin) {
        return res.status(404).json({ error: 'Admin not found' });
      }
      return res.json({ type: 'admin', ...admin });
    }

    const user = db.prepare('SELECT id, email, first_name, last_name, phone, address, city, state, zip FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      type: 'user',
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      address: user.address,
      city: user.city,
      state: user.state,
      zip: user.zip
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Update profile
router.put('/profile', (req, res) => {
  try {
    const db = getDb();
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type !== 'user') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { firstName, lastName, phone, address, city, state, zip } = req.body;

    db.prepare(`
      UPDATE users SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        zip = COALESCE(?, zip),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(firstName, lastName, phone, address, city, state, zip, decoded.userId);

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const db = getDb();
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { currentPassword, newPassword } = req.body;

    let user;
    if (decoded.type === 'admin') {
      user = db.prepare('SELECT * FROM admins WHERE id = ?').get(decoded.adminId);
    } else {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    if (decoded.type === 'admin') {
      db.prepare('UPDATE admins SET password = ? WHERE id = ?').run(hashedPassword, decoded.adminId);
    } else {
      db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashedPassword, decoded.userId);
    }

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;

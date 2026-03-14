const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

// Auth middleware (optional for chat)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Invalid token, but continue without auth
    }
  }
  next();
};

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

// Start new chat session
router.post('/session', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const sessionId = uuidv4();
    const userId = req.user?.userId || null;

    // Create initial system message
    db.prepare(`
      INSERT INTO chat_messages (session_id, user_id, sender, message)
      VALUES (?, ?, 'system', 'Chat session started. An agent will be with you shortly.')
    `).run(sessionId, userId);

    res.json({
      sessionId,
      message: 'Chat session created'
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

// Send message
router.post('/message', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'Session ID and message are required' });
    }

    const userId = req.user?.userId || null;

    db.prepare(`
      INSERT INTO chat_messages (session_id, user_id, sender, message)
      VALUES (?, ?, 'client', ?)
    `).run(sessionId, userId, message);

    // Auto-response for demo (in production, this would be handled by live agents or AI)
    const autoResponses = [
      "Thank you for your message! An agent will respond shortly.",
      "We've received your inquiry. Our team typically responds within a few minutes during business hours.",
      "Thanks for reaching out! While you wait, feel free to check out our services page for more information."
    ];

    const autoResponse = autoResponses[Math.floor(Math.random() * autoResponses.length)];

    setTimeout(() => {
      db.prepare(`
        INSERT INTO chat_messages (session_id, user_id, sender, message)
        VALUES (?, ?, 'agent', ?)
      `).run(sessionId, null, autoResponse);
    }, 1000);

    res.json({ message: 'Message sent' });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get chat messages for session
router.get('/messages/:sessionId', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const messages = db.prepare(`
      SELECT * FROM chat_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(req.params.sessionId);

    // Mark messages as read
    db.prepare(`
      UPDATE chat_messages SET read = 1
      WHERE session_id = ? AND sender != 'client'
    `).run(req.params.sessionId);

    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Poll for new messages (long polling alternative to websockets)
router.get('/poll/:sessionId', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const { lastId } = req.query;

    let query = `
      SELECT * FROM chat_messages
      WHERE session_id = ?
    `;
    const params = [req.params.sessionId];

    if (lastId) {
      query += ` AND id > ?`;
      params.push(lastId);
    }

    query += ` ORDER BY created_at ASC`;

    const messages = db.prepare(query).all(...params);

    res.json(messages);
  } catch (error) {
    console.error('Poll messages error:', error);
    res.status(500).json({ error: 'Failed to poll messages' });
  }
});

// Admin: Get all active chat sessions
router.get('/admin/sessions', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT
        session_id,
        user_id,
        MIN(created_at) as started_at,
        MAX(created_at) as last_message_at,
        COUNT(*) as message_count,
        SUM(CASE WHEN sender = 'client' AND read = 0 THEN 1 ELSE 0 END) as unread_count
      FROM chat_messages
      GROUP BY session_id
      ORDER BY last_message_at DESC
      LIMIT 50
    `).all();

    // Get user info for sessions with authenticated users
    const sessionsWithUsers = sessions.map(session => {
      if (session.user_id) {
        const user = db.prepare('SELECT first_name, last_name, email FROM users WHERE id = ?').get(session.user_id);
        return { ...session, user };
      }
      return { ...session, user: null };
    });

    res.json(sessionsWithUsers);
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Admin: Send message as agent
router.post('/admin/message', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'Session ID and message are required' });
    }

    db.prepare(`
      INSERT INTO chat_messages (session_id, user_id, sender, message)
      VALUES (?, NULL, 'agent', ?)
    `).run(sessionId, message);

    res.json({ message: 'Message sent' });
  } catch (error) {
    console.error('Admin send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Admin: Get unread message count
router.get('/admin/unread', adminAuth, (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM chat_messages
      WHERE sender = 'client' AND read = 0
    `).get();

    res.json({ unread: result.count });
  } catch (error) {
    console.error('Get unread error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

module.exports = router;

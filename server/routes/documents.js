const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Auth middleware
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

// Upload document (client)
router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { orderId, category } = req.body;
    const userId = req.user.userId || req.user.adminId;
    const uploadedBy = req.user.type === 'admin' ? 'admin' : 'client';

    // Verify order belongs to user (if user)
    if (orderId && req.user.type === 'user') {
      const order = db.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.userId);
      if (!order) {
        // Delete uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Not authorized to upload to this order' });
      }
    }

    const result = db.prepare(`
      INSERT INTO documents (user_id, order_id, filename, original_name, file_type, file_size, category, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.type === 'user' ? req.user.userId : (req.body.userId || null),
      orderId || null,
      req.file.filename,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      category || 'general',
      uploadedBy
    );

    res.json({
      message: 'File uploaded successfully',
      document: {
        id: result.lastInsertRowid,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Get user's documents
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    let query;
    let params;

    if (req.user.type === 'admin') {
      const { userId } = req.query;
      if (userId) {
        query = 'SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC';
        params = [userId];
      } else {
        query = 'SELECT d.*, u.email as user_email FROM documents d LEFT JOIN users u ON d.user_id = u.id ORDER BY d.created_at DESC LIMIT 100';
        params = [];
      }
    } else {
      query = 'SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC';
      params = [req.user.userId];
    }

    const documents = db.prepare(query).all(...params);

    res.json(documents.map(doc => ({
      ...doc,
      url: `/uploads/${doc.filename}`
    })));
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get documents for specific order
router.get('/order/:orderId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    let documents;

    if (req.user.type === 'admin') {
      documents = db.prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC').all(req.params.orderId);
    } else {
      // Verify order belongs to user
      const order = db.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').get(req.params.orderId, req.user.userId);
      if (!order) {
        return res.status(403).json({ error: 'Not authorized' });
      }
      documents = db.prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY created_at DESC').all(req.params.orderId);
    }

    res.json(documents.map(doc => ({
      ...doc,
      url: `/uploads/${doc.filename}`
    })));
  } catch (error) {
    console.error('Get order documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Delete document
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check authorization
    if (req.user.type === 'user' && document.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Delete file from disk
    const filePath = path.join(__dirname, '../../uploads', document.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

module.exports = router;

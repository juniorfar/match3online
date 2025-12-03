const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const paypal = require('../lib/paypal');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'adminkey';

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Bearer token' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/withdraw
// body: { amount, currency, paypal_email }
router.post('/', authMiddleware, async (req, res) => {
  const { amount, currency = 'USD', paypal_email } = req.body;
  const user = req.user;
  if (!amount || !paypal_email) return res.status(400).json({ error: 'amount and paypal_email required' });
  if (amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  const id = uuidv4();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO withdrawals (id, user_id, amount, currency, paypal_email, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, user.id, amount, currency, paypal_email, 'pending', now],
    function (err) {
      if (err) return res.status(500).json({ error: 'db error', details: err.message });
      res.json({ id, status: 'pending' });
    }
  );
});

// Admin: list withdrawals
router.get('/admin/list', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_API_KEY) return res.status(401).json({ error: 'invalid admin key' });

  db.all(`SELECT * FROM withdrawals ORDER BY requested_at DESC LIMIT 200`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Admin: approve -> trigger payout
router.post('/admin/approve/:id', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_API_KEY) return res.status(401).json({ error: 'invalid admin key' });

  const id = req.params.id;
  db.get(`SELECT * FROM withdrawals WHERE id = ?`, [id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'not pending' });

    // Basic validations
    const MIN_PAYOUT = 1.00;
    if (row.amount < MIN_PAYOUT) return res.status(400).json({ error: 'amount too small' });

    const sender_batch_id = `batch_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const sender_item_id = `item_${id}`;

    try {
      const payoutRes = await paypal.createPayout({
        sender_batch_id,
        amount: row.amount,
        currency: row.currency,
        receiver_email: row.paypal_email,
        note: `Payout for withdrawal ${id}`,
        sender_item_id
      });

      const processed_at = new Date().toISOString();

      // The response includes batch and item ids
      const batchId = payoutRes.batch_header && payoutRes.batch_header.payout_batch_id ? payoutRes.batch_header.payout_batch_id : null;
      const itemId = payoutRes.items && payoutRes.items[0] && payoutRes.items[0].payout_item_id ? payoutRes.items[0].payout_item_id : null;

      db.run(
        `UPDATE withdrawals SET status = ?, processed_at = ?, payout_batch_id = ?, payout_item_id = ? WHERE id = ?`,
        ['completed', processed_at, batchId, itemId, id],
        function (uerr) {
          if (uerr) return res.status(500).json({ error: 'db update failed', details: uerr.message });
          res.json({ ok: true, payout: payoutRes });
        }
      );
    } catch (e) {
      console.error('PayPal payout failed', e.response ? e.response.data : e.message);
      db.run(`UPDATE withdrawals SET status = ?, notes = ? WHERE id = ?`, ['failed', e.response ? JSON.stringify(e.response.data) : e.message, id]);
      return res.status(500).json({ error: 'payout_failed', details: e.response ? e.response.data : e.message });
    }
  });
});

// Admin: reject
router.post('/admin/reject/:id', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_API_KEY) return res.status(401).json({ error: 'invalid admin key' });

  const id = req.params.id;
  const reason = req.body.reason || 'rejected by admin';
  db.run(`UPDATE withdrawals SET status = ?, notes = ? WHERE id = ?`, ['rejected', reason, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

module.exports = router;
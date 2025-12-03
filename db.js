const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'withdrawals.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

function init() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      amount REAL,
      currency TEXT,
      paypal_email TEXT,
      status TEXT,
      requested_at TEXT,
      processed_at TEXT,
      payout_batch_id TEXT,
      payout_item_id TEXT,
      notes TEXT
    )`);
  });
}

module.exports = {
  db,
  init
};
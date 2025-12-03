const axios = require('axios');

const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
  console.warn('PAYPAL_CLIENT_ID or PAYPAL_SECRET not set. PayPal calls will fail until configured.');
}

function paypalBase() {
  if (PAYPAL_MODE === 'live') {
    return 'https://api-m.paypal.com';
  }
  // sandbox
  return 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken() {
  const url = `${paypalBase()}/v1/oauth2/token`;
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');

  const res = await axios.post(url, params.toString(), {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return res.data.access_token;
}

/**
 * Create a synchronous payout (for immediate response). For production consider asynchronous payout
 * or approved payout flows depending on account permissions.
 * docs: https://developer.paypal.com/docs/payouts/
 */
async function createPayout({ sender_batch_id, amount, currency, receiver_email, note = '', sender_item_id }) {
  const token = await getAccessToken();
  const url = `${paypalBase()}/v1/payments/payouts`;
  // For sync mode use sync_mode=true query parameter (or send synchronous body param)
  const body = {
    sender_batch_header: {
      sender_batch_id,
      email_subject: "You have a payout!",
      email_message: "You received a payout from match3online."
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: {
          value: amount.toFixed(2),
          currency: currency
        },
        receiver: receiver_email,
        note,
        sender_item_id
      }
    ]
  };

  const res = await axios.post(url, body, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  return res.data;
}

module.exports = {
  getAccessToken,
  createPayout
};
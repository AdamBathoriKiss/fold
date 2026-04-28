require('dotenv').config();
const express = require('express');
const path    = require('path');
const cors    = require('cors');
const Stripe  = require('stripe');

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const PORT   = process.env.PORT || 3000;
const BASE_URL     = process.env.BASE_URL || `http://localhost:${PORT}`;
const SHIPPING_FEE = parseInt(process.env.SHIPPING_FEE || '990');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/create-checkout', async (req, res) => {
  const { items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'Üres kosár.' });

  try {
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'huf',
        product_data: { name: item.name, description: item.sub || undefined },
        unit_amount: item.price * 100,
      },
      quantity: item.qty,
    }));

    lineItems.push({
      price_data: {
        currency: 'huf',
        product_data: { name: 'Szállítási díj', description: 'Futárszolgálat' },
        unit_amount: SHIPPING_FEE * 100,
      },
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      locale: 'hu',
      success_url: `${BASE_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${BASE_URL}/payment/cancel`,
    });

    console.log(`[CHECKOUT] Session: ${session.id}`);
    res.json({ url: session.url });

  } catch (err) {
    console.error('[STRIPE HIBA]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/checkout-result', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Hiányzó session_id.' });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({
      status:         session.payment_status,
      amount_total:   session.amount_total,
      customer_email: session.customer_details?.email,
      session_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/payment/success', (req, res) => {
  res.redirect(`/?page=result&status=success&session_id=${req.query.session_id}`);
});
app.get('/payment/cancel', (req, res) => {
  res.redirect('/?page=result&status=cancel');
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  FOLD Shop fut → http://localhost:${PORT}\n`);
  if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    console.warn('  ⚠️  Állítsd be a STRIPE_SECRET_KEY értéket a .env fájlban!\n');
  }
});

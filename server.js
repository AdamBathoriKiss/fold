require('dotenv').config();
const express    = require('express');
const path       = require('path');
const cors       = require('cors');
const Stripe     = require('stripe');
const nodemailer = require('nodemailer');

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const PORT   = process.env.PORT || 3000;
const BASE_URL     = process.env.BASE_URL || `http://localhost:${PORT}`;
const SHIPPING_FEE = parseInt(process.env.SHIPPING_FEE || '990');

// ── NODEMAILER TRANSPORT ──────────────────────────────────────────────────────
// Csak akkor inicializál, ha az SMTP_HOST be van állítva.
function createTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendOrderConfirmation(session) {
  const transport = createTransport();
  if (!transport) {
    console.warn('[EMAIL] SMTP nincs konfigurálva – e-mail kihagyva.');
    return;
  }

  const email  = session.customer_details?.email;
  const name   = session.customer_details?.name || 'Kedves Vásárló';
  if (!email) return;

  const amount = Math.round(session.amount_total / 100).toLocaleString('hu-HU');

  await transport.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      email,
    subject: 'FOLD – Sikeres rendelés visszaigazolása',
    html:    buildEmailHtml(name, amount, session.id),
  });

  console.log(`[EMAIL] Visszaigazoló elküldve → ${email}`);
}

function buildEmailHtml(name, amount, sessionId) {
  return `<!DOCTYPE html>
<html lang="hu">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1e9de;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1e9de;padding:48px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

      <!-- Header -->
      <tr><td align="center" style="background:#3b2618;border-radius:16px 16px 0 0;padding:40px 40px 32px;">
        <div style="font-size:40px;color:#fff;font-family:Georgia,'Times New Roman',serif;letter-spacing:4px;">FOLD</div>
        <div style="font-size:13px;color:rgba(255,255,255,.55);margin-top:8px;letter-spacing:.5px;">Több mint egy pénztárca</div>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#fff;padding:40px 40px 32px;">
        <p style="font-size:24px;font-family:Georgia,serif;color:#3b2618;margin:0 0 14px;line-height:1.2;">Köszönjük a rendelésedet!</p>
        <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 28px;">${name}, a fizetésed sikeresen megérkezett.<br>Hamarosan kiszállítjuk a <strong style="color:#3b2618;">FOLD</strong> pénztárcádat.</p>

        <!-- Order summary -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1e9de;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
          <tr>
            <td style="font-size:13px;font-weight:600;color:#7b5c45;text-transform:uppercase;letter-spacing:.06em;">Fizetett összeg</td>
            <td align="right" style="font-size:22px;font-family:Georgia,serif;color:#3b2618;font-weight:bold;">${amount} Ft</td>
          </tr>
          <tr>
            <td colspan="2" style="padding-top:12px;border-top:1px solid rgba(59,38,24,.1);margin-top:12px;">
              <span style="font-size:11px;color:#bbb;letter-spacing:.04em;">RENDELÉSSZÁM</span><br>
              <span style="font-size:12px;color:#999;font-family:monospace;">${sessionId}</span>
            </td>
          </tr>
        </table>

        <p style="font-size:13px;color:#aaa;line-height:1.7;margin:0;">Ha kérdésed van, válaszolj erre a levélre – szívesen segítünk.<br>Köszönjük, hogy a FOLD-ot választottad!</p>
      </td></tr>

      <!-- Footer -->
      <tr><td align="center" style="background:#3b2618;border-radius:0 0 16px 16px;padding:22px 40px;">
        <p style="font-size:12px;color:rgba(255,255,255,.4);margin:0;">© 2026 FOLD &nbsp;·&nbsp; Minden jog fenntartva</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── STRIPE WEBHOOK ────────────────────────────────────────────────────────────
// FONTOS: ez az express.json() ELŐTT kell, mert raw body-t igényel.
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[WEBHOOK] STRIPE_WEBHOOK_SECRET nincs beállítva.');
    return res.status(400).send('Webhook secret hiányzik.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[WEBHOOK] Érvénytelen signature:', err.message);
    return res.status(400).send(`Webhook hiba: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      try {
        await sendOrderConfirmation(session);
      } catch (err) {
        console.error('[EMAIL] Küldési hiba:', err.message);
      }
    }
  }

  res.json({ received: true });
});

// ── GLOBAL MIDDLEWARE ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API VÉGPONTOK ─────────────────────────────────────────────────────────────
app.post('/api/create-checkout', async (req, res) => {
  const { items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'Üres kosár.' });

  try {
    const lineItems = items.map(item => ({
      price_data: {
        currency:     'huf',
        product_data: { name: item.name, description: item.sub || undefined },
        unit_amount:  item.price * 100,
      },
      quantity: item.qty,
    }));

    lineItems.push({
      price_data: {
        currency:     'huf',
        product_data: { name: 'Szállítási díj', description: 'Futárszolgálat' },
        unit_amount:  SHIPPING_FEE * 100,
      },
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items:           lineItems,
      mode:                 'payment',
      locale:               'hu',
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
  if (!process.env.SMTP_HOST) {
    console.warn('  ⚠️  SMTP nincs konfigurálva – e-mail visszaigazolás kikapcsolva.\n');
  }
});

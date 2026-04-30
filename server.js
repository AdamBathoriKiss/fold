require('dotenv').config();
const express      = require('express');
const path         = require('path');
const cors         = require('cors');
const crypto       = require('crypto');
const Stripe       = require('stripe');
const nodemailer   = require('nodemailer');

const app    = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const PORT   = process.env.PORT || 3000;
const BASE_URL     = process.env.BASE_URL || `http://localhost:${PORT}`;
const SHIPPING_FEE   = parseInt(process.env.SHIPPING_FEE   || '2000');
const GLS_PICKUP_FEE = parseInt(process.env.GLS_PICKUP_FEE || '1400');

// ── GLS API ───────────────────────────────────────────────────────────────────
const GLS_BASE   = process.env.GLS_API_BASE || 'https://api.test.mygls.hu';
const GLS_USER   = process.env.GLS_USERNAME  || '';
const GLS_PASS   = process.env.GLS_PASSWORD  || '';
const GLS_CLIENT = parseInt(process.env.GLS_CLIENT_NUMBER || '0');

function glsPasswordHash() {
  return Array.from(crypto.createHash('sha512').update(GLS_PASS, 'utf8').digest());
}

async function glsPost(operation, body) {
  const url = `${GLS_BASE}/ParcelService.svc/json/${operation}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  });
  const text = await res.text();
  try   { return JSON.parse(text); }
  catch { throw new Error('GLS JSON parse error: ' + text.slice(0, 200)); }
}


// Kiszállítás létrehozása a GLS API-n keresztül
async function glsCreateShipment(meta, customerEmail) {
  if (!GLS_USER || !GLS_PASS || !GLS_CLIENT) {
    console.warn('[GLS] Hiányzó GLS_USERNAME / GLS_PASSWORD / GLS_CLIENT_NUMBER.');
    return null;
  }

  const isPickup   = meta.shipping_method === 'pickup';
  const pickupDate = `\/Date(${Date.now()})\/`;

  const deliveryAddress = isPickup
    ? {
        Name:          meta.pickup_name    || 'GLS Csomagpont',
        City:          meta.pickup_city    || '',
        Street:        meta.pickup_street  || (meta.pickup_address || '').split(',')[0]?.trim() || '',
        HouseNumber:   '1',
        ZipCode:       meta.pickup_zip     || (meta.pickup_address || '').match(/\d{4}/)?.[0] || '',
        CountryIsoCode:'HU',
        ContactName:   meta.customer_name  || '',
        ContactPhone:  meta.customer_phone || '',
        ContactEmail:  customerEmail       || '',
      }
    : {
        Name:          meta.customer_name  || '',
        City:          meta.ship_city      || '',
        Street:        (meta.ship_street   || '').replace(/\s+\d.*/, '').trim(),
        HouseNumber:   (meta.ship_street   || '').match(/\d+.*$/)?.[0] || '1',
        ZipCode:       meta.ship_zip       || '',
        CountryIsoCode:'HU',
        ContactName:   meta.customer_name  || '',
        ContactPhone:  meta.customer_phone || '',
        ContactEmail:  customerEmail       || '',
      };

  const pickupIdInt = parseInt(meta.pickup_id);
  const serviceList = isPickup && meta.pickup_id
    ? [{ Code: 'PSD', PSDParameter: isNaN(pickupIdInt)
        ? { StringValue: String(meta.pickup_id) }
        : { IntegerValue: pickupIdInt } }]
    : [];

  // Backup cím PSD-hez, ha a csomagpont elérhetetlenné válik
  const finalDeliveryAddress = isPickup && meta.ship_zip && meta.ship_city
    ? {
        Name:          meta.customer_name  || '',
        City:          meta.ship_city      || '',
        Street:        (meta.ship_street   || '').replace(/\s+\d.*/, '').trim(),
        HouseNumber:   (meta.ship_street   || '').match(/\d+.*$/)?.[0] || '1',
        ZipCode:       meta.ship_zip       || '',
        CountryIsoCode:'HU',
        ContactName:   meta.customer_name  || '',
        ContactPhone:  meta.customer_phone || '',
        ContactEmail:  customerEmail       || '',
      }
    : null;

  const parcel = {
    ClientNumber:    GLS_CLIENT,
    ClientReference: `FOLD-${Date.now()}`,
    Count:           1,
    Content:         'FOLD pénztárca',
    PickupDate:      pickupDate,
    DeliveryAddress: deliveryAddress,
    PickupAddress: {
      Name:          process.env.GLS_SENDER_NAME   || 'FOLD Shop',
      City:          process.env.GLS_SENDER_CITY   || '',
      Street:        process.env.GLS_SENDER_STREET || '',
      HouseNumber:   process.env.GLS_SENDER_HOUSENUMBER || '1',
      ZipCode:       process.env.GLS_SENDER_ZIP    || '',
      CountryIsoCode:process.env.GLS_SENDER_COUNTRY || 'HU',
      ContactName:   process.env.GLS_SENDER_NAME   || 'FOLD Shop',
      ContactPhone:  process.env.GLS_SENDER_PHONE  || '',
      ContactEmail:  process.env.GLS_SENDER_EMAIL  || '',
    },
    ...(serviceList.length         ? { ServiceList: serviceList }                    : {}),
    ...(finalDeliveryAddress       ? { FinalDeliveryAddress: finalDeliveryAddress }  : {}),
  };

  try {
    const response = await glsPost('PrintLabels', {
      Username:        GLS_USER,
      Password:        glsPasswordHash(),
      WebshopEngine:   'custom',
      PrintPosition:   1,
      ShowPrintDialog: false,
      ParcelList:      [parcel],
    });

    const errors = response.PrintLabelsErrorList || [];
    if (errors.length > 0) {
      console.warn('[GLS] PrintLabels hiba:', JSON.stringify(errors));
      return null;
    }

    const info = (response.PrintLabelsInfoList || [])[0];
    const trackingNumber = info?.ParcelNumber ? String(info.ParcelNumber) : null;
    console.log(`[GLS] Küldemény létrehozva, csomagszám: ${trackingNumber}`);
    return { trackingNumber, labelBase64: response.Labels || null };
  } catch (err) {
    console.error('[GLS] Shipment hiba:', err.message);
    return null;
  }
}

// ── GLS CSOMAGPONTOK (nyilvános térkép API) ────────────────────────────────────
const GLS_PUBLIC_URL = 'https://map.gls-hungary.com/data/deliveryPoints/hu.json';
let glsShopCache = { data: null, ts: 0 };
const GLS_CACHE_TTL = 6 * 60 * 60 * 1000;

async function glsFetchParcelShops() {
  if (glsShopCache.data && Date.now() - glsShopCache.ts < GLS_CACHE_TTL) {
    return glsShopCache.data;
  }
  const res = await fetch(GLS_PUBLIC_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GLS HTTP ${res.status}`);
  const list = await res.json();
  const arr  = Array.isArray(list) ? list : (list.items || []);
  const normalized = normalizeGlsShops(arr);
  glsShopCache = { data: normalized, ts: Date.now() };
  console.log(`[GLS] ${normalized.length} csomagpont betöltve.`);
  return normalized;
}

function normalizeGlsShops(arr) {
  const days = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  return (arr || []).map(s => {
    const c = s.contact || {};
    const hours = (s.hours || [])
      .sort((a, b) => a[0] - b[0])
      .map(([d, open, close]) => `${days[d - 1]}: ${open}–${close}`)
      .join('; ');
    return {
      id:      s.id,
      name:    s.name || '',
      address: [c.address, c.postalCode && c.city ? `${c.postalCode} ${c.city}` : c.city].filter(Boolean).join(', '),
      city:    c.city       || '',
      zip:     c.postalCode || '',
      hours,
      lat:     s.location?.[0] ?? null,
      lng:     s.location?.[1] ?? null,
    };
  });
}

// ── NODEMAILER (SMTP) ─────────────────────────────────────────────────────────
function createTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE !== 'false',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function calcDeliveryDate(method) {
  const d = new Date();
  const days = method === 'pickup' ? 5 : 3;
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function sendOrderConfirmation(session, glsTracking) {
  const transport = createTransport();
  if (!transport) {
    console.warn('[EMAIL] SMTP nincs konfigurálva – e-mail kihagyva.');
    return;
  }

  const email = session.customer_details?.email;
  const meta  = session.metadata || {};
  const name  = meta.customer_name || session.customer_details?.name || 'Kedves Vásárló';
  if (!email) return;

  const amount = Math.round(session.amount_total / 100).toLocaleString('hu-HU');

  await transport.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      email,
    subject: 'FOLD – Sikeres rendelés visszaigazolása',
    html:    buildEmailHtml({
      name,
      amount,
      sessionId:    session.id,
      phone:        meta.customer_phone  || '',
      method:       meta.shipping_method || 'home',
      pickupName:   meta.pickup_name     || '',
      pickupAddr:   meta.pickup_address  || '',
      shipZip:      meta.ship_zip        || '',
      shipCity:     meta.ship_city       || '',
      shipStreet:   meta.ship_street     || '',
      deliveryDate: calcDeliveryDate(meta.shipping_method),
      trackingNumber: glsTracking || '',
    }),
  });

  console.log(`[EMAIL] Visszaigazoló elküldve → ${email}`);
}

function buildEmailHtml({ name, amount, sessionId, phone, method, pickupName, pickupAddr,
                          shipZip, shipCity, shipStreet, deliveryDate, trackingNumber }) {
  const isPickup = method === 'pickup';

  const shippingBlock = isPickup
    ? `<tr>
         <td style="font-size:13px;font-weight:600;color:#7b5c45;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px;">Szállítási mód</td>
         <td align="right" style="font-size:13px;color:#3b2618;font-weight:500;">GLS Csomagpont</td>
       </tr>
       ${pickupName ? `<tr>
         <td style="font-size:12px;color:#999;padding-bottom:2px;">Csomagpont neve</td>
         <td align="right" style="font-size:12px;color:#555;">${pickupName}</td>
       </tr>` : ''}
       ${pickupAddr ? `<tr>
         <td style="font-size:12px;color:#999;padding-bottom:2px;">Cím</td>
         <td align="right" style="font-size:12px;color:#555;">${pickupAddr}</td>
       </tr>` : ''}`
    : `<tr>
         <td style="font-size:13px;font-weight:600;color:#7b5c45;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px;">Szállítási mód</td>
         <td align="right" style="font-size:13px;color:#3b2618;font-weight:500;">GLS házhozszállítás</td>
       </tr>
       ${(shipZip || shipCity || shipStreet) ? `<tr>
         <td style="font-size:12px;color:#999;padding-bottom:2px;">Szállítási cím</td>
         <td align="right" style="font-size:12px;color:#555;">${shipZip} ${shipCity}, ${shipStreet}</td>
       </tr>` : ''}`;

  const contactBlock = phone ? `<tr>
    <td style="font-size:12px;color:#999;padding-bottom:2px;">Telefonszám</td>
    <td align="right" style="font-size:12px;color:#555;">${phone}</td>
  </tr>` : '';

  const trackingBlock = trackingNumber ? `<tr>
    <td style="font-size:12px;color:#999;padding-bottom:2px;">GLS csomagszám</td>
    <td align="right" style="font-size:12px;color:#3b2618;font-weight:600;font-family:monospace;">${trackingNumber}</td>
  </tr>` : '';

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
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1e9de;border-radius:12px;padding:20px 24px;margin-bottom:20px;">
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

        <!-- Shipping & contact details -->
        <table width="100%" cellpadding="4" cellspacing="0" style="background:#f1e9de;border-radius:12px;padding:16px 24px;margin-bottom:20px;">
          ${shippingBlock}
          ${contactBlock}
          ${trackingBlock}
          ${deliveryDate ? `<tr>
            <td style="font-size:12px;color:#999;padding-top:8px;border-top:1px solid rgba(59,38,24,.08);">Várható ${isPickup ? 'megérkezés a csomagpontra' : 'kézbesítés'}</td>
            <td align="right" style="font-size:12px;color:#3b2618;font-weight:600;padding-top:8px;border-top:1px solid rgba(59,38,24,.08);">${deliveryDate}</td>
          </tr>` : ''}
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
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
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
      const meta  = session.metadata || {};
      const email = session.customer_details?.email;

      // GLS küldemény létrehozása
      let glsResult = null;
      try {
        glsResult = await glsCreateShipment(meta, email);
        if (glsResult?.trackingNumber) {
          // Mentjük a tracking számot Stripe metadatába (nem blokkol)
          stripe.checkout.sessions.update(session.id, {
            metadata: { ...meta, gls_tracking: glsResult.trackingNumber },
          }).catch(() => {});
        }
      } catch (err) {
        console.error('[GLS] Küldemény hiba:', err.message);
      }

      try {
        await sendOrderConfirmation(session, glsResult?.trackingNumber || '');
      } catch (err) {
        console.error('[EMAIL] Küldési hiba:', err.message);
      }
    }
  }

  res.json({ received: true });
});

// ── GLOBAL MIDDLEWARE ─────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── GLS CSOMAGPONT KERESŐ ─────────────────────────────────────────────────────
app.get('/api/gls-parcelshops', async (req, res) => {
  const { zip, city } = req.query;
  if (!zip && !city) return res.status(400).json({ error: 'Adj meg irányítószámot vagy várost!' });

  try {
    const allShops = await glsFetchParcelShops();
    const q = (zip || city || '').toLowerCase();
    const hits = allShops.filter(s =>
      (zip  && s.zip?.startsWith(zip)) ||
      (city && (
        s.city?.toLowerCase().includes(q) ||
        s.name?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q)
      ))
    );
    console.log(`[GLS] ${hits.length} csomagpont (${zip || city})`);
    return res.json(hits.slice(0, 30));
  } catch (err) {
    console.error('[GLS] Csomagpont hiba:', err.message);
    res.status(500).json({ error: 'A GLS csomagpont lista jelenleg nem elérhető.' });
  }
});

// ── API VÉGPONTOK ─────────────────────────────────────────────────────────────
app.post('/api/create-checkout', async (req, res) => {
  const {
    items, shippingMethod,
    customerName, customerPhone,
    pickupPointId, pickupPointName, pickupPointAddress,
    shippingAddress,
  } = req.body;
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

    const isPickup = shippingMethod === 'pickup';
    const shipFee  = isPickup ? GLS_PICKUP_FEE : SHIPPING_FEE;
    lineItems.push({
      price_data: {
        currency:     'huf',
        product_data: {
          name:        isPickup ? 'GLS Csomagpont szállítás' : 'GLS Házhozszállítás',
          description: isPickup ? 'GLS csomagpont kézbesítés' : 'GLS házhozszállítás',
        },
        unit_amount: shipFee * 100,
      },
      quantity: 1,
    });

    const metadata = {
      customer_name:   customerName  || '',
      customer_phone:  customerPhone || '',
      shipping_method: shippingMethod || 'home',
    };
    if (isPickup) {
      metadata.pickup_id      = String(pickupPointId || '');
      metadata.pickup_name    = pickupPointName    || '';
      metadata.pickup_address = pickupPointAddress || '';
    } else if (shippingAddress) {
      metadata.ship_zip    = shippingAddress.zip    || '';
      metadata.ship_city   = shippingAddress.city   || '';
      metadata.ship_street = shippingAddress.street || '';
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items:           lineItems,
      mode:                 'payment',
      locale:               'hu',
      metadata,
      success_url: `${BASE_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${BASE_URL}/payment/cancel`,
    });

    console.log(`[CHECKOUT] Session: ${session.id}, szállítás: ${shippingMethod}${isPickup ? ` → ${pickupPointName}` : ''}`);
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
    const meta    = session.metadata || {};
    res.json({
      status:          session.payment_status,
      amount_total:    session.amount_total,
      customer_email:  session.customer_details?.email,
      customer_name:   meta.customer_name   || '',
      customer_phone:  meta.customer_phone  || '',
      shipping_method: meta.shipping_method || '',
      pickup_name:     meta.pickup_name     || '',
      pickup_address:  meta.pickup_address  || '',
      ship_zip:        meta.ship_zip        || '',
      ship_city:       meta.ship_city       || '',
      ship_street:     meta.ship_street     || '',
      gls_tracking:    meta.gls_tracking    || '',
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
  console.log('  GLS Csomagpontok → map.gls-hungary.com (nyilvános API)\n');
  if (!GLS_USER || !GLS_PASS) {
    console.warn('  ⚠️  GLS_USERNAME / GLS_PASSWORD hiányzik – GLS szállítmányozás kikapcsolva.\n');
  } else {
    console.log(`  GLS Szállítmányozás API → ${GLS_BASE} (${GLS_USER})\n`);
  }
});

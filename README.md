# FOLD Shop – Stripe Fizetési Integráció
## Telepítési útmutató

---

## Gyors indítás (3 lépés)

### 1. Stripe regisztráció (2 perc, ingyenes)

Menj ide: **https://dashboard.stripe.com/register**

- Adj meg egy e-mail címet és jelszót
- Kész — azonnal kapsz teszt API kulcsokat, **semmi más nem kell**
- Nincs céges adatot, KYC-t, mobilappot, külön teszt oldalt

### 2. Teszt API kulcs kimásolása

Belépés után a Stripe Dashboard-on:
**Developers → API keys** (bal oldali menü)

Másold ki a **Secret key**-t — ez `sk_test_...` előtaggal kezdődik.

> ⚠️ Győződj meg róla, hogy a **"Test mode"** van bekapcsolva (jobb felső sarokban)

### 3. Projekt indítása

```bash
# Kicsomagolás
unzip fold-shop.zip && cd fold-shop

# Függőségek
npm install

# .env fájl létrehozása
cp .env.example .env
# → Nyisd meg .env-t és írd be a sk_test_... kulcsot

# Indítás
npm run dev
```

Nyisd meg: **http://localhost:3000**

---

## Tesztelés

A Stripe fizetési oldalon ezeket a teszt kártyaszámokat használd:

| Kártya száma          | Lejárat      | CVC  | Eredmény        |
|-----------------------|--------------|------|-----------------|
| `4242 4242 4242 4242` | bármilyen jövőbeli | bármilyen 3 jegyű | ✅ Sikeres |
| `4000 0000 0000 0002` | bármilyen | bármilyen | ❌ Sikertelen (kártya elutasítva) |
| `4000 0025 0000 3155` | bármilyen | bármilyen | 🔐 3D Secure hitelesítés |

---

## Projekt struktúra

```
fold-shop/
├── server.js          ← Node.js backend (Express + Stripe)
├── package.json
├── .env               ← Titkos kulcs (NE commitold!)
├── .env.example       ← Sablon
├── README.md
└── public/
    └── index.html     ← Frontend (landing + kosár + eredmény)
```

## Élesbe állítás

1. Stripe Dashboard-on kapcsolj **Live mode**-ra
2. Másold ki az **éles** `sk_live_...` kulcsot
3. `.env`-ben cseréld le: `STRIPE_SECRET_KEY=sk_live_...`
4. `BASE_URL`-t állítsd az éles domain-re


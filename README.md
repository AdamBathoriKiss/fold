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

## Stripe CLI – Webhook-ok helyi tesztelése

A Stripe CLI-vel élő webhook-eseményeket tudsz a saját gépedreredirektálni, így az e-mail visszaigazoló helyi fejlesztés közben is lefut.

### Stripe CLI letöltése

Töltsd le a legfrissebb verziót az operációs rendszerednek megfelelően:

**Linux (x86-64):**
```bash
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee /etc/apt/sources.list.d/stripe.list
sudo apt update && sudo apt install stripe
```

**macOS:**
```bash
brew install stripe/stripe-cli/stripe
```

**Windows:**
Töltsd le az `.exe`-t innen: https://docs.stripe.com/stripe-cli

### Bejelentkezés

```bash
stripe login
```

Ez megnyit egy böngésző-ablakot — a Stripe-fiókodba kell belépni. Sikeres belépés után a CLI elmenti a hitelesítési adatokat.

### Webhook-ok helyi átirányítása

Az alábbi parancs a Stripe-tól érkező eseményeket a helyi szerveredre továbbítja:

```bash
stripe listen --forward-to localhost:3000/webhook
```

A terminál kiírja a **webhook signing secret**-et, például:
```
> Ready! Your webhook signing secret is whsec_abc123...
```

Másold be ezt az értéket a `.env` fájlba:
```
STRIPE_WEBHOOK_SECRET=whsec_abc123...
```

> A szervert indítsd újra az `.env` módosítása után (`npm run dev`).

### Esemény manuális kiváltása (opcionális)

Sikeres fizetés szimulálásához futtasd egy másik terminálban:

```bash
stripe trigger checkout.session.completed
```

### Fejlesztési munkafolyamat összefoglalva

```
1. npm run dev                              ← szerver indítása (3000-es port)
2. stripe login                             ← egyszeri bejelentkezés
3. stripe listen --forward-to \
       localhost:3000/webhook               ← webhook-ok átirányítása
4. Vásárlás a weboldalon teszt kártyával
5. A terminálban látod az eseményt és az e-mail küldés naplóját
```

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

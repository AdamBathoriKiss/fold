/* ── PAGE SWITCHER ── */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(name + '-page').classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'cart') renderCart();
  if (name === 'landing' && !document.getElementById('galleryFade').classList.contains('hidden')) {
    requestAnimationFrame(() => requestAnimationFrame(initGallery));
  }
}

/* ── NAVBAR SCROLL ── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 10);
});

/* ── MOBILE MENU ── */
function toggleMenu() {
  document.getElementById('hamburger').classList.toggle('open');
  document.getElementById('mobileMenu').classList.toggle('open');
}
function closeMenu() {
  document.getElementById('hamburger').classList.remove('open');
  document.getElementById('mobileMenu').classList.remove('open');
}

/* ── GALLERY ── */
function initGallery() {
  const wrap = document.getElementById('galleryWrap');
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  const fullH = grid.scrollHeight || grid.offsetHeight;
  if (!fullH) return;
  wrap.style.transition = 'none';
  wrap.style.maxHeight = Math.round(fullH * 0.78) + 'px';
  wrap.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    wrap.style.transition = 'max-height .7s cubic-bezier(.4,0,.2,1)';
  });
}
function expandGallery() {
  const wrap = document.getElementById('galleryWrap');
  const grid = document.getElementById('galleryGrid');
  wrap.style.maxHeight = grid.scrollHeight + 'px';
  wrap.style.overflow = 'visible';
  document.getElementById('galleryFade').classList.add('hidden');
  document.getElementById('btnCollapse').classList.add('visible');
}
function collapseGallery() {
  const wrap = document.getElementById('galleryWrap');
  const grid = document.getElementById('galleryGrid');
  wrap.style.maxHeight = Math.round((grid.scrollHeight || grid.offsetHeight) * 0.78) + 'px';
  wrap.style.overflow = 'hidden';
  document.getElementById('galleryFade').classList.remove('hidden');
  document.getElementById('btnCollapse').classList.remove('visible');
}
window.addEventListener('load', initGallery);

/* ── SCROLL REVEAL ── */
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

/* ── CART STATE ── */
const SHIPPING   = 2000;
const PICKUP_FEE = 1400;
let cartItems = [];

let shippingMethod    = null;
let selectedPickup    = null;
let pickupSearchTimer = null;
let lastPickupResults = [];

const fmt        = n => n.toLocaleString('hu-HU') + ' Ft';
const trashIcon  = `<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ── SHIPPING ── */
function selectShipping(method) {
  shippingMethod = method;
  if (method !== 'pickup') selectedPickup = null;
  document.querySelectorAll('.ship-opt').forEach(el =>
    el.classList.toggle('selected', el.dataset.m === method)
  );
  document.getElementById('pickupPanel').style.display   = method === 'pickup' ? '' : 'none';
  document.getElementById('customerPanel').style.display = '';
  document.getElementById('addressPanel').style.display  = method === 'home' ? '' : 'none';
  if (method === 'pickup') {
    document.getElementById('pickupList').innerHTML = pickupHint('Adja meg az irányítószámát vagy a városnevét a GLS csomagpontok kereséséhez.');
    document.getElementById('pickupSearch').value = '';
  }
  renderShippingDisplay();
}

function onPickupInput(val) {
  clearTimeout(pickupSearchTimer);
  const q = val.trim();
  if (q.length === 0) {
    document.getElementById('pickupList').innerHTML = pickupHint('Adja meg az irányítószámát vagy a városnevét a GLS csomagpontok kereséséhez.');
  } else if (q.length < 3) {
    document.getElementById('pickupList').innerHTML = pickupHint('Írjon be legalább 3 karaktert…');
  } else {
    pickupSearchTimer = setTimeout(doPickupSearch, 400);
  }
}

async function doPickupSearch() {
  const q = document.getElementById('pickupSearch').value.trim();
  if (!q) {
    document.getElementById('pickupList').innerHTML = pickupHint('Adja meg az irányítószámát vagy a városnevét a GLS csomagpontok kereséséhez.');
    return;
  }
  const isZip = /^\d{3,4}$/.test(q);
  const list  = document.getElementById('pickupList');
  list.innerHTML = pickupHint('Keresés…');
  try {
    const param = isZip ? `zip=${encodeURIComponent(q)}` : `city=${encodeURIComponent(q)}`;
    const r     = await fetch(`/api/gls-parcelshops?${param}`);
    const shops = await r.json();
    if (Array.isArray(shops) && shops.length > 0) {
      renderPickupList(shops);
    } else {
      list.innerHTML = pickupHint('Nincs találat. Próbálj más irányítószámot vagy városnevet!');
    }
  } catch {
    list.innerHTML = pickupHint('A GLS csomagpont lista jelenleg nem elérhető, kérjük próbálja újra.');
  }
}

function pickupHint(msg) {
  return `<div style="padding:10px 12px;font-size:12px;color:#bbb;">${msg}</div>`;
}

function renderPickupList(points) {
  lastPickupResults = points;
  document.getElementById('pickupList').innerHTML = points.length
    ? points.map((p, i) => `
        <div class="pickup-item${selectedPickup === p.id ? ' selected' : ''}" onclick="selectPickupByIndex(${i})">
          <div class="pickup-item-name">${p.name}</div>
          <div class="pickup-item-addr">${p.address}</div>
          ${p.hours ? `<div class="pickup-item-hours">${p.hours}</div>` : ''}
        </div>`).join('')
    : pickupHint('Nincs találat. Próbálj más irányítószámot vagy városnevet!');
}

function selectPickupByIndex(i) {
  const p = lastPickupResults[i];
  if (!p) return;
  selectedPickup = p.id;
  document.getElementById('pickupSelectedContent').innerHTML = `
    <div class="pickup-item-name">${p.name}</div>
    <div class="pickup-item-addr">${p.address}</div>
    ${p.hours ? `<div class="pickup-item-hours">${p.hours}</div>` : ''}`;
  document.getElementById('pickupSearchView').style.display   = 'none';
  document.getElementById('pickupSelectedView').style.display = '';
  renderShippingDisplay();
}

function showPickupSearch() {
  document.getElementById('pickupSelectedView').style.display = 'none';
  document.getElementById('pickupSearchView').style.display   = '';
  document.getElementById('pickupSearch').focus();
  if (lastPickupResults.length) renderPickupList(lastPickupResults);
}

function renderShippingDisplay() {
  const subtotal = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
  if (!cartItems.length) {
    document.getElementById('sumShipping').textContent = '–';
    document.getElementById('sumTotal').textContent    = '–';
    return;
  }
  const fee = shippingMethod === 'pickup' ? PICKUP_FEE : shippingMethod === 'home' ? SHIPPING : null;
  document.getElementById('sumShipping').textContent = fee !== null ? fmt(fee)      : 'Válassz módot';
  document.getElementById('sumTotal').textContent    = fee !== null ? fmt(subtotal + fee) : fmt(subtotal);
}

/* ── DIALOG ── */
const DLG_COLORS = {
  'Barna':      { sub: 'Teljes kiőrlésű bőr · Barna',      img: '/images/barna.png' },
  'Sötétbarna': { sub: 'Teljes kiőrlésű bőr · Sötétbarna', img: '/images/sotetbarna.png' },
  'Fekete':     { sub: 'Teljes kiőrlésű bőr · Fekete',      img: '/images/fekete.png' },
};
let dlgColor = null;
let dlgQty   = 1;

function openDialog() {
  dlgColor = null;
  dlgQty   = 1;
  document.getElementById('dlgQtyVal').textContent = 1;
  document.querySelectorAll('.color-chip').forEach(b => b.classList.remove('selected'));
  document.getElementById('btnAddItem').disabled = true;
  document.getElementById('btnAddItem').textContent = 'Hozzáadás a kosárhoz';
  const thumbs = document.querySelectorAll('.dialog-thumb');
  thumbs.forEach((t, i) => t.classList.toggle('active', i === 0));
  document.getElementById('dlgMainImg').src = thumbs[0].src;
  document.getElementById('addDialog').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDialog() {
  document.getElementById('addDialog').classList.remove('open');
  document.body.style.overflow = '';
}

function dlgOverlayClick(e) {
  if (e.target === document.getElementById('addDialog')) closeDialog();
}

function dlgSetMain(el) {
  document.getElementById('dlgMainImg').src = el.src;
  document.querySelectorAll('.dialog-thumb').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

function dlgSelectColor(btn) {
  document.querySelectorAll('.color-chip').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  dlgColor = btn.dataset.color;
  document.getElementById('dlgMainImg').src = btn.dataset.img;
  document.querySelectorAll('.dialog-thumb').forEach(t => {
    t.classList.toggle('active', t.src === btn.dataset.img);
  });
  dlgUpdateBtn();
}

function dlgQtyChange(delta) {
  dlgQty = Math.max(1, dlgQty + delta);
  document.getElementById('dlgQtyVal').textContent = dlgQty;
  dlgUpdateBtn();
}

function dlgUpdateBtn() {
  document.getElementById('btnAddItem').disabled = !dlgColor || dlgQty < 1;
}

function dlgAddToCart() {
  if (!dlgColor) return;
  const c = DLG_COLORS[dlgColor];
  const existing = cartItems.find(i => i.name === 'FOLD ' + dlgColor);
  if (existing) {
    existing.qty += dlgQty;
  } else {
    cartItems.push({ id: Date.now(), name: 'FOLD ' + dlgColor, sub: c.sub, price: 4500, qty: dlgQty, img: c.img });
  }
  renderCart();
  document.getElementById('btnAddItem').textContent = 'Hozzáadva! ✓';
  setTimeout(closeDialog, 700);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDialog(); });

/* ── CART ── */
function renderCart() {
  const container = document.getElementById('cartItems');
  const totalQty  = cartItems.reduce((s, i) => s + i.qty, 0);
  const subtotal  = cartItems.reduce((s, i) => s + i.price * i.qty, 0);

  document.getElementById('cartSubheading').textContent =
    totalQty === 0 ? 'A kosarad üres.' :
    totalQty === 1 ? '1 termék van a kosaradban' :
    totalQty + ' termék van a kosaradban';

  if (cartItems.length === 0) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;padding:48px 0;text-align:center;">
        <div style="font-family:var(--serif);font-size:24px;color:var(--muted);margin-bottom:8px;">A kosarad üres.</div>
        <div style="font-size:14px;color:#aaa;margin-bottom:24px;">Válassz egy pénztárcát és add hozzá a kosárhoz.</div>
        <button class="btn-open-dialog" onclick="openDialog()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.2" stroke-linecap="round"/></svg>
          Termék hozzáadása
        </button>
      </div>`;
  } else {
    container.innerHTML = cartItems.map(item => `
      <div class="cart-item" data-id="${item.id}">
        <img class="cart-item-img" src="${item.img}" alt="${item.name}" loading="lazy" />
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-sub">${item.sub}</div>
        </div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="changeQty(${item.id}, -1)">−</button>
          <span>${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id}, +1)">+</button>
        </div>
        <div class="cart-item-price">${fmt(item.price * item.qty)}</div>
        <button class="trash-btn" onclick="removeItem(${item.id})">${trashIcon}</button>
      </div>`).join('') + `
      <button class="btn-open-dialog" style="align-self:flex-start;margin-top:4px;" onclick="openDialog()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.2" stroke-linecap="round"/></svg>
        Termék hozzáadása
      </button>`;
  }

  document.getElementById('sumSubtotal').textContent = cartItems.length ? fmt(subtotal) : '–';
  renderShippingDisplay();

  const badge = document.getElementById('cartBadge');
  badge.textContent = totalQty;
  badge.classList.toggle('zero', totalQty === 0);
}

function changeQty(id, delta) {
  const item = cartItems.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeItem(id);
  else renderCart();
}

function removeItem(id) {
  cartItems = cartItems.filter(i => i.id !== id);
  renderCart();
}

/* ── PAYMENT ── */
async function startPayment() {
  if (!cartItems.length) { showToast('A kosarad üres!'); return; }

  if (!shippingMethod) { showToast('Kérjük, válassz szállítási módot!'); return; }
  if (shippingMethod === 'pickup' && !selectedPickup) { showToast('Kérjük, válassz egy csomagpontot!'); return; }

  const name  = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  if (!name || !phone) { showToast('Kérjük, add meg a neved és telefonszámodat!'); return; }

  if (shippingMethod === 'home') {
    const zip    = document.getElementById('custZip').value.trim();
    const city   = document.getElementById('custCity').value.trim();
    const street = document.getElementById('custStreet').value.trim();
    if (!zip || !city || !street) { showToast('Kérjük, add meg a szállítási címet!'); return; }
  }

  const btn = document.getElementById('btnPay');
  btn.disabled = true;
  btn.textContent = 'Feldolgozás…';

  const body = { items: cartItems, shippingMethod, customerName: name, customerPhone: phone };
  if (shippingMethod === 'pickup') {
    const pp = lastPickupResults.find(p => p.id === selectedPickup);
    body.pickupPointId      = selectedPickup;
    body.pickupPointName    = pp?.name    || '';
    body.pickupPointAddress = pp?.address || '';
  } else {
    body.shippingAddress = {
      zip:    document.getElementById('custZip').value.trim(),
      city:   document.getElementById('custCity').value.trim(),
      street: document.getElementById('custStreet').value.trim(),
    };
  }

  try {
    const res  = await fetch('/api/create-checkout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'Szerver hiba.');
    window.location.href = data.url;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Fizetés';
    showToast(err.message);
  }
}

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <div class="toast-icon">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#e53935" stroke-width="1.8"/>
        <path d="M12 7v5" stroke="#e53935" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="16.5" r="1" fill="#e53935"/>
      </svg>
    </div>
    <div class="toast-body">
      <div class="toast-title">Hiányzó adat</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <span class="toast-close" onclick="this.parentElement.remove()">✕</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    el.addEventListener('animationend', () => el.remove());
  }, 4000);
}

/* ── PAYMENT RESULT PAGE ── */
async function handlePaymentResult() {
  const params     = new URLSearchParams(window.location.search);
  const page       = params.get('page');
  const status     = params.get('status');
  const session_id = params.get('session_id');
  if (page !== 'result') return;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('result-page').classList.add('active');
  window.history.replaceState({}, '', '/');

  const card = document.getElementById('resultCard');
  card.innerHTML = '<div class="pay-spinner" style="margin:40px 0;"></div>';

  if (status === 'cancel') { renderResultCard(card, 'cancel', null); return; }

  try {
    const res  = await fetch(`/api/checkout-result?session_id=${session_id}`);
    const data = await res.json();
    renderResultCard(card, data.status === 'paid' ? 'success' : 'failed', data);
  } catch {
    renderResultCard(card, 'error', null);
  }
}

function renderResultCard(card, status, data) {
  const fmtAmount = n => n ? Math.round(n / 100).toLocaleString('hu-HU') + ' Ft' : '–';

  const cfg = {
    success: {
      iconBg: 'success',
      icon:  '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#43a047" stroke-width="2"/><path d="M7 12l3.5 3.5L17 8" stroke="#43a047" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      title: 'Sikeres fizetés!',
      sub:   'Köszönjük a rendelésedet! A visszaigazolást hamarosan elküldjük.',
      onShow: () => { cartItems = []; renderCart(); },
    },
    failed: {
      iconBg: 'failed',
      icon:  '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#e53935" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="#e53935" stroke-width="2.2" stroke-linecap="round"/></svg>',
      title: 'Sikertelen fizetés',
      sub:   'A kártya terhelése nem sikerült. Próbáld újra.',
    },
    cancel: {
      iconBg: 'failed',
      icon:  '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#e53935" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="#e53935" stroke-width="2.2" stroke-linecap="round"/></svg>',
      title: 'Fizetés megszakítva',
      sub:   'Visszatértél a fizetés nélkül. A kosarad megmaradt.',
    },
    error: {
      iconBg: 'pending',
      icon:  '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#f9a825" stroke-width="2"/><path d="M12 7v5l3 3" stroke="#f9a825" stroke-width="2.2" stroke-linecap="round"/></svg>',
      title: 'Ismeretlen állapot',
      sub:   'Nem sikerült lekérni a fizetés eredményét.',
    },
  }[status] || {};

  let detailHtml = '';
  if (status === 'success' && data) {
    const isPickup = data.shipping_method === 'pickup';
    const hasAddr  = data.ship_zip || data.ship_city || data.ship_street;
    const shipLine = isPickup
      ? (data.pickup_name ? `${data.pickup_name}${data.pickup_address ? '<br><span style="font-size:12px;color:#999;">' + data.pickup_address + '</span>' : ''}` : 'GLS Csomagpont')
      : (hasAddr ? `${data.ship_zip} ${data.ship_city}, ${data.ship_street}` : 'GLS Házhozszállítás');
    detailHtml = `
      <div class="result-detail">
        ${data.customer_name  ? `<div class="result-row"><span>Név</span><span>${data.customer_name}</span></div>` : ''}
        ${data.customer_email ? `<div class="result-row"><span>E-mail</span><span>${data.customer_email}</span></div>` : ''}
        ${data.customer_phone ? `<div class="result-row"><span>Telefon</span><span>${data.customer_phone}</span></div>` : ''}
        <div class="result-row" style="align-items:flex-start;">
          <span>${isPickup ? 'Csomagpont' : 'Szállítási cím'}</span>
          <span style="text-align:right;max-width:200px;line-height:1.4;">${shipLine}</span>
        </div>
        <div class="result-row total"><span>Fizetett összeg</span><span>${fmtAmount(data.amount_total)}</span></div>
      </div>`;
  }

  card.innerHTML = `
    <div class="result-icon ${cfg.iconBg}">${cfg.icon}</div>
    <h2 class="result-title">${cfg.title}</h2>
    <p class="result-sub">${cfg.sub}</p>
    ${detailHtml}
    <button class="btn-back-home" onclick="showPage('landing')">
      <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
        <path d="M1 6h16M1 6l5-5M1 6l5 5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Vissza a főoldalra
    </button>`;

  if (cfg.onShow) cfg.onShow();
}

window.addEventListener('DOMContentLoaded', handlePaymentResult);

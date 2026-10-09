/**
 * Shopping bag. Lines live in localStorage; product details come from /bag.json
 * (generated at build time) so prices and availability are always current.
 * Checkout posts to /api/checkout, which re-prices everything server side.
 */

type Line = { slug: string; variant?: string; qty: number };

type CatalogItem = {
  title: string;
  url: string;
  price: number;
  variants: { id: string; label: string; price: number }[];
  image?: string;
  ground?: string;
  beads?: string[];
  oneOfAKind: boolean;
  stock: number;
  available: boolean;
  sample: boolean;
};

type Catalog = { products: Record<string, CatalogItem>; freeThreshold: number };

const KEY = 'sc-bag-v1';
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = (n: number) => money.format(n).replace(/\.00$/, '');

let lines: Line[] = read();
let catalog: Catalog | null = null;
let catalogRequest: Promise<Catalog> | null = null;

const dialog = document.querySelector<HTMLDialogElement>('[data-bag]');
const body = dialog?.querySelector<HTMLElement>('[data-bag-body]');
const foot = dialog?.querySelector<HTMLElement>('[data-bag-foot]');
const errorEl = dialog?.querySelector<HTMLElement>('[data-bag-error]');
const checkoutBtn = dialog?.querySelector<HTMLButtonElement>('[data-bag-checkout]');

function read(): Line[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((l) => l && typeof l.slug === 'string' && Number.isInteger(l.qty) && l.qty > 0)
      : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* private mode: the bag still works for this page view */
  }
  sync();
}

function loadCatalog() {
  catalogRequest ??= fetch('/bag.json')
    .then((r) => {
      if (!r.ok) throw new Error(`bag.json ${r.status}`);
      return r.json() as Promise<Catalog>;
    })
    .then((c) => (catalog = c))
    .catch((err) => {
      catalogRequest = null;
      throw err;
    });
  return catalogRequest;
}

const keyOf = (l: Pick<Line, 'slug' | 'variant'>) => `${l.slug}::${l.variant ?? ''}`;
const maxQty = (item: CatalogItem) => (item.oneOfAKind ? 1 : Math.max(1, Math.min(item.stock, 10)));
const priceOf = (item: CatalogItem, variant?: string) =>
  item.variants.find((v) => v.id === variant)?.price ?? item.price;
const count = () => lines.reduce((n, l) => n + l.qty, 0);

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A tiny strand of the necklace's stones, for pieces without photos yet. */
function beadThumb(p: CatalogItem) {
  const ground = escapeHtml(p.ground ?? '#eae3d8');
  if (!p.beads?.length) return `<span style="display:block;width:100%;height:100%;background:${ground}"></span>`;
  const colors = p.beads.map(escapeHtml);
  const dots = Array.from({ length: 16 }, (_, i) => {
    const t = (i / 16) * Math.PI * 2 - Math.PI / 2 + 0.2;
    const x = 40 + 22 * Math.cos(t);
    const y = 52 + 30 * Math.sin(t);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.6" fill="${colors[i % colors.length]}" stroke="rgb(0 0 0 / .12)" stroke-width=".6"/>`;
  }).join('');
  return `<svg viewBox="0 0 80 100" width="160" height="200" aria-hidden="true"><rect width="80" height="100" fill="${ground}"/>${dots}</svg>`;
}

export async function add(slug: string, variant: string | undefined, qty = 1) {
  const c = await loadCatalog().catch(() => null);
  const item = c?.products[slug];
  const existing = lines.find((l) => keyOf(l) === keyOf({ slug, variant }));
  const limit = item ? maxQty(item) : 10;
  if (existing) existing.qty = Math.min(existing.qty + qty, limit);
  else lines.push({ slug, variant, qty: Math.min(qty, limit) });
  save();
  bump();
}

function setQty(key: string, qty: number) {
  lines = lines.flatMap((l) => (keyOf(l) === key ? (qty > 0 ? [{ ...l, qty }] : []) : [l]));
  save();
}

function bump() {
  document.querySelectorAll('[data-bag-count]').forEach((el) => {
    el.classList.remove('is-bumped');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('is-bumped');
    setTimeout(() => el.classList.remove('is-bumped'), 600);
  });
}

function sync() {
  const n = count();
  document.querySelectorAll('[data-bag-count]').forEach((el) => (el.textContent = String(n)));
  const label = dialog?.querySelector('[data-bag-count-label]');
  if (label) label.textContent = n ? `(${n})` : '';
  if (dialog?.open) render();
}

function render() {
  if (!body || !foot) return;
  if (!catalog) {
    body.innerHTML = '<p class="bag-loading">Loading…</p>';
    return;
  }
  const products = catalog.products;
  const known = lines.filter((l) => products[l.slug]);
  if (known.length !== lines.length) {
    lines = known;
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {}
  }

  if (!lines.length) {
    body.innerHTML = `
      <div class="bag-empty">
        <h3>Your bag is empty</h3>
        <p>Every necklace is one of one. When it is gone, it is gone.</p>
        <div class="bag-empty-links">
          <a class="btn" href="/shop/necklaces">Shop necklaces</a>
          <a class="btn btn--ghost" href="/shop/art">Shop art</a>
        </div>
      </div>`;
    foot.hidden = true;
    updateShipping(0);
    return;
  }

  let subtotal = 0;
  let blocked = false;
  body.innerHTML = lines
    .map((l) => {
      const p = products[l.slug];
      const unit = priceOf(p, l.variant);
      const variant = p.variants.find((v) => v.id === l.variant);
      const max = maxQty(p);
      subtotal += unit * l.qty;
      if (!p.available) blocked = true;
      const key = escapeHtml(keyOf(l));
      const thumb = p.image
        ? `<img src="${p.image}" alt="" width="160" height="200" loading="lazy" />`
        : beadThumb(p);
      const flag = !p.available
        ? '<span class="bag-flag">No longer available. Please remove to check out.</span>'
        : p.sample
          ? '<span class="bag-flag">Sample listing, not for sale yet</span>'
          : p.oneOfAKind
            ? '<span class="bag-flag">One of one</span>'
            : '';
      return `
        <div class="bag-line">
          <a class="bag-thumb" href="${p.url}">${thumb}</a>
          <div>
            <a class="bag-line-title" href="${p.url}">${escapeHtml(p.title)}</a>
            ${variant ? `<p class="bag-line-meta">${escapeHtml(variant.label)}</p>` : ''}
            ${flag}
            <div class="bag-line-actions">
              <div class="qty" role="group" aria-label="Quantity">
                <button type="button" data-qty="${key}" data-delta="-1" aria-label="Decrease quantity">−</button>
                <output aria-live="polite">${l.qty}</output>
                <button type="button" data-qty="${key}" data-delta="1" aria-label="Increase quantity" ${l.qty >= max ? 'disabled' : ''}>+</button>
              </div>
              <button type="button" class="bag-remove" data-remove="${key}">Remove</button>
            </div>
          </div>
          <span class="bag-line-price">${fmt(unit * l.qty)}</span>
        </div>`;
    })
    .join('');

  foot.hidden = false;
  const sub = foot.querySelector('[data-bag-subtotal]');
  if (sub) sub.textContent = fmt(subtotal);
  if (checkoutBtn) checkoutBtn.disabled = blocked;
  updateShipping(subtotal);
}

function updateShipping(subtotal: number) {
  const label = dialog?.querySelector('[data-bag-ship-label]');
  const bar = dialog?.querySelector<HTMLElement>('[data-bag-ship-bar]');
  const threshold = catalog?.freeThreshold ?? 0;
  if (!label || !bar || !threshold) return;
  const remaining = threshold - subtotal;
  bar.style.width = `${Math.min(100, (subtotal / threshold) * 100)}%`;
  label.textContent =
    subtotal === 0
      ? `Complimentary US shipping on orders over ${fmt(threshold)}`
      : remaining > 0
        ? `You are ${fmt(remaining)} away from complimentary shipping`
        : 'Your order ships complimentary';
}

export function open() {
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  render();
  loadCatalog()
    .then(render)
    .catch(() => {
      if (body) body.innerHTML = '<p class="bag-loading">The bag could not load. Please refresh the page.</p>';
    });
}

export async function checkout(items: Line[], trigger?: HTMLButtonElement | null) {
  const btn = trigger ?? checkoutBtn;
  const original = btn?.innerHTML;
  const errorTarget = trigger?.closest('form')?.querySelector<HTMLElement>('[data-buy-error]') ?? errorEl;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening secure checkout…';
  }
  if (errorTarget) errorTarget.hidden = true;
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Checkout is unavailable right now.');
    window.location.href = data.url;
  } catch (err) {
    if (errorTarget) {
      errorTarget.textContent = err instanceof Error ? err.message : 'Checkout is unavailable right now.';
      errorTarget.hidden = false;
    }
    if (btn && original) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

// Wiring ------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-bag-open]')) {
    e.preventDefault();
    open();
    return;
  }
  if (t.closest('[data-bag-close]') || t === dialog) {
    dialog?.close();
    return;
  }
  const qtyBtn = t.closest<HTMLButtonElement>('[data-qty]');
  if (qtyBtn) {
    const line = lines.find((l) => keyOf(l) === qtyBtn.dataset.qty);
    if (line) setQty(keyOf(line), line.qty + Number(qtyBtn.dataset.delta));
    return;
  }
  const removeBtn = t.closest<HTMLButtonElement>('[data-remove]');
  if (removeBtn?.dataset.remove) setQty(removeBtn.dataset.remove, 0);
});

checkoutBtn?.addEventListener('click', () => checkout(lines));

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.matches('[data-add-to-cart]')) return;
  e.preventDefault();
  const data = new FormData(form);
  const slug = String(data.get('slug'));
  const variant = data.get('variant') ? String(data.get('variant')) : undefined;
  const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value === 'buy') {
    checkout([{ slug, variant, qty: 1 }], submitter);
    return;
  }
  add(slug, variant).then(open);
});

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    lines = read();
    sync();
  }
});

if (document.querySelector('[data-bag-clear]')) {
  lines = [];
  save();
}

sync();

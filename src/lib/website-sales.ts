/**
 * Website orders as studio sales. Stripe is the record: every paid Checkout
 * session from this site becomes one sale, with its pieces (by product slug,
 * so piece costs apply), shipping, sales tax, refunds and Stripe's exact fee.
 *
 * Looking up the exact fee and refunds costs two Stripe calls per order, so the
 * result is kept in the studio store (stripe/<session id>) and refreshed once a
 * day until the order is 60 days old, when a refund is no longer likely.
 *
 * The exact fee needs read access to Payment Intents, Charges and Balance
 * transactions. With a restricted key that lacks them, the fee falls back to
 * Stripe's standard 2.9% + 30 cents and the dashboard says it is an estimate.
 * Shipping label costs come from the orders page (shipments in the inventory store).
 */
import type { Store } from '@netlify/blobs';
import type Stripe from 'stripe';
import { cents, chicagoDate, stripeFee, type Sale } from './finance.ts';
import { SOURCE } from './order-mail.ts';
import type { KV } from './studio-store.ts';

type Cached = { sale: Sale; fetched: string; exact: boolean };

const DAY = 24 * 60 * 60 * 1000;
const SETTLED = 60 * DAY;

export type WebsiteSales = {
  sales: Sale[];
  /** Paid orders not yet marked shipped. */
  toShip: number;
  /** Shipped orders with no label cost recorded. */
  unlabeled: number;
  error?: string;
};

/** Runs `fn` over `items`, at most `limit` at a time, so a first load does not hit Stripe's rate limit. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function websiteSales(stripe: Stripe | null, kv: KV, inventory: Store | null): Promise<WebsiteSales> {
  if (!stripe) return { sales: [], toShip: 0, unlabeled: 0 };
  const sessions: Stripe.Checkout.Session[] = [];
  try {
    for await (const s of stripe.checkout.sessions.list({ status: 'complete', limit: 100 })) {
      if (s.metadata?.source === SOURCE && s.payment_status !== 'unpaid') sessions.push(s);
      if (sessions.length >= 2000) break;
    }
  } catch (err) {
    console.error('Studio: could not list Stripe sessions', err);
    return { sales: [], toShip: 0, unlabeled: 0, error: 'Website orders could not be loaded from Stripe. Refresh in a minute.' };
  }

  const now = Date.now();
  let toShip = 0;
  let unlabeled = 0;
  const sales = await pool(sessions, 8, async (session) => {
    const key = `stripe/${session.id}`;
    const created = session.created * 1000;
    const [cached, shipment] = await Promise.all([
      kv.getJSON<Cached>(key),
      inventory ? (inventory.get(`shipments/${session.id}`, { type: 'json' }) as Promise<{ labelCost?: number } | null>) : null,
    ]);
    if (!shipment) toShip++;
    else if (!shipment.labelCost) unlabeled++;

    let sale: Sale | null = null;
    if (cached) {
      const fetched = Date.parse(cached.fetched);
      // A final look is taken once the order is past 60 days. After that, estimated fees retry weekly in case the key gains access.
      const settled = fetched - created > SETTLED;
      if (now - fetched < DAY || (settled && (cached.exact || now - fetched < 7 * DAY))) sale = cached.sale;
    }
    if (!sale) {
      try {
        const built = await buildSale(stripe, session);
        await kv.setJSON(key, { sale: built.sale, fetched: new Date().toISOString(), exact: built.exact } satisfies Cached);
        sale = built.sale;
      } catch (err) {
        console.error(`Studio: could not read order ${session.id}`, err);
        sale = cached?.sale ?? basicSale(session);
      }
    }
    return { ...sale, labelCost: shipment?.labelCost ?? 0 };
  });
  return { sales, toShip, unlabeled };
}

/** A sale from the session alone: no line items, standard fee. Used only when Stripe cannot be read. */
function basicSale(session: Stripe.Checkout.Session): Sale {
  const total = (session.amount_total ?? 0) / 100;
  const shipping = (session.total_details?.amount_shipping ?? 0) / 100;
  const tax = (session.total_details?.amount_tax ?? 0) / 100;
  return {
    id: session.id,
    date: chicagoDate(session.created * 1000),
    channel: 'website',
    items: [{ title: 'Website order', qty: 1, amount: cents(Math.max(0, total - shipping - tax)) }],
    shipping,
    tax,
    fees: stripeFee(total),
    feeEstimated: true,
    labelCost: 0,
    ref: session.id,
  };
}

async function buildSale(stripe: Stripe, session: Stripe.Checkout.Session): Promise<{ sale: Sale; exact: boolean }> {
  const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ['data.price.product'] });
  const items = lines.data.map((line) => {
    const product = line.price?.product;
    const meta = product && typeof product === 'object' && !('deleted' in product && product.deleted) ? product.metadata : undefined;
    return {
      title: line.description ?? 'Item',
      slug: meta?.slug || undefined,
      qty: line.quantity ?? 1,
      amount: (line.amount_subtotal - (line.amount_discount ?? 0)) / 100,
    };
  });

  const total = (session.amount_total ?? 0) / 100;
  const tax = (session.total_details?.amount_tax ?? 0) / 100;
  let fees = stripeFee(total);
  let refundedAll = 0;
  let exact = false;
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (intentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge.balance_transaction'] });
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      const balance = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
      if (balance) {
        fees = balance.fee / 100;
        exact = true;
      }
      refundedAll = (charge?.amount_refunded ?? 0) / 100;
    } catch (err) {
      // Usually a restricted key without Payment Intents or Charges read access.
      console.warn(`Studio: exact fee unavailable for ${session.id}`, err instanceof Error ? err.message : err);
    }
  }

  // A refund gives back tax along with the rest. Split it the way the charge was split,
  // so the tax share lowers tax owed rather than counting against profit.
  const taxShare = total > 0 ? tax / total : 0;
  return {
    exact,
    sale: {
      id: session.id,
      date: chicagoDate(session.created * 1000),
      channel: 'website',
      items,
      shipping: (session.shipping_cost?.amount_subtotal ?? session.total_details?.amount_shipping ?? 0) / 100,
      tax: cents(tax - refundedAll * taxShare),
      fees,
      feeEstimated: !exact,
      refunded: cents(refundedAll * (1 - taxShare)),
      labelCost: 0,
      ref: session.id,
    },
  };
}

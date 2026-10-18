/**
 * Orders after payment: reading them from Stripe, sending the order emails,
 * and recording shipments.
 *
 * Stripe is the record of what was bought and where it ships. Netlify Blobs
 * (the `inventory` store, next to the stock records) keeps what Stripe does not:
 *
 *   shipments/<checkout session id>        carrier, tracking number, when it shipped
 *   emails/<checkout session id>/<kind>    when each order email went out, so none is sent twice
 *
 * Email goes through Resend (https://resend.com). Without RESEND_API_KEY nothing
 * is sent and orders still work; the orders page shows which emails are missing.
 */
import type { Store } from '@netlify/blobs';
import { ORDER_EMAIL_FROM, ORDER_NOTIFY_EMAIL, RESEND_API_KEY } from 'astro:env/server';
import Stripe from 'stripe';
import { site } from '../data/site';
import {
  confirmationEmail,
  orderNumber,
  saleEmail,
  shippedEmail,
  type Email,
  type Order,
  type OrderItem,
  type Shipment,
} from './order-mail';

export type EmailKind = 'confirmation' | 'sale' | 'shipped';
export type SentLog = Partial<Record<EmailKind, string>>;

export const SOURCE = 'simonechagoya.com';

/* ---------------------------------------------------------------
   Reading orders from Stripe
---------------------------------------------------------------- */

export async function getOrder(stripe: Stripe, sessionId: string): Promise<Order> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return toOrder(session, await lineItems(stripe, sessionId));
}

/** Completed checkouts from this site, newest first. */
export async function listOrders(stripe: Stripe, limit = 30): Promise<Order[]> {
  const page = await stripe.checkout.sessions.list({ status: 'complete', limit });
  const sessions = page.data.filter((s) => s.metadata?.source === SOURCE);
  return Promise.all(sessions.map(async (s) => toOrder(s, await lineItems(stripe, s.id))));
}

async function lineItems(stripe: Stripe, sessionId: string): Promise<OrderItem[]> {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ['data.price.product'] });
  return items.data.map((item) => {
    const product = item.price?.product;
    const image = product && typeof product === 'object' && !('deleted' in product && product.deleted) ? product.images?.[0] : undefined;
    return { name: item.description ?? 'Item', qty: item.quantity ?? 1, amount: item.amount_subtotal, image };
  });
}

function toOrder(session: Stripe.Checkout.Session, items: OrderItem[]): Order {
  const ship = session.collected_information?.shipping_details;
  const address = ship?.address;
  const cityLine = [address?.city, [address?.state, address?.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const shipTo = [ship?.name, address?.line1, address?.line2, cityLine, address?.country && address.country !== 'US' ? address.country : null]
    .filter((v): v is string => Boolean(v));
  const shipping = session.shipping_cost?.amount_subtotal ?? session.total_details?.amount_shipping ?? 0;
  const rate = session.shipping_cost?.shipping_rate;
  // Rates are created inline at checkout, so the amount tells them apart when the rate is not expanded.
  const express = typeof rate === 'object' && rate ? /express/i.test(rate.display_name ?? '') : shipping === site.shipping.expressRate * 100;
  const giftNote = session.custom_fields?.find((f) => f.key === 'gift_note')?.text?.value?.trim() || null;

  return {
    id: session.id,
    number: orderNumber(session.id),
    created: new Date(session.created * 1000).toISOString(),
    email: session.customer_details?.email ?? null,
    name: ship?.name ?? session.customer_details?.name ?? null,
    phone: session.customer_details?.phone ?? null,
    shipTo,
    items,
    subtotal: session.amount_subtotal ?? 0,
    shipping,
    shippingMethod: express ? 'Express shipping' : 'Standard shipping',
    express,
    discount: session.total_details?.amount_discount ?? 0,
    tax: session.total_details?.amount_tax ?? 0,
    total: session.amount_total ?? 0,
    giftNote,
    paid: session.payment_status !== 'unpaid',
  };
}

/* ---------------------------------------------------------------
   Shipments and the email log
---------------------------------------------------------------- */

export const getShipment = async (store: Store, id: string) =>
  (await store.get(`shipments/${id}`, { type: 'json' })) as Shipment | null;

export const saveShipment = (store: Store, id: string, shipment: Shipment) => store.setJSON(`shipments/${id}`, shipment);

export const clearShipment = (store: Store, id: string) => store.delete(`shipments/${id}`);

export async function sentLog(store: Store, id: string): Promise<SentLog> {
  const { blobs } = await store.list({ prefix: `emails/${id}/` });
  const entries = await Promise.all(
    blobs.map(async (b) => [b.key.split('/').pop() as EmailKind, (await store.get(b.key)) ?? ''] as const),
  );
  return Object.fromEntries(entries);
}

/* ---------------------------------------------------------------
   Sending
---------------------------------------------------------------- */

export const emailReady = () => Boolean(RESEND_API_KEY);

/** Where sale alerts go: ORDER_NOTIFY_EMAIL (comma separated), else the shop address. */
const notifyList = () =>
  (ORDER_NOTIFY_EMAIL || site.email)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Sends the buyer's confirmation and Simone's sale alert for a paid order,
 * skipping any that already went out. Returns what failed, if anything; it
 * never throws, so a mail outage cannot stop the webhook from recording a sale.
 */
export async function sendOrderEmails(stripe: Stripe, store: Store, sessionId: string): Promise<string[]> {
  if (!emailReady()) {
    console.warn(`Order emails skipped for ${sessionId}: RESEND_API_KEY is not set`);
    return ['email is not set up'];
  }
  const failed: string[] = [];
  try {
    const order = await getOrder(stripe, sessionId);
    if (!order.paid) return [];
    const sent = await sentLog(store, sessionId);
    if (!sent.confirmation && order.email) {
      await deliver(store, sessionId, 'confirmation', order.email, confirmationEmail(order)).catch((err) => {
        console.error(`Confirmation email for ${sessionId} failed`, err);
        failed.push('confirmation');
      });
    }
    if (!sent.sale) {
      await deliver(store, sessionId, 'sale', notifyList(), saleEmail(order, `${site.url}/studio`), order.email ?? undefined).catch((err) => {
        console.error(`Sale alert for ${sessionId} failed`, err);
        failed.push('sale alert');
      });
    }
  } catch (err) {
    console.error(`Order emails for ${sessionId} failed`, err);
    failed.push('order lookup');
  }
  return failed;
}

export async function sendConfirmation(stripe: Stripe, store: Store, sessionId: string) {
  const order = await getOrder(stripe, sessionId);
  if (!order.email) throw new Error('This order has no email address.');
  await deliver(store, sessionId, 'confirmation', order.email, confirmationEmail(order), undefined, true);
}

export async function sendShipped(stripe: Stripe, store: Store, sessionId: string, shipment: Shipment) {
  const order = await getOrder(stripe, sessionId);
  if (!order.email) throw new Error('This order has no email address.');
  await deliver(store, sessionId, 'shipped', order.email, shippedEmail(order, shipment), undefined, true);
}

/**
 * Sends one email and logs it. Resend's idempotency key stops a retried
 * webhook from sending the same automatic email twice; `again` is for a
 * deliberate resend from the orders page.
 */
async function deliver(store: Store, id: string, kind: EmailKind, to: string | string[], email: Email, replyTo = site.email, again = false) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': again ? `${id}/${kind}/${Date.now()}` : `${id}/${kind}`,
    },
    body: JSON.stringify({
      from: ORDER_EMAIL_FROM || `${site.studio} <orders@${new URL(site.url).hostname}>`,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  if (!res.ok) {
    // Resend explains the problem in `message` (an unverified domain, a bad key), which the orders page shows.
    const body = await res.text().catch(() => '');
    let reason = body;
    try {
      reason = JSON.parse(body).message ?? body;
    } catch {}
    throw new Error(`Resend said: ${reason || res.status}`);
  }
  await store.set(`emails/${id}/${kind}`, new Date().toISOString());
}

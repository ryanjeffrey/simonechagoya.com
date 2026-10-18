import type { APIRoute } from 'astro';
import { NETLIFY_BUILD_HOOK_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from 'astro:env/server';
import Stripe from 'stripe';
import { deleteOrder, inventoryStore, recordOrder, releasePieces, type OrderLine } from '../../lib/inventory';
import { sendOrderEmails } from '../../lib/orders';

export const prerender = false;

/**
 * Stripe webhook. Subscribe the endpoint to:
 *   checkout.session.completed, checkout.session.async_payment_succeeded,
 *   checkout.session.async_payment_failed, checkout.session.expired
 *
 * A completed checkout records its items, which marks single pieces sold, and
 * rebuilds the site so they show Sold. Once the payment has gone through, it
 * emails the buyer their confirmation and Simone a sale alert. Any error in
 * recording returns 500 so Stripe retries the event; a failed email does not,
 * and can be sent again from the orders page (/studio).
 */
export const POST: APIRoute = async ({ request }) => {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return new Response('Webhook not configured', { status: 503 });

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  let event: Stripe.Event;
  try {
    // Verify against the raw body, before anything else reads it.
    const payload = await request.text();
    event = await stripe.webhooks.constructEventAsync(payload, request.headers.get('stripe-signature') ?? '', STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  if (!event.type.startsWith('checkout.session.')) return new Response('Ignored', { status: 200 });
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.source !== 'simonechagoya.com') return new Response('Ignored', { status: 200 });

  const store = inventoryStore();
  if (!store) {
    console.error('Stripe webhook: no inventory store outside Netlify');
    return new Response('Inventory store unavailable', { status: 500 });
  }
  const hold = session.metadata.hold;
  const held = session.metadata.held ? session.metadata.held.split(',') : [];

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        // Delayed payment methods complete unpaid. The order is still recorded so the
        // piece stays reserved until the payment settles or fails.
        await recordOrder(store, session.id, await orderLines(stripe, session.id), session.payment_status !== 'unpaid');
        await releasePieces(store, held, hold);
        await rebuild();
        if (session.payment_status !== 'unpaid') await sendOrderEmails(stripe, store, session.id);
        break;
      }
      case 'checkout.session.async_payment_failed': {
        await deleteOrder(store, session.id);
        await rebuild();
        break;
      }
      case 'checkout.session.expired': {
        await releasePieces(store, held, hold);
        break;
      }
    }
  } catch (err) {
    console.error(`Stripe webhook: ${event.type} for ${session.id} failed`, err);
    return new Response('Handler failed', { status: 500 });
  }
  return new Response('ok', { status: 200 });
};

/** The slugs and quantities a session bought, from the product metadata set at checkout. */
async function orderLines(stripe: Stripe, sessionId: string): Promise<OrderLine[]> {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ['data.price.product'] });
  return items.data.flatMap((item) => {
    const product = item.price?.product;
    const meta = product && typeof product === 'object' && !('deleted' in product && product.deleted) ? product.metadata : undefined;
    return meta?.slug ? [{ slug: meta.slug, variant: meta.variant || undefined, qty: item.quantity ?? 1 }] : [];
  });
}

/** Rebuilds the static site so sold pieces show Sold. Skipped when no build hook is set. */
async function rebuild() {
  if (!NETLIFY_BUILD_HOOK_URL) return;
  const res = await fetch(NETLIFY_BUILD_HOOK_URL, { method: 'POST' }).catch((err) => err as Error);
  if (res instanceof Error || !res.ok) console.error('Netlify build hook failed', res instanceof Error ? res : res.status);
}

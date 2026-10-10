import type { APIRoute } from 'astro';
import { STRIPE_SECRET_KEY, STRIPE_AUTOMATIC_TAX } from 'astro:env/server';
import Stripe from 'stripe';
import { getProducts, isPurchasable, variantPrice } from '../../lib/catalog';
import { HOLD_SECONDS, holdPieces, inventoryStore, isSinglePiece, releasePieces } from '../../lib/inventory';
import { site } from '../../data/site';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type RequestLine = { slug?: unknown; variant?: unknown; qty?: unknown };

export const POST: APIRoute = async ({ request, url }) => {
  if (!STRIPE_SECRET_KEY) {
    return json({ error: 'Checkout is not switched on yet. Email hello@simonechagoya.com to buy this piece.' }, 503);
  }

  let lines: RequestLine[];
  let previous: { session?: unknown; hold?: unknown } | undefined;
  try {
    const body = await request.json();
    lines = Array.isArray(body?.items) ? body.items : [];
    previous = body?.previous && typeof body.previous === 'object' ? body.previous : undefined;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!lines.length || lines.length > 25) return json({ error: 'Your bag is empty.' }, 400);

  // Never trust prices from the browser: everything is re-priced from the catalog,
  // read fresh so a piece sold since the last build is refused.
  const catalog = new Map((await getProducts(undefined, { fresh: true })).map((p) => [p.id, p]));
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const singles: { slug: string; title: string }[] = [];
  let subtotal = 0;

  for (const line of lines) {
    const product = typeof line.slug === 'string' ? catalog.get(line.slug) : undefined;
    if (!product) return json({ error: 'One of the items in your bag no longer exists.' }, 400);
    const { data } = product;

    if (data.sample) return json({ error: `${data.title} is a sample listing and is not for sale yet.` }, 400);
    if (data.status === 'inquire') {
      return json({ error: `${data.title} is sold by inquiry. Use the Inquire button on its page.` }, 400);
    }
    if (!isPurchasable(product)) return json({ error: `${data.title} is no longer available.` }, 409);

    const variant = data.variants.find((v) => v.id === line.variant);
    if (data.variants.length && !variant) return json({ error: `Please choose an option for ${data.title}.` }, 400);

    const qty = Number(line.qty);
    const max = data.oneOfAKind ? 1 : Math.min(variant?.stock ?? data.stock, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > max) {
      return json({ error: `Only ${max} of ${data.title} available.` }, 409);
    }

    if (isSinglePiece(product)) singles.push({ slug: product.id, title: data.title });
    const unit = variantPrice(product, variant?.id);
    subtotal += unit * qty;
    const image = data.images[0] ? new URL(data.images[0].src, url.origin).href : undefined;

    lineItems.push({
      quantity: qty,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(unit * 100),
        product_data: {
          name: variant ? `${data.title} (${variant.label})` : data.title,
          images: image ? [image] : undefined,
          metadata: { slug: product.id, variant: variant?.id ?? '' },
        },
      },
    });
  }

  const { freeThreshold, standardRate, expressRate } = site.shipping;
  const freeShipping = freeThreshold > 0 && subtotal >= freeThreshold;
  const shippingOptions: Stripe.Checkout.SessionCreateParams.ShippingOption[] = [
    {
      shipping_rate_data: {
        display_name: freeShipping ? 'Free standard shipping' : 'Standard shipping',
        type: 'fixed_amount',
        fixed_amount: { amount: freeShipping ? 0 : standardRate * 100, currency: 'usd' },
        delivery_estimate: { minimum: { unit: 'business_day', value: 4 }, maximum: { unit: 'business_day', value: 8 } },
      },
    },
    {
      shipping_rate_data: {
        display_name: 'Express shipping',
        type: 'fixed_amount',
        fixed_amount: { amount: expressRate * 100, currency: 'usd' },
        delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 4 } },
      },
    },
  ];

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  // Hold single pieces for as long as the Checkout session stays open, so two
  // buyers cannot pay for the same necklace. The webhook releases or settles the hold.
  const store = inventoryStore();
  const hold = crypto.randomUUID();
  const held = singles.map((p) => p.slug);
  if (store && held.length) {
    // A buyer who left Checkout and came back must not be blocked by their own hold.
    await closePrevious(stripe, store, previous);
    // If the store is down, sell anyway: a rare double sale beats a dead checkout.
    const taken = await holdPieces(store, held, hold).catch((err) => {
      console.error('Could not hold pieces', err);
      return [];
    });
    if (taken.length) {
      const title = singles.find((p) => p.slug === taken[0])?.title;
      return json({ error: `Someone is checking out with ${title} right now. If they do not finish, it comes back within half an hour.` }, 409);
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: [...site.shipping.countries] },
      shipping_options: shippingOptions,
      allow_promotion_codes: true,
      automatic_tax: { enabled: STRIPE_AUTOMATIC_TAX },
      consent_collection: { promotions: 'auto' },
      custom_fields: [
        {
          key: 'gift_note',
          label: { type: 'custom', custom: 'Gift note (optional)' },
          type: 'text',
          optional: true,
          text: { maximum_length: 240 },
        },
      ],
      metadata: { source: 'simonechagoya.com', hold, held: held.join(',') },
      expires_at: Math.floor(Date.now() / 1000) + HOLD_SECONDS - 60,
      success_url: `${url.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${url.origin}/shop?checkout=cancelled`,
    });
    return json({ url: session.url, checkout: { session: session.id, hold } });
  } catch (err) {
    console.error('Stripe checkout error', err);
    if (store) await releasePieces(store, held, hold).catch(() => {});
    return json({ error: 'Checkout could not start. Please try again in a moment.' }, 502);
  }
};

/**
 * Expires this browser's previous Checkout session and frees the pieces it held.
 * The session must carry the same hold token, so nobody can close another
 * buyer's checkout by guessing a session id.
 */
async function closePrevious(stripe: Stripe, store: NonNullable<ReturnType<typeof inventoryStore>>, previous?: { session?: unknown; hold?: unknown }) {
  const { session: id, hold } = previous ?? {};
  if (typeof id !== 'string' || !id.startsWith('cs_') || typeof hold !== 'string') return;
  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    if (session.metadata?.hold !== hold) return;
    if (session.status === 'open') await stripe.checkout.sessions.expire(id);
    if (session.status !== 'complete') await releasePieces(store, session.metadata.held?.split(',') ?? [], hold);
  } catch (err) {
    console.error('Could not close the previous checkout', err);
  }
}

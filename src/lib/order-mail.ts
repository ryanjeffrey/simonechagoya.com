/**
 * Order emails: the buyer's confirmation, Simone's sale alert, and the
 * shipping notice with tracking. Pure functions with no Stripe or network
 * access, so `npm test` can render them.
 *
 * Email clients ignore web fonts and most CSS, so these are tables with inline
 * styles, Georgia standing in for Cormorant, and a plain-text twin of each.
 */
import { site } from '../data/site.ts';

export type OrderItem = { name: string; qty: number; amount: number; image?: string };

/** One paid checkout, flattened from its Stripe session. Amounts are in cents. */
export type Order = {
  id: string;
  number: string;
  created: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  shipTo: string[];
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  shippingMethod: string;
  express: boolean;
  discount: number;
  tax: number;
  total: number;
  giftNote: string | null;
  paid: boolean;
};

export type Shipment = { carrier: Carrier; tracking: string; shippedAt: string };

export type Email = { subject: string; html: string; text: string };

export const CARRIERS = {
  usps: { label: 'USPS', url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' },
  ups: { label: 'UPS', url: 'https://www.ups.com/track?tracknum=' },
  fedex: { label: 'FedEx', url: 'https://www.fedex.com/fedextrack/?trknbr=' },
  dhl: { label: 'DHL', url: 'https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=' },
  other: { label: 'Other', url: '' },
} as const;

export type Carrier = keyof typeof CARRIERS;

export const isCarrier = (value: unknown): value is Carrier => typeof value === 'string' && value in CARRIERS;

export function trackingUrl({ carrier, tracking }: Pick<Shipment, 'carrier' | 'tracking'>): string | null {
  const base = CARRIERS[carrier]?.url;
  return base && tracking ? base + encodeURIComponent(tracking) : null;
}

/** A short, readable order number taken from the end of the Checkout session id. */
export const orderNumber = (sessionId: string) => `SC-${sessionId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`;

export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: site.currency }).format(cents / 100);

export const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? '';

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ---------------------------------------------------------------
   Messages
---------------------------------------------------------------- */

export function confirmationEmail(order: Order): Email {
  const hi = firstName(order.name);
  const intro = `Your order is in. Simone packs every piece by hand in her Chicago studio, usually within ${site.shipping.processing}. You will get another email with tracking as soon as it ships.`;
  return {
    subject: `Thank you for your order (${order.number})`,
    html: layout({
      preheader: `Order ${order.number} is confirmed. Tracking follows when it ships.`,
      body: [
        eyebrow(`Order ${order.number}`),
        heading(hi ? `Thank you, ${hi}.` : 'Thank you.'),
        paragraph(intro),
        itemsTable(order),
        totalsTable(order),
        shipToBlock(order),
        order.giftNote ? noteBlock('Gift note', order.giftNote) : '',
        paragraph(`Questions about your order? Reply to this email or write to ${link(`mailto:${site.email}`, site.email)}.`, true),
      ].join(''),
    }),
    text: [
      hi ? `Thank you, ${hi}.` : 'Thank you.',
      '',
      intro,
      '',
      `Order ${order.number}`,
      ...itemsText(order),
      '',
      ...totalsText(order),
      '',
      'Shipping to',
      ...order.shipTo,
      ...(order.giftNote ? ['', `Gift note: ${order.giftNote}`] : []),
      '',
      `Questions? Reply to this email or write to ${site.email}.`,
      signoff(),
    ].join('\n'),
  };
}

/** Simone's alert. `studioUrl` opens the orders page where she marks it shipped. */
export function saleEmail(order: Order, studioUrl: string): Email {
  const pieces = order.items.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)).join(', ');
  const who = order.name ?? order.email ?? 'A buyer';
  return {
    subject: `${order.express ? 'Express order' : 'New order'}: ${pieces} (${money(order.total)})`,
    html: layout({
      preheader: `${who} bought ${pieces}.`,
      body: [
        eyebrow(`New order ${order.number}`),
        heading(`${money(order.total)} from ${who}.`),
        order.express ? noteBlock('Express shipping', 'The buyer paid for express. Ship this one first.') : '',
        itemsTable(order),
        totalsTable(order),
        shipToBlock(order, true),
        order.giftNote ? noteBlock('Gift note to include', order.giftNote) : '',
        button(studioUrl, 'Open orders'),
        paragraph('When it is packed, mark it shipped on the orders page and add the tracking number. The buyer gets their tracking email from there.', true),
      ].join(''),
    }),
    text: [
      `New order ${order.number}: ${money(order.total)} from ${who}.`,
      ...(order.express ? ['', 'EXPRESS: the buyer paid for express shipping. Ship this one first.'] : []),
      '',
      ...itemsText(order),
      '',
      ...totalsText(order),
      '',
      'Ship to',
      ...order.shipTo,
      ...(order.email ? [order.email] : []),
      ...(order.phone ? [order.phone] : []),
      ...(order.giftNote ? ['', `Gift note to include: ${order.giftNote}`] : []),
      '',
      `Mark it shipped and add tracking: ${studioUrl}`,
    ].join('\n'),
  };
}

export function shippedEmail(order: Order, shipment: Shipment): Email {
  const hi = firstName(order.name);
  const url = trackingUrl(shipment);
  const carrier = CARRIERS[shipment.carrier].label;
  const line = shipment.tracking
    ? `It is with ${shipment.carrier === 'other' ? 'the carrier' : carrier} now. Tracking number: ${shipment.tracking}.`
    : 'It is on its way to you now.';
  return {
    subject: `Your order is on its way (${order.number})`,
    html: layout({
      preheader: shipment.tracking ? `Tracking: ${shipment.tracking}` : 'Your order has shipped.',
      body: [
        eyebrow(`Order ${order.number}`),
        heading(hi ? `It is on its way, ${hi}.` : 'It is on its way.'),
        paragraph(`Simone packed your order by hand and sent it from the studio. ${line}`),
        url ? button(url, 'Track your package') : '',
        itemsTable(order, false),
        shipToBlock(order),
        paragraph(
          `Wear it, keep it, and if anything is not right, reply to this email. Returns are accepted within ${site.returns.days} days.`,
          true,
        ),
      ].join(''),
    }),
    text: [
      hi ? `It is on its way, ${hi}.` : 'It is on its way.',
      '',
      `Simone packed your order by hand and sent it from the studio. ${line}`,
      ...(url ? [`Track it: ${url}`] : []),
      '',
      `Order ${order.number}`,
      ...order.items.map((i) => `${i.qty} x ${i.name}`),
      '',
      'Shipping to',
      ...order.shipTo,
      '',
      `If anything is not right, reply to this email. Returns are accepted within ${site.returns.days} days.`,
      signoff(),
    ].join('\n'),
  };
}

/* ---------------------------------------------------------------
   Building blocks
---------------------------------------------------------------- */

const C = {
  paper: '#f4efe7',
  card: '#fbf8f3',
  ink: '#211c17',
  ink2: '#5c5249',
  line: '#e3dacd',
  accent: '#8e4126',
  gold: '#7d5f31',
  serif: "Georgia, 'Times New Roman', serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
};

function layout({ preheader, body }: { preheader: string; body: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(site.studio)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td align="center" style="padding:8px 0 28px;font-family:${C.serif};font-size:26px;letter-spacing:0.02em;color:${C.ink};">
<a href="${site.url}" style="color:${C.ink};text-decoration:none;">${esc(site.name)}</a>
<div style="font-family:${C.sans};font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:${C.gold};padding-top:6px;">Studio &middot; ${esc(site.city)}</div>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};padding:36px 28px;font-family:${C.sans};font-size:15px;line-height:1.6;color:${C.ink};">
${body}
</td></tr>
<tr><td align="center" style="padding:24px 8px;font-family:${C.sans};font-size:12px;line-height:1.6;color:${C.ink2};">
${esc(site.studio)} &middot; ${esc(site.city)}<br>
<a href="${site.url}" style="color:${C.ink2};">${site.url.replace('https://', '')}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

const eyebrow = (text: string) =>
  `<p style="margin:0 0 12px;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:${C.gold};">${esc(text)}</p>`;

const heading = (text: string) =>
  `<h1 style="margin:0 0 16px;font-family:${C.serif};font-weight:400;font-size:32px;line-height:1.15;color:${C.ink};">${esc(text)}</h1>`;

/** `html` is trusted markup built here; plain text is escaped. */
const paragraph = (html: string, small = false) =>
  `<p style="margin:0 0 20px;${small ? `font-size:13px;color:${C.ink2};` : ''}">${html.includes('<a ') ? html : esc(html)}</p>`;

const link = (href: string, text: string) => `<a href="${esc(href)}" style="color:${C.accent};">${esc(text)}</a>`;

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;"><tr><td style="background:${C.ink};">
<a href="${esc(href)}" style="display:inline-block;padding:15px 28px;font-family:${C.sans};font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#ffffff;text-decoration:none;">${esc(label)}</a>
</td></tr></table>`;

function itemsTable(order: Order, withPrices = true) {
  const rows = order.items
    .map(
      (i) => `<tr>
<td width="64" style="padding:14px 14px 14px 0;border-top:1px solid ${C.line};vertical-align:top;">${
        i.image
          ? `<img src="${esc(i.image)}" width="56" height="70" alt="" style="display:block;width:56px;height:70px;object-fit:cover;background:${C.paper};">`
          : ''
      }</td>
<td style="padding:14px 0;border-top:1px solid ${C.line};vertical-align:top;font-family:${C.serif};font-size:18px;line-height:1.3;">${esc(i.name)}${
        i.qty > 1 ? `<div style="font-family:${C.sans};font-size:13px;color:${C.ink2};">Qty ${i.qty}</div>` : ''
      }</td>
${withPrices ? `<td align="right" style="padding:14px 0 14px 12px;border-top:1px solid ${C.line};vertical-align:top;white-space:nowrap;">${money(i.amount)}</td>` : ''}
</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 ${withPrices ? 0 : 28}px;border-bottom:1px solid ${C.line};">${rows}</table>`;
}

function totalsRows(order: Order): [string, string][] {
  return [
    ['Subtotal', money(order.subtotal)],
    ...(order.discount ? [['Discount', `-${money(order.discount)}`] as [string, string]] : []),
    [order.shippingMethod, order.shipping ? money(order.shipping) : 'Free'],
    ...(order.tax ? [['Tax', money(order.tax)] as [string, string]] : []),
    ['Total', money(order.total)],
  ];
}

function totalsTable(order: Order) {
  const rows = totalsRows(order)
    .map(([label, value], n, all) => {
      const last = n === all.length - 1;
      const style = last ? `padding:12px 0 0;font-weight:600;font-size:16px;` : `padding:4px 0;color:${C.ink2};`;
      return `<tr><td style="${style}">${esc(label)}</td><td align="right" style="${style}">${esc(value)}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 28px;">${rows}</table>`;
}

function shipToBlock(order: Order, withContact = false) {
  const lines = [...order.shipTo, ...(withContact ? [order.email, order.phone].filter((v): v is string => Boolean(v)) : [])];
  if (!lines.length) return '';
  return `<p style="margin:0 0 6px;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:${C.gold};">Shipping to</p>
<p style="margin:0 0 24px;">${lines.map(esc).join('<br>')}</p>`;
}

const noteBlock = (label: string, text: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-left:2px solid ${C.accent};padding:4px 0 4px 16px;">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:${C.accent};">${esc(label)}</p>
<p style="margin:0;font-family:${C.serif};font-size:18px;font-style:italic;">${esc(text)}</p>
</td></tr></table>`;

const itemsText = (order: Order) => order.items.map((i) => `${i.qty} x ${i.name}  ${money(i.amount)}`);
const totalsText = (order: Order) => totalsRows(order).map(([label, value]) => `${label}: ${value}`);
const signoff = () => `\n${site.studio}\n${site.url}`;

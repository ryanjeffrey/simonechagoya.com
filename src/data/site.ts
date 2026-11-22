/**
 * Store-wide settings. Everything a shop owner is likely to change lives here.
 * Values marked CONFIRM are sensible defaults that Simone needs to sign off on.
 */
export const site = {
  name: 'Simone Chagoya',
  studio: 'Simone Chagoya Studio',
  tagline: 'Memory, in stone.',
  description:
    'Natural gemstone necklaces, signed prints and original paintings by Chicago artist Simone Chagoya. Painted and strung by hand, from memory.',
  url: 'https://simonechagoya.com',
  email: 'hello@simonechagoya.com',
  city: 'Chicago, IL',

  // Leave a value empty to hide that link everywhere.
  social: {
    instagram: 'https://www.instagram.com/simonechagoya/',
    pinterest: '',
    etsy: 'https://www.etsy.com/shop/SimoneChagoyaStudio',
  },

  currency: 'USD',

  // Star ratings in src/data/reviews.ts (7 from Etsy, 1 sent directly; the
  // family review is excluded). Update as reviews come in; set count to 0 to hide.
  rating: { average: 5, count: 8 },

  // Shipping policy, confirmed by Simone (November 2026).
  shipping: {
    countries: ['US'] as const,
    freeThreshold: 75, // dollars; set to 0 to disable free shipping
    standardRate: 7,
    expressRate: 18,
    processing: '2 to 4 business days',
    carrier: 'USPS Ground Advantage',
    // A seasonal order-by date. It shows on /shipping-returns until the day after `until`; set to null to remove it.
    cutoff: {
      note: 'Order by Dec 11, 2026 for Christmas delivery (Dec 10 for Alaska and Hawaii).',
      detail: 'Delivery dates are estimates and aren’t guaranteed by USPS.',
      until: '2026-12-11',
    } as { note: string; detail?: string; until: string } | null,
  },

  // Returns policy, confirmed by Simone (November 2026). Ready-to-ship jewelry
  // can come back within `days`; original artwork and art products are final sale.
  returns: {
    days: 14,
  },

  announcement: 'Complimentary US shipping over $75',

  // A timed sale, applied automatically at checkout: no code. Set to null when there is none.
  // The banner shows from now until `ends`; prices drop between `starts` and `ends`.
  // Times carry the Chicago offset (-06:00 in winter, -05:00 in summer). See src/lib/sale.ts.
  sale: {
    name: 'Black Friday Sale',
    percentOff: 20,
    // Jewelry and prints. Card sets, original paintings and commissions are not included.
    categories: ['necklaces', 'earrings', 'bracelets', 'rings', 'prints'],
    starts: '2026-11-27T00:00:00-06:00',
    ends: '2026-12-01T00:00:00-06:00', // through Monday, November 30
    banner: 'Black Friday Sale: 20% off jewelry & prints, Nov 27–30. Free US shipping over $75.',
    // The announcement on the home page.
    headline: 'Black Friday at the studio',
    dates: 'Friday, November 27 through Monday, November 30',
    body: 'For four days, every handmade gemstone necklace and signed print is 20% off. Each piece ships gift-wrapped and tracked, with free US shipping on orders over $75.',
    // Set as one short paragraph under the announcement, followed by a linked return policy line.
    finePrint: [
      'Applied automatically at checkout, no code needed.',
      'Original paintings and commissions excluded. Can’t be combined with other offers.',
      'Free US shipping over $75 after the discount.',
      'Order by Dec 11, 2026 for Christmas delivery (Dec 10 for Alaska and Hawaii). Delivery dates are estimates and aren’t guaranteed by USPS.',
    ],
    returns: 'Jewelry has 14 days, and prints and card sets are final sale.',
  } as {
    name: string;
    percentOff: number;
    categories: string[];
    starts: string;
    ends: string;
    banner: string;
    headline: string;
    dates: string;
    body: string;
    finePrint: string[];
    returns: string;
  } | null,

  // "Become a collector" popup. Shows once per visitor, after a short delay.
  // The code is created in Stripe by `npm run setup:stripe` (10% off, first order only).
  // Set enabled to false to turn the popup off.
  collector: {
    enabled: true,
    code: 'COLLECTOR10',
    percentOff: 10,
    delaySeconds: 12,
  },
};

export const nav = [
  { label: 'Jewelry', href: '/shop/jewelry' },
  { label: 'Art', href: '/art' },
  { label: 'Shop all', href: '/shop' },
  { label: 'About', href: '/about' },
  { label: 'Commissions', href: '/commissions' },
];

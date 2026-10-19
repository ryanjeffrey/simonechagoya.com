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

  // CONFIRM: shipping policy
  shipping: {
    countries: ['US'] as const,
    freeThreshold: 75, // dollars; set to 0 to disable free shipping
    standardRate: 6,
    expressRate: 18,
    processing: '2 to 4 business days',
  },

  // CONFIRM: returns policy
  returns: {
    days: 30,
  },

  announcement: 'Complimentary US shipping over $75',

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

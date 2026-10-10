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

  // From the Etsy shop. Update as reviews come in; set count to 0 to hide.
  // Matches src/data/reviews.ts (7 of 8 Etsy reviews; the family review is excluded).
  rating: { average: 5, count: 7, source: 'Etsy' },

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
};

export const nav = [
  { label: 'Jewelry', href: '/shop/jewelry' },
  { label: 'Art', href: '/art' },
  { label: 'Shop all', href: '/shop' },
  { label: 'About', href: '/about' },
  { label: 'Commissions', href: '/commissions' },
];

# simonechagoya.com

The online studio and store for Simone Chagoya: natural gemstone necklaces, signed prints, watercolor cards and original paintings, made in Chicago.

Built with [Astro](https://astro.build) as a static site, plus one serverless function that opens Stripe Checkout. It is hosted on Netlify and has no monthly platform fee. Payments cost Stripe's standard processing rate.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # production build into dist/
npm run check      # type check
```

Node 22.12 or newer.

## Launch checklist

1. **Netlify.** Create a site from this repo. `netlify.toml` already holds the build settings. Point `simonechagoya.com` at it.
2. **Stripe.** Create the account, then add `STRIPE_SECRET_KEY` under Netlify > Site configuration > Environment variables. Use an `sk_test_` key first and place a test order with card `4242 4242 4242 4242`. Switch to the live key when the test order works.
   - Apple Pay and Google Pay appear in Checkout automatically.
   - Promotion codes are switched on, so discount codes made in the Stripe dashboard work at checkout.
   - Once Stripe Tax is set up for the states where you are registered, set `STRIPE_AUTOMATIC_TAX=true`.
3. **Product photos.** The 13 live Etsy listings are imported (titles, prices, stock, descriptions, intentions, specs, care). Their photos are not in the repo yet because the build sandbox could not reach Etsy's image host. On any normal machine, run once and commit the result:

   ```bash
   npm run import:etsy -- --fetch-images
   git add src/assets/products src/content/products && git commit -m "Add Etsy product photos"
   ```

   Until then each piece shows its drawn illustration, and the Google/Pinterest feed leaves it out. Listing videos are not imported; the gallery is photo only for now.
4. **Forms.** In Netlify > Forms, turn on form detection. Add an email notification for the `inquiry` form (commissions and contact) and the `newsletter` form.
5. **Confirm the policies** listed under "Needs Simone's sign-off" below.
6. **Free listings.** Submit `https://simonechagoya.com/feeds/products.xml` to Google Merchant Center (free Shopping listings) and as a Pinterest catalog. Only real, available products with photos are included.
7. **Etsy.** Point the Etsy shop announcement and About section at the new site.

## Adding and editing products

Each product is one Markdown file in `src/content/products/`. The file name is the URL: `smoke-necklace.md` becomes `/products/smoke-necklace`.

```md
---
title: "Smoke Necklace"
category: necklaces          # necklaces, earrings, bracelets, rings, prints, cards, originals
price: 250
summary: "The Smoke Necklace is for the woman who is grounded, steady, and clear in her purpose."
intention: "Grounding · Focus · Protection"   # brass caps line above the title
images:
  - ../../assets/products/smoke-necklace/1.jpg
materials: ["Smoky and Clear Quartz", "Solid 925 Sterling Silver Clasp, rings, and beads"]
dimensions: "17 in"
specs:                       # the Details tab; derived from materials and dimensions if left out
  - { label: "Bead size", value: "23 x 8 mm" }
care:                        # the Care tab; a general note is shown if left out
  - "Store the necklace separately in the included cotton muslin bag."
stock: 1
oneOfAKind: true
status: available            # available, sold, or inquire (originals)
featured: true               # shown first and on the home page
---

The description goes here, in plain paragraphs.
```

- **After a sale**, set `status: sold`. Sold pieces stay on the site with a Sold badge, which helps show demand. Stripe emails you every order.
- **Photos** go in `src/assets/products/<slug>/`. Shoot them at a 4:5 ratio, at least 2000 px tall, in soft daylight on linen or stone. The site resizes and compresses them automatically.
- **Products without photos** draw an illustration from the `art:` block (bead colors, clasp metal and so on). It disappears as soon as `images` has a photo.
- **Original paintings** use `status: inquire`. They show an Inquire button that opens the commissions form with the painting's name filled in.

### Importing from Etsy

1. On Etsy, go to Shop Manager > Settings > Options > Download Data and download the CSV under Currently for Sale Listings.
2. Run:

```bash
npm run import:etsy -- ~/Downloads/EtsyListingsDownload.csv --dry-run          # preview, writes nothing
npm run import:etsy -- ~/Downloads/EtsyListingsDownload.csv --replace-samples  # import and remove sample listings
```

The importer creates one file per listing, downloads every listing photo, guesses the category from the title and tags, and prints a list of anything to check by hand. It reads Simone's description format: the intention line, the Details block (into `specs`), the Care block (into `care`), and drops the repeated title and the sign-off. It never overwrites an existing product unless you pass `--force`, and it never touches original paintings.

- `--no-images` imports the text only and records the photo URLs in `etsyImages`. `--fetch-images` (no CSV needed) downloads them later.
- `--force` rewrites every field from the CSV except `featured`. Make other hand edits after the last import, or redo them.
- The CSV does not include videos, sold listings or reviews. Sold listings and videos need the Etsy API (a developer key and OAuth); reviews are a separate download (Shop Manager > Settings > Options > Download Data).

## Needs Simone's sign-off

These are sensible defaults. Change them in `src/data/site.ts` or the page named.

- **Shipping:** $6 standard, $18 express, complimentary over $75, ships in 2 to 4 business days, US only.
- **Returns:** 30 days for unworn ready-to-ship pieces, custom work final sale (`/shipping-returns`).
- **Claims in the copy:** "strung by hand in Chicago", "most necklaces are made once", handwritten gift notes, originals shipped by an art shipper (`/faq`, `/shipping-returns`, home page). Materials, packaging and care in `/faq` come from her Etsy listings.
- **Social links:** Instagram is set. Add Pinterest in `site.ts` to show it in the footer.
- **Reviews:** the seven customer reviews from the Etsy export are in `src/data/reviews.ts`, word for word. The eighth, from a family member, is left out on purpose: the FTC review rule requires disclosing that relationship, and an undisclosed family review is the first thing a skeptical buyer spots. The rating line ("5.0 from 7 reviews on Etsy") is in `site.ts`.
- **Portrait:** the About page uses a painting where a photo of Simone in the studio would convert better.

## How it is put together

```
src/
  content/products/     one Markdown file per product
  content.config.ts     the product schema (what fields are allowed)
  data/site.ts          store settings: shipping, returns, rating, social links
  data/reviews.ts       customer reviews (section hidden while empty)
  assets/               paintings and brand imagery, optimized at build time
  components/           header, footer, bag drawer, product card, illustrations
  layouts/              page shells
  lib/bag.ts            the shopping bag (browser side)
  lib/catalog.ts        catalog helpers, category names and copy
  pages/                every route, including:
    api/checkout.ts     re-prices the bag server side and opens Stripe Checkout
    bag.json.ts         catalog data the bag reads
    feeds/products.xml.ts  Google Merchant and Pinterest feed
scripts/import-etsy.mjs  Etsy CSV importer
```

**Design system.** Colors, type scale and spacing are CSS variables at the top of `src/styles/global.css`: linen and stone grounds, espresso ink, fired clay and brass accents. The type is Cormorant (display) with Instrument Sans (text). Both fonts are self-hosted.

**Logo.** Simone's mark lives in `public/brand/` as SVG (wordmark, and the full lockup with STUDIO), vectorized from her logo file, plus a PNG for search engines. The site draws it through `src/components/Logo.astro`, which takes its color from the surrounding text, so the same file works on light and dark backgrounds. To update the logo, replace the SVG files and keep their names.

**Checkout safety.** The browser only sends product slugs and quantities. Prices, stock, sample status and one-of-one limits are all checked again on the server before Stripe sees the order.

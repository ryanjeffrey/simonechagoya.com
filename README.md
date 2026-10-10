# simonechagoya.com

The online studio and store for Simone Chagoya: natural gemstone necklaces, signed prints, watercolor cards and original paintings, made in Chicago.

Built with [Astro](https://astro.build) as a static site, plus two serverless functions: one opens Stripe Checkout, one receives Stripe's webhook. It is hosted on Netlify and has no monthly platform fee. Payments cost Stripe's standard processing rate.

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
2. **Stripe** (Payments only; Connect is for platforms that pay other sellers, and this shop has one seller). Do this once in a Stripe sandbox, then again in live mode, because live keys and live webhooks have their own secrets.
   1. **Key.** Create a restricted key (`rk_...`) with write access to Checkout Sessions, and save it as `STRIPE_SECRET_KEY` in Netlify > Site configuration > Environment variables. If a test checkout fails with a permission error, add the permission the error names. A restricted key limits the damage if it ever leaks; avoid the full `sk_` secret key.
   2. **Build hook.** Netlify > Site configuration > Build & deploy > Build hooks: add one called "Stripe sale" and save its URL as `NETLIFY_BUILD_HOOK_URL`.
   3. **Webhook.** Stripe > Developers > Webhooks: add `https://simonechagoya.com/api/stripe-webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`. Save its signing secret (`whsec_...`) as `STRIPE_WEBHOOK_SECRET`. This is required, not optional: it is what stops a one-of-one piece from selling twice.
   4. **Test.** Buy a single piece with card `4242 4242 4242 4242`. Then check: Stripe shows the webhook delivered with a 200, a second checkout for the piece is refused, and after the rebuild (about a minute) the piece shows Sold. Delete the test order afterwards (see "After a sale" below).
   5. **Payment methods** are managed in Stripe > Settings > Payment methods. The code never hardcodes a list, so Apple Pay, Google Pay and Link appear where they fit.
   6. **Sales tax.** On Etsy, Etsy collected and paid sales tax as the marketplace. On her own site, Simone is responsible, starting with Illinois orders. In Stripe Tax, set the head office address (the studio), add an Illinois registration, then set `STRIPE_AUTOMATIC_TAX=true`. Without an active registration, Stripe collects no tax and shows no error. Stripe Tax charges a per-transaction fee; confirm the setup with her accountant.
   - Promotion codes are switched on, so discount codes made in the Stripe dashboard work at checkout.
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

- **After a sale**, single pieces (stock 1) mark themselves: the Stripe webhook records the order and rebuilds the site, and the piece shows Sold. Sold pieces stay on the site, which helps show demand. Stripe emails you every order. For prints and small runs, lower `stock` by hand.
- **Relisting a returned piece:** delete its order in Netlify > Blobs > `inventory` (`orders/<checkout session id>`), then trigger a deploy. If a sold piece ever still shows as available after a rebuild, set `status: sold` in its file; checkout refuses it either way.
- **Photos** go in `src/assets/products/<slug>/`. Shoot them at a 4:5 ratio, at least 2000 px tall, in soft daylight on linen or stone. Run them through `scripts/media` first (below) so every photo shares one white balance and finish. The site resizes and compresses them automatically.
- **Videos** go in `public/media/products/<slug>/` as short muted MP4 loops with a poster frame, listed under `videos:` in the product file. They play second in the gallery, only while on screen, and never on their own for visitors who turn off motion.
- **Products without photos** draw an illustration from the `art:` block (bead colors, clasp metal and so on). It disappears as soon as `images` has a photo.
- **Original paintings** use `status: inquire`. They show an Inquire button that opens the commissions form with the painting's name filled in.

### Photos and video

`scripts/media` grades every photo and video to one white balance, exposure and finish, so pieces shot on different days look like one collection. It measures each photo on its own background and corrects the light, not the stones. It also converts iPhone HEIC and Display P3 to web sRGB and strips all metadata, including GPS location.

```bash
python3 -m venv .venv-media && .venv-media/bin/pip install -r scripts/media/requirements.txt
.venv-media/bin/python -I scripts/media/grade.py photo IMG_5010.heic src/assets/products/smoke-necklace/1.jpg
.venv-media/bin/python -I scripts/media/video.py IMG_4759.mov public/media/products/smoke-necklace/1.mp4 public/media/products/smoke-necklace/1.jpg --start 2 --dur 8
```

```md
videos:
  - { src: "/media/products/smoke-necklace/1.mp4", poster: "/media/products/smoke-necklace/1.jpg" }
```

`video.py` tone-maps iPhone HDR, crops to the gallery's 4:5 frame (`--x`/`--y` move the crop), trims (`--start`/`--dur`, 10 seconds by default), drops the sound and writes a small H.264 file. It needs ffmpeg. Keep each loop under about 3 MB: video lives in the git repo, and every visitor who opens the page downloads it.

### Importing from Etsy

1. On Etsy, go to Shop Manager > Settings > Options > Download Data and download the CSV under Currently for Sale Listings.
2. Run:

```bash
npm run import:etsy -- ~/Downloads/EtsyListingsDownload.csv --dry-run          # preview, writes nothing
npm run import:etsy -- ~/Downloads/EtsyListingsDownload.csv --replace-samples  # import and remove sample listings
```

The importer creates one file per listing, downloads every listing photo, guesses the category from the title and tags, and prints a list of anything to check by hand. It reads Simone's description format: the intention line, the Details block (into `specs`), the Care block (into `care`), and drops the repeated title and the sign-off. It never overwrites an existing product unless you pass `--force`, and it never touches original paintings.

- `--no-images` imports the text only and records the photo URLs in `etsyImages`. `--fetch-images` (no CSV needed) downloads them later.
- `--force` rewrites every field from the CSV except `featured`, including `images`. Do not force-import products whose photos came from somewhere else (Tigre, Mosaic and the two prints use graded photos from Simone's Drive).
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
  lib/inventory.ts      holds and recorded orders for single pieces (Netlify Blobs)
  pages/                every route, including:
    api/checkout.ts     re-prices the bag server side, holds single pieces and opens Stripe Checkout
    api/stripe-webhook.ts  records orders and rebuilds the site after a sale
    bag.json.ts         catalog data the bag reads
    feeds/products.xml.ts  Google Merchant and Pinterest feed
scripts/import-etsy.mjs  Etsy CSV importer
```

**Design system.** Colors, type scale and spacing are CSS variables at the top of `src/styles/global.css`: linen and stone grounds, espresso ink, fired clay and brass accents. The type is Cormorant (display) with Instrument Sans (text). Both fonts are self-hosted.

**Logo.** Simone's mark lives in `public/brand/` as SVG (wordmark, and the full lockup with STUDIO), vectorized from her logo file, plus a PNG for search engines. The site draws it through `src/components/Logo.astro`, which takes its color from the surrounding text, so the same file works on light and dark backgrounds. To update the logo, replace the SVG files and keep their names.

**Checkout safety.** The browser only sends product slugs and quantities. Prices, stock, sample status and one-of-one limits are all checked again on the server before Stripe sees the order. A single piece is held for one buyer while their Checkout is open (31 minutes, then the session expires), and a piece with a recorded order is refused even before the site rebuilds. Holds and orders live in Netlify Blobs (`src/lib/inventory.ts`). Webhook events are verified against the signing secret before anything else runs.

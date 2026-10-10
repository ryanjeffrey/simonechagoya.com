// @ts-check
import { defineConfig, envField } from 'astro/config';
import netlify from '@astrojs/netlify';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://simonechagoya.com',
  trailingSlash: 'ignore',
  // Images are optimized at build time so the site works the same on any host.
  adapter: netlify({ imageCDN: false }),
  integrations: [
    sitemap({
      filter: (page) => !/\/(checkout|contact\/thanks|api)\b/.test(page),
    }),
  ],
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  env: {
    schema: {
      STRIPE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      STRIPE_AUTOMATIC_TAX: envField.boolean({ context: 'server', access: 'public', default: false }),
      STRIPE_WEBHOOK_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      NETLIFY_BUILD_HOOK_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});

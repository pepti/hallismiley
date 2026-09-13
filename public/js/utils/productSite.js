// Rekstrarkerfið has its own site. The company site says what the product is
// and hands anyone who wants to know more to that site in a new tab — it never
// carries the product's tiers or prices (Halli, 2026-09-13). Both locales exist
// there under the same prefixes as here.
export const PRODUCT_SITE = 'https://rekstrarkerfi.is';

export function productSiteUrl(locale) {
  return `${PRODUCT_SITE}/${locale === 'en' ? 'en' : 'is'}/`;
}

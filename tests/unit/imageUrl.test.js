'use strict';

// Unit tests for public/js/utils/imageUrl.js (ESM compiled to CJS by
// babel-jest). The thumbnail URL is derived client-side, so the contract with
// server/services/productImages.js (`<original>.thumb.webp`, local product
// images only) is pinned here. Harvested from icelandicstore #240
// (harvest-ice-d-2026-09-24); ice's press-room cardUrl is not taken.
const { thumbUrl, originalUrl, THUMB_SUFFIX } = require('../../public/js/utils/imageUrl');

describe('thumbUrl', () => {
  test('appends the thumb suffix to an admin-uploaded product image', () => {
    expect(thumbUrl('/assets/products/8e0b63c0-03d1-4fe0-a984-e374171497c5/1788363301882-gyt7t3k.png'))
      .toBe('/assets/products/8e0b63c0-03d1-4fe0-a984-e374171497c5/1788363301882-gyt7t3k.png.thumb.webp');
  });

  test('handles the Shopify-imported folder shapes (slug + numeric) and every accepted extension', () => {
    expect(thumbUrl('/assets/products/the-arctic-puffin-plush-toy/puffin.jpg')).toMatch(/\.jpg\.thumb\.webp$/);
    expect(thumbUrl('/assets/products/1203/a.jpeg')).toMatch(/\.jpeg\.thumb\.webp$/);
    expect(thumbUrl('/assets/products/1203/a.webp')).toMatch(/\.webp\.thumb\.webp$/);
    expect(thumbUrl('/assets/products/1203/A.PNG')).toBe(`/assets/products/1203/A.PNG${THUMB_SUFFIX}`);
  });

  test('leaves external / non-product / already-thumbnailed URLs alone', () => {
    expect(thumbUrl('https://cdn.shopify.com/s/files/1/x.jpg')).toBe('https://cdn.shopify.com/s/files/1/x.jpg');
    expect(thumbUrl('/assets/news/1/x.jpg')).toBe('/assets/news/1/x.jpg');
    expect(thumbUrl('/assets/products/1203/a.gif')).toBe('/assets/products/1203/a.gif');
    expect(thumbUrl('/assets/products/1203/a.png?v=2')).toBe('/assets/products/1203/a.png?v=2');
    const already = '/assets/products/1203/a.png.thumb.webp';
    expect(thumbUrl(already)).toBe(already);
  });

  test('is null-safe', () => {
    expect(thumbUrl(null)).toBeNull();
    expect(thumbUrl(undefined)).toBeNull();
    expect(thumbUrl('')).toBeNull();
  });
});

describe('originalUrl', () => {
  test('strips the suffix and is a no-op otherwise', () => {
    expect(originalUrl('/assets/products/1203/a.png.thumb.webp')).toBe('/assets/products/1203/a.png');
    expect(originalUrl('/assets/products/1203/a.png')).toBe('/assets/products/1203/a.png');
    expect(originalUrl(null)).toBeNull();
  });
});

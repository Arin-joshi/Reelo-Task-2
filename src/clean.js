function shortText(value, max) {
  const cleaned = text(value);
  if (!cleaned || cleaned.length > max) return null;
  return cleaned;
}

function text(value) {
  if (value == null) return null;
  if (typeof value === 'object') value = value.name || value.value || '';
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function firstNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null || value === '') return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null || value === '') return null;
  return firstNumber(String(value).replace(/rm/ig, ''));
}

function percent(value) {
  return firstNumber(value);
}

function rating(value) {
  const n = firstNumber(value);
  if (n == null || n < 0 || n > 5) return null;
  return n;
}

function count(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (value == null || value === '') return null;
  const raw = String(value).trim().toLowerCase().replace(/,/g, '');
  let mul = 1;
  if (/[\d.]\s*k\b/.test(raw)) mul = 1000;
  if (/[\d.]\s*m\b/.test(raw)) mul = 1000000;
  const match = raw.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]) * mul;
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function absoluteUrl(value) {
  if (!value) return null;
  let raw = String(value).trim();
  if (!raw) return null;
  if (raw.startsWith('//')) raw = 'https:' + raw;
  else if (raw.startsWith('/')) raw = 'https://www.lazada.com.my' + raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete('spm');
    const query = url.searchParams.toString();
    return url.origin + url.pathname + (query ? '?' + query : '');
  } catch (err) {
    return null;
  }
}

function uniqueTexts(values) {
  const out = [];
  const seen = new Set();
  (values || []).forEach((value) => {
    const cleaned = text(value);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push(cleaned);
  });
  return out;
}

function cleanSpecs(rows) {
  const out = [];
  const seen = new Set();
  (rows || []).forEach((row) => {
    const name = text(row && row.name);
    const value = text(row && row.value);
    if (!name || !value) return;
    const key = name + '\0' + value;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, value });
  });
  return out;
}

function cleanVariations(groups) {
  const out = [];
  (groups || []).forEach((group) => {
    const options = uniqueTexts(group && group.options);
    if (!options.length) return;
    out.push({ name: text(group && group.name) || 'option', options });
  });
  return out;
}

function cleanImages(values) {
  const out = [];
  const seen = new Set();
  (values || []).forEach((value) => {
    const url = absoluteUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  });
  return out;
}

function cleanProduct(raw) {
  if (!raw) return null;
  const itemId = text(raw.itemId);
  const url = absoluteUrl(raw.url);
  const title = text(raw.title);
  if (!itemId || !url || !title) return null;

  const listing = raw.listing || {};

  return {
    itemId,
    skuId: text(raw.skuId),
    url,
    title,
    brand: text(raw.brand),
    sellerName: shortText(raw.sellerName, 80),
    price: money(raw.price),
    originalPrice: money(raw.originalPrice),
    discountPercent: percent(raw.discount),
    rating: rating(raw.rating),
    reviewCount: count(raw.reviewCount),
    soldCount: text(raw.soldCount),
    images: cleanImages(raw.images),
    highlights: uniqueTexts(raw.highlights),
    specifications: cleanSpecs(raw.specifications),
    description: text(raw.description),
    variations: cleanVariations(raw.variations),
    breadcrumb: uniqueTexts(raw.breadcrumb),
    shipping: text(raw.shipping),
    promotions: uniqueTexts(raw.promotions),
    lazMall: Boolean(raw.lazMall),
    listing: {
      price: money(listing.price),
      originalPrice: money(listing.originalPrice),
      discount: percent(listing.discount),
      rating: rating(listing.rating),
      reviewCount: count(listing.reviewCount),
      image: absoluteUrl(listing.image),
      location: text(listing.location),
      sellerName: text(listing.sellerName),
    },
  };
}

module.exports = { cleanProduct };

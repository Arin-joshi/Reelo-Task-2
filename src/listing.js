const { dismissPopups } = require('./browser');

const MIN_PRODUCTS = 10;
const MAX_PAGES = 4;

function withPage(base, pageNo) {
  const url = new URL(base);
  if (pageNo <= 1) url.searchParams.delete('page');
  else url.searchParams.set('page', String(pageNo));
  return url.toString();
}

async function scrollListing(page) {
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(350);
  }
}

// Search results are usually a listItems blob. Card class names move, so the DOM is the backup.
async function readCards(page) {
  return page.evaluate(() => {
    function itemIdFromHref(href) {
      if (!href) return null;
      const match = String(href).match(/(?:pdp-i|[/-]i)(\d+)/i);
      return match ? match[1] : null;
    }

    function skuFromHref(href) {
      const match = String(href || '').match(/-s(\d+)/);
      return match ? match[1] : null;
    }

    function abs(href) {
      if (!href) return '';
      if (href.startsWith('//')) return 'https:' + href;
      if (href.startsWith('/')) return 'https://www.lazada.com.my' + href;
      return href;
    }

    function sliceJson(raw, start) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') {
          inStr = true;
          continue;
        }
        if (ch === '[' || ch === '{') depth += 1;
        else if (ch === ']' || ch === '}') {
          depth -= 1;
          if (depth === 0) return raw.slice(start, i + 1);
        }
      }
      return null;
    }

    function asCard(item) {
      if (!item || typeof item !== 'object') return null;
      const href = item.productUrl || item.itemUrl || item.product_url || item.url || '';
      const itemId = String(item.itemId || item.item_id || itemIdFromHref(href) || '');
      if (!itemId) return null;
      let url = abs(href).split('?')[0];
      if (!url) url = 'https://www.lazada.com.my/products/pdp-i' + itemId + '.html';
      return {
        itemId,
        skuId: item.skuId ? String(item.skuId) : skuFromHref(url),
        url,
        title: item.name || item.title || '',
        price: item.priceShow != null ? item.priceShow : item.price,
        originalPrice: item.originalPriceShow != null ? item.originalPriceShow : item.originalPrice,
        discount: item.discount,
        rating: item.ratingScore != null ? item.ratingScore : item.rating,
        reviewCount: item.review != null ? item.review : item.reviewCount,
        image: item.image || item.img || item.imageUrl || null,
        sellerName: item.sellerName || null,
        location: item.location || item.itemLocation || null,
        lazMall: item.mall === 1 || item.mall === true || item.lazMall === true,
        brand: item.brandName || (typeof item.brand === 'string' ? item.brand : null),
      };
    }

    function cardsFromScripts() {
      const cards = [];
      const scripts = document.scripts;
      for (let s = 0; s < scripts.length; s++) {
        const raw = scripts[s].textContent || '';
        if (raw.length < 40 || raw.indexOf('listItems') === -1) continue;
        let from = 0;
        let hits = 0;
        while (hits < 4) {
          const at = raw.indexOf('listItems', from);
          if (at === -1) break;
          hits += 1;
          from = at + 9;
          const bracket = raw.indexOf('[', at);
          if (bracket === -1 || bracket - at > 30) continue;
          const json = sliceJson(raw, bracket);
          if (!json) continue;
          try {
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) continue;
            parsed.forEach((item) => {
              const card = asCard(item);
              if (card) cards.push(card);
            });
          } catch (err) {
            // not the product array
          }
        }
      }
      return cards;
    }

    function cardFromBox(box) {
      let node = box;
      if (node.matches && node.matches('a')) {
        let parent = node;
        for (let i = 0; i < 5 && parent.parentElement; i++) {
          parent = parent.parentElement;
          const blob = parent.innerText || '';
          if (/RM/i.test(blob) && blob.length < 800) {
            node = parent;
            break;
          }
        }
      }
      const link = node.matches && node.matches('a') ? node : node.querySelector('a[href*="/products/"]');
      if (!link) return null;
      const href = link.href || link.getAttribute('href') || '';
      const itemId = node.getAttribute('data-item-id') || itemIdFromHref(href);
      if (!itemId) return null;
      const img = node.querySelector('img');
      const lines = (node.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const titleAttr = link.getAttribute('title');
      const title = titleAttr || lines.find((line) => line.length > 12 && !/^RM/i.test(line)) || '';
      const prices = lines.filter((line) => /RM/i.test(line));
      const url = abs(href).split('?')[0];
      return {
        itemId: String(itemId),
        skuId: skuFromHref(url),
        url,
        title,
        price: prices[0] || null,
        originalPrice: prices[1] || null,
        discount: lines.find((line) => /%/.test(line)) || null,
        rating: lines.find((line) => /^\d\.\d$/.test(line)) || null,
        reviewCount: lines.find((line) => /^\(?[\d,.]+[kKmM]?\)?$/.test(line)) || null,
        image: img ? (img.currentSrc || img.src || img.getAttribute('data-src')) : null,
        sellerName: null,
        location: lines.find((line) => /selangor|kuala|johor|penang|sabah|sarawak|perak|kedah|kelantan|melaka|malacca|negeri|pahang|perlis|terengganu|putrajaya|labuan|overseas|china/i.test(line)) || null,
        lazMall: /laz\s*mall/i.test(node.innerText || ''),
        brand: null,
      };
    }

    const byId = new Map();
    function add(card) {
      if (!card || !card.itemId || !card.url || byId.has(card.itemId)) return;
      byId.set(card.itemId, card);
    }

    cardsFromScripts().forEach(add);

    const boxes = document.querySelectorAll('[data-qa-locator="product-item"]');
    if (boxes.length) {
      boxes.forEach((box) => add(cardFromBox(box)));
    } else {
      document.querySelectorAll('a[href*="/products/"]').forEach((link) => {
        const box = link.closest('[data-qa-locator="product-item"], [data-item-id]') || link;
        add(cardFromBox(box));
      });
    }

    return Array.from(byId.values());
  });
}

async function collectListing(page) {
  const listingUrl = (process.env.LISTING_URL || '').trim();
  const keyword = (process.env.SEARCH_KEYWORD || '').trim();
  if (!listingUrl && !keyword) {
    throw new Error('Set SEARCH_KEYWORD or LISTING_URL in .env');
  }

  const first = listingUrl || ('https://www.lazada.com.my/catalog/?q=' + encodeURIComponent(keyword));
  const found = new Map();

  for (let pageNo = 1; pageNo <= MAX_PAGES && found.size < MIN_PRODUCTS; pageNo++) {
    const target = withPage(first, pageNo);
    console.log('listing', target);
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await dismissPopups(page);

    try {
      await page.waitForSelector('a[href*="/products/"], [data-qa-locator="product-item"]', { timeout: 20000 });
    } catch (err) {
      console.log('no product links yet');
    }

    await scrollListing(page);
    const cards = await readCards(page);
    cards.forEach((card) => {
      if (!card.itemId || found.has(card.itemId) || found.size >= MIN_PRODUCTS) return;
      found.set(card.itemId, card);
    });
    console.log('unique products so far', found.size);
  }

  return Array.from(found.values());
}

module.exports = { collectListing };

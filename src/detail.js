const { dismissPopups } = require('./browser');

function skuFromUrl(url) {
  const match = String(url || '').match(/-s(\d+)/);
  return match ? match[1] : null;
}

async function collectOnPage(page) {
  return page.evaluate(() => {
    function txt(el) {
      if (!el) return '';
      return (el.innerText || '').replace(/\s+/g, ' ').trim();
    }

    function stripHtml(value) {
      if (!value) return '';
      const holder = document.createElement('div');
      holder.innerHTML = String(value);
      return (holder.innerText || '').replace(/\s+/g, ' ').trim();
    }

    function pushUnique(list, value, limit) {
      const clean = (value || '').replace(/\s+/g, ' ').trim();
      if (!clean || list.includes(clean) || list.length >= limit) return;
      list.push(clean);
    }

    const ld = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const data = JSON.parse(script.textContent);
        const list = Array.isArray(data) ? data : [data];
        list.forEach((item) => {
          if (!item || typeof item !== 'object') return;
          if (item['@type'] === 'Product' || item['@type'] === 'BreadcrumbList') ld.push(item);
          (item['@graph'] || []).forEach((node) => {
            if (node && (node['@type'] === 'Product' || node['@type'] === 'BreadcrumbList')) ld.push(node);
          });
        });
      } catch (err) {
        // broken json-ld, skip
      }
    });

    const product = ld.find((item) => item['@type'] === 'Product') || {};
    const crumbsLd = ld.find((item) => item['@type'] === 'BreadcrumbList');
    const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
    const ratingLd = product.aggregateRating || {};

    const column = document.querySelector('.pdp-block__main-information') || document.body;
    const lines = (column.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const title = txt(document.querySelector('h1, .pdp-mod-product-badge-title-v2, .pdp-product-title'))
      || product.name
      || '';

    const priceBox = column.querySelector('[class*="pdp-price"], [class*="pdp-product-price"], [class*="price-wrap"]');
    const parent = column.parentElement;
    const parentText = parent && (parent.innerText || '').length < 5000 ? parent.innerText : '';
    const priceSource = priceBox
      ? priceBox.innerText
      : (lines.filter((line) => /RM/i.test(line)).join(' ') || parentText);
    const rm = priceSource.match(/RM\s*[\d,.]+/gi) || [];
    const discountMatch = priceSource.match(/-?\d+(?:\.\d+)?\s*%/);

    const images = [];
    const ldImages = product.image;
    const ldList = Array.isArray(ldImages) ? ldImages : (ldImages ? [ldImages] : []);
    ldList.forEach((src) => pushUnique(images, typeof src === 'string' ? src : (src && src.url), 12));

    const gallery = document.querySelector('.item-gallery-v2, .gallery-preview-panel-v2');
    (gallery ? gallery.querySelectorAll('img') : []).forEach((img) => {
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
      if (!/slatic|lazcdn|alicdn|lzd-img/i.test(src)) return;
      pushUnique(images, src, 12);
    });

    const breadcrumb = [];
    if (crumbsLd && Array.isArray(crumbsLd.itemListElement)) {
      crumbsLd.itemListElement.forEach((crumb) => {
        const name = crumb.name || (crumb.item && crumb.item.name);
        pushUnique(breadcrumb, name, 12);
      });
    }
    document.querySelectorAll('[class*="breadcrumb"] a, nav[aria-label*="breadcrumb" i] a').forEach((link) => {
      pushUnique(breadcrumb, txt(link), 12);
    });

    const specifications = [];
    function addSpec(name, value) {
      const left = (name || '').replace(/\s+/g, ' ').trim();
      const right = (value || '').replace(/\s+/g, ' ').trim();
      if (!left || !right) return;
      if (specifications.some((row) => row.name === left && row.value === right)) return;
      if (specifications.length >= 40) return;
      specifications.push({ name: left, value: right });
    }

    document.querySelectorAll(
      '[class*="specification"] tr, [class*="pdp-general-features"] li, [class*="specification"] li'
    ).forEach((row) => {
      const cells = row.querySelectorAll('td, th');
      if (cells.length >= 2) {
        addSpec(txt(cells[0]), txt(cells[1]));
        return;
      }
      const line = txt(row);
      const splitAt = line.indexOf(':');
      if (splitAt > 0) addSpec(line.slice(0, splitAt), line.slice(splitAt + 1));
    });

    // Specs are often only in the page JSON, not a real table.
    function harvest(node, depth, fromSpec) {
      if (!node || depth > 8 || specifications.length >= 40) return;
      if (Array.isArray(node)) {
        if (!fromSpec) return;
        node.forEach((row) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) return;
          const name = row.name || row.key || row.title;
          const value = row.value || row.content || row.text || row.feature;
          if (name && value && typeof value !== 'object') addSpec(name, value);
        });
        return;
      }
      if (typeof node !== 'object') return;
      Object.keys(node).forEach((key) => {
        const specKey = /specif|attribute|feature/i.test(key);
        const container = /data|root|fields|props|product|modules/i.test(key);
        if (!fromSpec && !specKey && !container && depth > 0) return;
        harvest(node[key], depth + 1, fromSpec || specKey);
      });
    }

    document.querySelectorAll('script').forEach((script) => {
      const raw = (script.textContent || '').trim();
      if (raw.length < 80 || raw.length > 1500000) return;
      if (!/specif|attribute/i.test(raw)) return;
      if (raw[0] !== '{' && raw[0] !== '[') return;
      try {
        harvest(JSON.parse(raw), 0, false);
      } catch (err) {
        // script is js, not json
      }
    });

    const highlights = [];
    const highlightHeading = Array.from(document.querySelectorAll('h2, h3, [class*="title"]')).find((el) => {
      return /highlight/i.test(txt(el)) && txt(el).length < 40;
    });
    if (highlightHeading && highlightHeading.parentElement) {
      highlightHeading.parentElement.querySelectorAll('li').forEach((li) => pushUnique(highlights, txt(li), 20));
    }

    const variations = [];
    lines.forEach((line, index) => {
      if (!/:$/.test(line) || /quantity/i.test(line)) return;
      const options = [];
      for (let i = index + 1; i < lines.length; i++) {
        if (/:$/.test(lines[i]) || /RM/i.test(lines[i]) || lines[i].length > 40) break;
        pushUnique(options, lines[i], 20);
      }
      if (options.length) variations.push({ name: line.replace(/:$/, ''), options });
    });

    const promotions = [];
    column.querySelectorAll('[class*="voucher"], [class*="promotion"]').forEach((el) => {
      const label = txt(el);
      if (label.length > 120) return;
      pushUnique(promotions, label, 8);
    });

    const detailRoot = document.querySelector('.pdp-v2-block__product-detail, #module_product_detail');
    if (detailRoot) {
      detailRoot.querySelectorAll('li, tr, div').forEach((row) => {
        const kids = Array.from(row.children).filter((el) => txt(el) && el.children.length === 0);
        if (kids.length !== 2) return;
        if (txt(kids[0]).length > 60 || txt(kids[1]).length > 180) return;
        addSpec(txt(kids[0]), txt(kids[1]));
      });
    }

    let description = stripHtml(product.description || '');
    const descEl = document.querySelector('.pdp-product-desc, [class*="html-content"], #module_product_detail');
    const descText = txt(descEl);
    if (descText && descText.length > 40 && descText.length < 15000 && !/specifications/i.test(descText.slice(0, 80))) {
      description = descText;
    }

    const shipEl = column.querySelector('[class*="delivery"], [class*="pdp-delivery"]');
    let shipping = shipEl ? txt(shipEl) : '';
    if (shipping.length > 400) shipping = '';

    const columnText = lines.join(' ').slice(0, 2500);
    const soldMatch = columnText.match(/([\d.,]+\s*[kKmM]?\s*sold)/i);
    const soldByLine = lines.find((line) => /sold by/i.test(line));
    let sellerName = soldByLine ? soldByLine.replace(/.*sold by\s*/i, '').trim() : '';
    if (!sellerName || sellerName.length > 80) {
      const sellerEl = document.querySelector('[class*="seller-name"]');
      const fromEl = txt(sellerEl);
      sellerName = fromEl.length > 0 && fromEl.length < 80 ? fromEl : '';
    }
    if (!sellerName) {
      const shop = Array.from(document.querySelectorAll('a[href*="/shop/"]')).find((link) => {
        const label = txt(link);
        return label && label.length < 60 && !/^more\b/i.test(label);
      });
      sellerName = shop ? txt(shop) : '';
    }

    let brand = typeof product.brand === 'string' ? product.brand : ((product.brand && product.brand.name) || '');
    const brandLine = txt(document.querySelector('.pdp-product-brand-v2'));
    const brandMatch = brandLine.match(/Brand:\s*(.+)/i);
    if (brandMatch) brand = brandMatch[1].split(/More/i)[0].trim() || brand;

    const ratingEl = document.querySelector(
      '[class*="pdp-review"] [class*="score"], [class*="rating-score"], [class*="score-average"]'
    );
    const reviewEl = document.querySelector('[class*="pdp-review"] [class*="count"], [class*="review-count"], a[href*="review"]');

    return {
      title,
      brand,
      price: (offer && (offer.price || offer.lowPrice)) || rm[0] || '',
      originalPrice: rm.length > 1 ? rm[1] : '',
      discount: discountMatch ? discountMatch[0] : '',
      rating: ratingLd.ratingValue || txt(ratingEl),
      reviewCount: ratingLd.reviewCount || ratingLd.ratingCount || txt(reviewEl),
      soldCount: soldMatch ? soldMatch[1] : '',
      description,
      sellerName,
      lazMall: /laz\s*mall/i.test(columnText),
      shipping,
      breadcrumb,
      images,
      highlights,
      specifications,
      variations,
      promotions,
      sku: product.sku || '',
    };
  });
}

async function readDetail(page, card) {
  if (!card.url) throw new Error('missing product url');

  await page.goto(card.url, { waitUntil: 'domcontentloaded' });
  await dismissPopups(page);

  if (/\/user\/login|passport\./i.test(page.url())) {
    throw new Error('got bounced to login');
  }

  try {
    await page.waitForFunction(() => {
      const heading = document.querySelector('h1, .pdp-mod-product-badge-title-v2');
      if (!heading || !heading.innerText.trim()) return false;
      return /RM\s*\d/.test(document.body.innerText);
    }, { timeout: 25000 });
  } catch (err) {
    const title = await page.locator('h1').innerText().catch(() => '');
    if (!title.trim()) throw new Error('product page did not show a title and price');
  }

  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 1100);
    await page.waitForTimeout(250);
  }
  await dismissPopups(page);
  const picked = await collectOnPage(page);
  const finalUrl = page.url().split('?')[0] || card.url;
  const skuFromPage = /^\d+$/.test(String(picked.sku || '')) ? String(picked.sku) : null;

  return {
    itemId: card.itemId,
    skuId: skuFromUrl(finalUrl) || card.skuId || skuFromPage,
    url: finalUrl,
    title: picked.title || card.title,
    brand: picked.brand || card.brand,
    sellerName: picked.sellerName || card.sellerName,
    price: picked.price || card.price,
    originalPrice: picked.originalPrice || card.originalPrice,
    discount: picked.discount || card.discount,
    rating: picked.rating || card.rating,
    reviewCount: picked.reviewCount || card.reviewCount,
    soldCount: picked.soldCount,
    images: picked.images && picked.images.length ? picked.images : (card.image ? [card.image] : []),
    highlights: picked.highlights,
    specifications: picked.specifications,
    description: picked.description,
    variations: picked.variations,
    breadcrumb: picked.breadcrumb,
    shipping: picked.shipping,
    promotions: picked.promotions,
    lazMall: Boolean(picked.lazMall || card.lazMall),
    listing: {
      price: card.price,
      originalPrice: card.originalPrice,
      discount: card.discount,
      rating: card.rating,
      reviewCount: card.reviewCount,
      image: card.image,
      location: card.location,
      sellerName: card.sellerName,
    },
  };
}

module.exports = { readDetail };

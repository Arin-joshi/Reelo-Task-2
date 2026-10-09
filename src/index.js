require('dotenv').config();

const { launchBrowser } = require('./browser');
const { ensureLogin } = require('./login');
const { collectListing } = require('./listing');
const { readDetail } = require('./detail');
const { cleanProduct } = require('./clean');
const { saveRun } = require('./db');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const startedAt = new Date();
  const keyword = (process.env.LISTING_URL || process.env.SEARCH_KEYWORD || '').trim();
  const { browser, context, page } = await launchBrowser();

  try {
    const accountName = await ensureLogin(page, context);
    const cards = await collectListing(page);
    console.log('listing has', cards.length, 'products');

    if (!cards.length) {
      throw new Error('No products on the listing page. Try another SEARCH_KEYWORD.');
    }

    const rows = [];
    let failed = 0;

    for (let i = 0; i < cards.length; i++) {
      if (i > 0) {
        const wait = 2000 + Math.floor(Math.random() * 3001);
        console.log('wait', (wait / 1000).toFixed(1) + 's');
        await sleep(wait);
      }

      const card = cards[i];
      console.log('detail', (i + 1) + '/' + cards.length, card.itemId);
      try {
        const raw = await readDetail(page, card);
        const cleaned = cleanProduct(raw);
        if (!cleaned) {
          failed += 1;
          console.log('skip', card.itemId, 'missing itemId, url, or title');
          continue;
        }
        rows.push(cleaned);
      } catch (err) {
        failed += 1;
        console.log('detail failed', card.itemId, err.message);
      }
    }

    const run = {
      startedAt,
      keyword,
      accountName,
      scraped: cards.length,
      saved: rows.length,
      failed,
    };

    try {
      await saveRun(rows, run);
    } catch (err) {
      console.log('scraped %s  saved 0  failed %s', cards.length, failed);
      throw err;
    }

    console.log('scraped %s  saved %s  failed %s', run.scraped, run.saved, run.failed);
    if (run.saved < 10) console.log('short of 10 saved products');
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

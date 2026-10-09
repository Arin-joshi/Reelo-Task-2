const { MongoClient } = require('mongodb');

async function saveRun(products, run) {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGODB_DB || 'lazada';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
    const db = client.db(dbName);
    const scrapedAt = new Date();

    if (products.length) {
      const ops = products.map((doc) => ({
        updateOne: {
          filter: { itemId: doc.itemId },
          update: { $set: Object.assign({}, doc, { scrapedAt }) },
          upsert: true,
        },
      }));
      await db.collection('products').bulkWrite(ops, { ordered: false });
    }

    await db.collection('scrape_runs').insertOne(Object.assign({}, run, { finishedAt: scrapedAt }));
  } catch (err) {
    const refused = err && (err.name === 'MongoServerSelectionError' || /ECONNREFUSED|getaddrinfo/i.test(err.message || ''));
    if (refused) {
      throw new Error(
        'Could not connect to MongoDB at ' + uri + '. Start the MongoDB service, then run this again. Compass uses the same address.'
      );
    }
    throw err;
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { saveRun };

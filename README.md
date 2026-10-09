# Lazada product scraper

One command, `npm run scrape`, does the whole job on Lazada Malaysia (lazada.com.my):

1. Log in. If a saved session exists, reuse it.
2. Open a search or category page and collect at least 10 products.
3. Open each product page and read the sections that are actually there.
4. Clean prices, percents, text, and links.
5. Upsert into MongoDB, then print `scraped`, `saved`, and `failed`.

Nothing is written to MongoDB until every product in that batch has been opened.

## What you need

- Node 18 or newer
- MongoDB Server running locally
- MongoDB Compass, if you want to look at the documents
- A Lazada Malaysia account

Compass is only the viewer. The script writes to MongoDB Server. If Compass already connects to `mongodb://127.0.0.1:27017`, the server is running and you can skip the installer below.

If it cannot connect, install MongoDB Community Server from https://www.mongodb.com/try/download/community (Windows MSI). Leave **Install MongoDB as a Service** checked. You can skip Compass in that installer if you already have it. If Compass still fails, open Windows Services and start the MongoDB service.

## Install

```bash
npm install
npx playwright install chromium
```

Copy `.env.example` to `.env` and fill it in:

```
LAZADA_EMAIL=you@email.com
LAZADA_PASSWORD=your-password
SEARCH_KEYWORD=earphones
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=lazada
```

`SEARCH_KEYWORD` is what gets typed into Lazada search. To open a category page instead, set `LISTING_URL` to that page. When `LISTING_URL` is set, the keyword is ignored.

Do not commit `.env` or `session.json`. Both are gitignored. They hold the password and the logged-in cookies.

## First run

```bash
npm run scrape
```

A Chrome window opens. Lazada usually shows an "I'm not a robot" box right after the email and password are filled. Tick it in that window. If it asks for a puzzle or a one-time code, finish that too. When the box is gone, press Enter in the terminal.

The script then clicks LOGIN, checks that your account name is in the header, and saves `session.json`.

It prints a line per product, then a summary:

```text
scraped 10  saved 10  failed 0
```

`scraped` is how many listing cards were opened. `saved` is how many documents were upserted. `failed` is a detail page that did not load, or a product with no id, url, or title. There is a 2–5 second pause between product pages.

## See the data in Compass

1. Open Compass.
2. Connect to `mongodb://127.0.0.1:27017`.
3. Refresh the sidebar if `lazada` is not there yet.
4. Open `lazada` → `products`. One document per product, keyed by `itemId`.
5. Open `lazada` → `scrape_runs`. One document per run, with `scraped`, `saved`, `failed`, the keyword, and the account name.

A second run updates the same `itemId` instead of inserting a duplicate. `listing` on each product is what the card showed. The other fields (`title`, `price`, `originalPrice`, `discountPercent`, `rating`, `reviewCount`, `images`, `specifications`, `description`, and so on) come from the product page. Prices are numbers (`RM 1,299.00` becomes `1299`). A percent becomes a number. Text is trimmed. Links are absolute.

## Later runs

Same command. While `session.json` is still good, it skips the login form and goes to the listing page. If Lazada logs you out, it asks for the email and password again.

Change `SEARCH_KEYWORD` in `.env` when you want a different search.

## Files

```
src/index.js     login, listing, each detail page, then clean, then save
src/browser.js   Chrome window and session.json
src/login.js     email/password, and the pause for the robot check
src/listing.js   search or category, unique itemIds, stop at 10
src/detail.js    one product page
src/clean.js     RM, percents, text, absolute urls
src/db.js        products bulkWrite upsert on itemId, then scrape_runs
```

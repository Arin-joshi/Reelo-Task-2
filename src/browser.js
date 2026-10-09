const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Lazada drops you if the file only has cookies. It also checks localStorage.
const sessionFile = path.join(__dirname, '..', 'session.json');

function sessionState() {
  if (!fs.existsSync(sessionFile)) return null;
  try {
    JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    return sessionFile;
  } catch (err) {
    console.log('session.json is unreadable, logging in again');
    return null;
  }
}

async function launchBrowser() {
  const browser = await chromium.launch({
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const options = {
    locale: 'en-MY',
    timezoneId: 'Asia/Kuala_Lumpur',
    viewport: { width: 1366, height: 800 },
  };

  const saved = sessionState();
  if (saved) options.storageState = saved;

  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  return { browser, context, page };
}

async function saveSession(context) {
  await context.storageState({ path: sessionFile });
  console.log('saved session.json');
}

async function dismissPopups(page) {
  // Don't close the robot check. That X just brings the same box back.
  const robot = page.getByText(/not a robot|check if you are a robot/i).first();
  if (await robot.isVisible().catch(() => false)) return;

  const close = page.locator(
    '[aria-label="close" i], .next-dialog-close, button:has-text("No thanks"), button:has-text("Not now")'
  ).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
  }
}

module.exports = {
  launchBrowser,
  saveSession,
  dismissPopups,
};

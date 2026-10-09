const readline = require('readline');
const { saveSession, dismissPopups } = require('./browser');

const HOME = 'https://www.lazada.com.my/';
const LOGIN_URL = 'https://member.lazada.com.my/user/login';

function pressEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

function stillOnGate(url) {
  return /member\.lazada|login-signup|passport\.|\/user\/login|verify|captcha|punish|ncaptcha/i.test(url || '');
}

async function openHome(page) {
  const url = page.url();
  const onHome = /^https:\/\/www\.lazada\.com\.my\/?(?:\?|$)/.test(url);
  if (!onHome) {
    await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(1200);
  await dismissPopups(page);
}

async function readAccountName(page) {
  const account = page.locator('.lzd-nav-account, .lzd-nav-user, [class*="nav-account"]').first();
  if (await account.count()) {
    await account.hover().catch(() => {});
    await page.waitForTimeout(300);
  }

  return page.evaluate(() => {
    const header = document.querySelector('header, .lzd-header, #topActionHeader') || document.body;
    const links = header.querySelectorAll('a');
    for (const link of links) {
      const label = (link.innerText || '').trim();
      const href = link.getAttribute('href') || '';
      const box = link.getBoundingClientRect();
      if (box.top > 280 || box.height === 0) continue;
      const loginLink = /\/user\/login|passport\.lazada/i.test(href)
        || (/login/i.test(label) && label.length < 30);
      if (loginLink) return null;
    }

    const spots = document.querySelectorAll(
      '.lzd-nav-user, .account-label, [class*="account-name"], .lzd-nav-account, #myAccountTrigger'
    );
    for (const el of spots) {
      const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        if (/login|sign up|daftar|register/i.test(line)) continue;
        if (line.length > 1 && line.length < 60) {
          return line.replace(/^hi[,\s]*/i, '').trim() || line;
        }
      }
    }
    return null;
  });
}

async function showPasswordLogin(page) {
  const labels = [
    'Password Login',
    'Log in with password',
    'Login with password',
    'With password',
  ];
  for (const label of labels) {
    const tab = page.getByText(label, { exact: false }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function robotCheckVisible(page) {
  const text = page.getByText(/not a robot|check if you are a robot/i).first();
  if (await text.isVisible().catch(() => false)) return true;
  const frame = page.locator('iframe[src*="recaptcha" i], iframe[title*="recaptcha" i]').first();
  return frame.isVisible().catch(() => false);
}

async function waitOutRobotCheck(page) {
  await page.waitForTimeout(600);
  if (!(await robotCheckVisible(page))) return;
  console.log('Robot check is covering the page.');
  console.log('Tick "I\'m not a robot" in the browser. Press Enter here when that box is gone.');
  await pressEnter('> ');
}

async function clickLogin(page) {
  const submit = page.getByRole('button', { name: /^log\s*in$/i }).first();
  if (!(await submit.isVisible().catch(() => false))) return false;
  await submit.click();
  return true;
}

async function submitLogin(page) {
  const email = (process.env.LAZADA_EMAIL || '').trim();
  const password = process.env.LAZADA_PASSWORD || '';
  if (!email || !password) {
    throw new Error('Add LAZADA_EMAIL and LAZADA_PASSWORD to .env');
  }

  await showPasswordLogin(page);

  const userBox = page.locator(
    'input[name="loginName"], input[name="TPL_username"], input[type="email"], input[placeholder*="mail" i], input[placeholder*="Phone or Email" i]'
  ).first();
  await userBox.waitFor({ state: 'visible', timeout: 20000 });
  await userBox.fill(email);

  let passBox = page.locator('input[type="password"]').first();
  if (!(await passBox.isVisible().catch(() => false))) {
    const next = page.locator('button').filter({ hasText: /next|continue/i }).first();
    if (await next.isVisible().catch(() => false)) await next.click();
    passBox = page.locator('input[type="password"]').first();
    await passBox.waitFor({ state: 'visible', timeout: 15000 });
  }
  await passBox.fill(password);

  // The check usually pops up as soon as the id and password are filled.
  // Clicking LOGIN while it is open does nothing, so wait, then click.
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitOutRobotCheck(page);
    const clicked = await clickLogin(page);
    await page.waitForTimeout(2000);
    if (await robotCheckVisible(page)) continue;
    if (!clicked && !stillOnGate(page.url())) return;
    if (clicked && !stillOnGate(page.url())) return;
  }

  if (stillOnGate(page.url()) || await robotCheckVisible(page)) {
    console.log('Finish the check in the browser, then press Enter.');
    await pressEnter('> ');
    await waitOutRobotCheck(page);
    await clickLogin(page);
    await page.waitForTimeout(2000);
  }
}

async function ensureLogin(page, context) {
  await openHome(page);
  await waitOutRobotCheck(page);
  let name = await readAccountName(page);
  if (name) {
    console.log('logged in as', name);
    return name;
  }

  console.log('no saved session, opening the login page');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await dismissPopups(page);
  await submitLogin(page);

  await openHome(page);
  await waitOutRobotCheck(page);
  name = await readAccountName(page);
  if (!name) {
    console.log('Header still shows LOGIN. Finish the check in the browser, then press Enter.');
    await pressEnter('> ');
    await openHome(page);
    await waitOutRobotCheck(page);
    name = await readAccountName(page);
  }
  if (!name) {
    throw new Error('Login did not stick. The header still has no account name.');
  }

  await saveSession(context);
  console.log('logged in as', name);
  return name;
}

module.exports = { ensureLogin };

// capture-logins.mjs — log into the demo-gated apps and screenshot past the
// login, so the book previews show the real UI instead of a sign-in form.
//
// You run this (I never see your password). Setup:
//   npm i puppeteer-core
// Run (creds via env, same user/pass across apps):
//   USERNAME='you' PASSWORD='secret' node capture-logins.mjs
// Per-app overrides if they differ:
//   USERNAME_pptgpt='x' PASSWORD_pptgpt='y' ... node capture-logins.mjs
//
// Screenshots land in ./screenshots/<name>.png — then tell me and I'll redeploy.

import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

// system Chrome (no Chromium download). Adjust if yours lives elsewhere.
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find(existsSync);

const APPS = [
  { name: 'crochet',          url: 'https://ghanemja.github.io/crochet/' },
  { name: 'inbox-zero-board', url: 'https://ghanemja.github.io/inbox-zero-board/' },
  { name: 'charterscope',     url: 'https://ghanemja.github.io/charterscope/' },
  { name: 'pptgpt',           url: 'https://pptgpt.netlify.app' },
  // add brain-university / the-council here once you give me their URLs
];

const env = (k, app) => process.env[`${k}_${app}`] ?? process.env[k] ?? '';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'] });

for (const app of APPS) {
  const user = env('USERNAME', app.name), pass = env('PASSWORD', app.name);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  try {
    await page.goto(app.url, { waitUntil: 'networkidle2', timeout: 30000 });
    // fill the first text/username input and the password input, if present
    const uSel = 'input[type="text"], input[name*="user" i], input[placeholder*="user" i], input:not([type])';
    const pSel = 'input[type="password"]';
    if (user && await page.$(uSel)) { await page.click(uSel, { clickCount: 3 }); await page.type(uSel, user); }
    if (pass && await page.$(pSel)) { await page.click(pSel, { clickCount: 3 }); await page.type(pSel, pass); }
    // submit: prefer a submit button, else the first button
    const btn = await page.$('button[type="submit"]') || await page.$('button');
    if (btn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
        btn.click(),
      ]);
    }
    await new Promise(r => setTimeout(r, 3500));   // let the app render
    await page.screenshot({ path: `screenshots/${app.name}.png` });
    console.log(`✔ ${app.name} → screenshots/${app.name}.png`);
  } catch (e) {
    console.warn(`✗ ${app.name}: ${e.message}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log('done — tell me and I will redeploy with the new previews.');

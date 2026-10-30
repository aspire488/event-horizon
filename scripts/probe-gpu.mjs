// Reads the GPU renderer string from the app's REAL WebGL context (the one
// created with powerPreference high-performance), for honest benchmark labels.
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.GODMODE_URL ?? 'http://localhost:4173/';

for (const [label, extraArgs] of [
  ['default', []],
  [
    'forced-high-perf',
    [
      '--enable-features=Vulkan',
      '--use-angle=d3d11',
      '--force-gpu-mem-available-mb=4096',
    ],
  ],
]) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', ...extraArgs],
  });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GODMODE__), null, { timeout: 20000 });
  const info = await page.evaluate(() => {
    const gl = window.__GODMODE__.renderer.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: gl.getParameter(gl.VERSION),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  console.log(label, JSON.stringify(info));
  await browser.close();
}

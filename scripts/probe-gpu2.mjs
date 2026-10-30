// Extended GPU-selection probe: can headless Chrome reach the discrete GPU?
import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:4173/';
const variants = [
  ['d3d11-only', ['--use-angle=d3d11']],
  ['vulkan-angle', ['--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-angle=vulkan']],
  ['d3d11-hpc', ['--use-angle=d3d11', '--enable-features=Vulkan', '--force-gpu-mem-available-mb=4096', '--ignore-gpu-blocklist']],
  ['headed-default', []],
];
for (const [label, extra] of variants) {
  try {
    const browser = await chromium.launch({
      executablePath: CHROME,
      headless: label !== 'headed-default',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', ...extra],
    });
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__GODMODE__), null, { timeout: 20000 });
    const info = await page.evaluate(() => {
      const gl = window.__GODMODE__.renderer.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    console.log(label, '->', info);
    await browser.close();
  } catch (e) { console.log(label, 'FAILED:', e.message.split('\n')[0]); }
}

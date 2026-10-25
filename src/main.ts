import './style.css';
import { App } from './app';

const canvas = document.getElementById('universe');
const mount = document.getElementById('ui');

function fatal(message: string): void {
  if (!mount) return;
  mount.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'help-card';
  card.style.margin = '12vh auto';
  card.style.position = 'relative';
  card.style.zIndex = '80';
  const title = document.createElement('h2');
  title.textContent = 'GOD MODE COULD NOT START';
  title.style.cssText = 'font-family:monospace;letter-spacing:.2em;font-size:11px;margin:0 0 12px';
  const body = document.createElement('p');
  body.textContent = message;
  body.style.cssText = 'font-size:12px;line-height:1.6;color:#8794ac;margin:0 0 14px';
  const retry = document.createElement('button');
  retry.textContent = 'RELOAD';
  retry.className = 'ui-button primary';
  retry.addEventListener('click', () => window.location.reload());
  card.append(title, body, retry);
  mount.appendChild(card);
}

if (!canvas || !(canvas instanceof HTMLCanvasElement) || !mount) {
  fatal('The simulation canvas is missing from the page.');
} else {
  try {
    const app = new App(canvas, mount);
    app.start();
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : 'An unknown error prevented WebGL from initialising.';
    fatal(
      `${message}. GOD MODE needs WebGL2. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.`,
    );
  }
}

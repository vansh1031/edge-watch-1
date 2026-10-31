// Loading screen with the YASH logo (markup + styles in index.html).
// Shown for at least MIN_MS, then fades out when the first live data arrives.

const MIN_MS = 900;       // never just flash
const MAX_MS = 6000;      // never block the app: after this the page shows its own "backend unreachable" state

let hidden = false;
const BOOT_AT = performance.now();   // counted from app start, like the all-in-one dashboard

export function setSplashText(text: string) {
  if (hidden) return;
  const el = document.getElementById('splashSub');
  if (el) el.textContent = text;
}

export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const wait = Math.max(0, MIN_MS - (performance.now() - BOOT_AT));
  setTimeout(() => {
    document.body.classList.remove('booting');
    // Remove after the 0.6 s fade so it can't catch clicks or screen readers
    setTimeout(() => document.getElementById('splash')?.remove(), 700);
  }, wait);
}

export function startSplashTimeout() {
  setTimeout(hideSplash, MAX_MS);
}

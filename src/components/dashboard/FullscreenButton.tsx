import { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

// Full screen: hides the browser's tabs, address bar and the taskbar — only the app is visible.
// Esc (or this button) leaves full screen. The layout re-fits itself (see index.css auto-fit).
const FullscreenButton = () => {
  const [active, setActive] = useState(() => Boolean(document.fullscreenElement));
  const supported = Boolean(document.documentElement.requestFullscreen);

  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const label = active ? 'Exit full screen (Esc)' : 'Full screen';
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="grid place-items-center w-9 h-9 rounded-lg border border-border bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 active:scale-95 transition"
    >
      {active ? <Minimize size={16} /> : <Maximize size={16} />}
    </button>
  );
};

export default FullscreenButton;

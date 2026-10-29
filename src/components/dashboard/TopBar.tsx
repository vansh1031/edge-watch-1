import { useEffect, useState } from 'react';
import { Wifi, WifiOff, LayoutDashboard, Clock, FlaskConical } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

// ✅ Sahi path — tera logo yahan hai
import logo from '@/components/assets/YASH-LOGO.svg';

interface TopBarProps {
  isConnected: boolean;
  useMock: boolean;          // live data comes from the built-in simulator
}

const TopBar = ({ isConnected, useMock }: TopBarProps) => {
  const [dateTime, setDateTime] = useState(new Date());
  const location = useLocation();
  const navigate = useNavigate();
  const isDemo = location.pathname === '/demo';

  useEffect(() => {
    const timer = setInterval(() => setDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-4">

        <div className="flex items-center gap-2">
          {/* ✅ Logo image — YT text ki jagah */}
          <img
            src={logo}
            alt="Yash Technology Logo"
            className="h-8 w-auto object-contain"
          />
        </div>

        <div className="h-6 w-px bg-border" />

        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-primary glow-text">EDGE AI</span>
          <span className="text-muted-foreground font-normal ml-2 hidden md:inline">
            Predictive Maintenance Dashboard
          </span>
        </h1>

      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        {/* Normal = live machine, Demo = what-if page (never affects Normal) */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hidden lg:inline">Mode</span>
          <select
            value={isDemo ? 'demo' : 'normal'}
            onChange={e => navigate(e.target.value === 'demo' ? '/demo' : '/')}
            aria-label="Mode"
            className={`rounded-lg border px-2 py-1.5 text-xs font-semibold bg-secondary focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer ${
              isDemo ? 'border-status-warning/50 status-warning' : 'border-border text-foreground'
            }`}
          >
            <option value="normal">Normal mode</option>
            <option value="demo">Demo mode</option>
          </select>
        </label>

        {!isDemo && (
          <nav className="flex items-center gap-1 mr-2">
            <NavItem to="/"        icon={LayoutDashboard} label="Dashboard" />
            <NavItem to="/history" icon={Clock}           label="History"   />
          </nav>
        )}

        <time className="text-sm text-muted-foreground font-mono hidden sm:block">
          {dateTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {' · '}
          {dateTime.toLocaleTimeString('en-US', { hour12: false })}
        </time>

        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
          !isConnected
            ? 'bg-status-critical/15 status-critical'
            : isDemo || useMock
              ? 'bg-status-warning/15 status-warning'
              : 'bg-status-normal/15 status-normal'
        }`}>
          {!isConnected ? (
            <><WifiOff size={12} /><span>Disconnected</span></>
          ) : isDemo ? (
            <><FlaskConical size={12} /><span>What-if demo</span></>
          ) : useMock ? (
            <><Wifi size={12} /><span>Simulated data</span></>
          ) : (
            <><Wifi size={12} /><span>Connected</span></>
          )}
        </div>
      </div>
    </header>
  );
};

function NavItem({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  const location = useLocation();
  const active   = location.pathname === to;

  return (
    <Link
      to={to}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
    >
      <Icon size={13} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

export default TopBar;
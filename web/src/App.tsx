import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { configured } from './lib/supabase';
import { SonarMark } from './components/ui';
import Board from './pages/Board';
import TokenPage from './pages/Token';
import Flows from './pages/Flows';
import About from './pages/About';
import Admin from './pages/Admin';

const nav = [
  { to: '/', label: 'Board', end: true },
  { to: '/flows', label: 'Flows' },
  { to: '/about', label: 'Methodology' },
];

export default function App() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="backdrop" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-white/[0.05] bg-bg/60 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:gap-8 sm:px-6">
          <NavLink to="/" className="flex items-center gap-3">
            <SonarMark className="size-8" />
            <span className="hidden text-[17px] font-semibold tracking-[-0.03em] sm:inline">Govoo</span>
          </NavLink>
          <nav className="flex gap-0.5 sm:gap-1">
            {nav.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `relative rounded-lg px-2 py-2 text-[13px] font-medium sm:px-3 sm:text-sm transition-colors duration-200 ${
                  isActive ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
                {({ isActive }) => <>
                  {n.label}
                  {isActive && <span className="fade-in absolute inset-x-2 -bottom-[13px] sm:inset-x-3 h-px bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_12px_var(--color-accent)]" />}
                </>}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main key={loc.pathname} className="fade-in mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {!configured ? (
          <div className="card p-6 text-sm text-ink-2">
            Supabase isn't configured. Set <code className="mono">VITE_SUPABASE_URL</code> and{' '}
            <code className="mono">VITE_SUPABASE_ANON_KEY</code> in <code className="mono">web/.env.local</code>.
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/token/:address" element={<TokenPage />} />
            <Route path="/flows" element={<Flows />} />
            <Route path="/about" element={<About />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<div className="py-24 text-center text-ink-3">Page not found.</div>} />
          </Routes>
        )}
      </main>
      <footer className="border-t border-white/[0.05]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-ink-3 sm:px-6">
          <span className="flex items-center gap-2.5"><SonarMark className="size-5" /> Govoo · Smart money flows on Arc</span>
          <span>Refreshes every 5 minutes · Not financial advice</span>
        </div>
      </footer>
    </div>
  );
}

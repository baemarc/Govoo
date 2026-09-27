import { NavLink, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase';
import Board from './pages/Board';
import TokenPage from './pages/Token';
import Flows from './pages/Flows';
import About from './pages/About';
import Admin from './pages/Admin';

const nav = [
  { to: '/', label: 'Board', end: true },
  { to: '/flows', label: 'Flows' },
  { to: '/about', label: 'About' },
];

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="size-6" />
            Sonarc
          </NavLink>
          <nav className="flex gap-1 text-sm">
            {nav.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `rounded px-2.5 py-1.5 ${isActive ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto hidden text-xs text-ink-3 sm:block">Smart money flow on Arc</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6">
        {!configured ? (
          <div className="rounded-lg border border-down/40 bg-surface p-6 text-sm text-ink-2">
            Supabase isn't configured. Set <code className="num">VITE_SUPABASE_URL</code> and{' '}
            <code className="num">VITE_SUPABASE_ANON_KEY</code> in <code className="num">web/.env.local</code>.
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/token/:address" element={<TokenPage />} />
            <Route path="/flows" element={<Flows />} />
            <Route path="/about" element={<About />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<div className="py-20 text-center text-ink-3">Page not found.</div>} />
          </Routes>
        )}
      </main>
      <footer className="mx-auto max-w-[1440px] px-4 pb-8 text-xs text-ink-3">
        Data refreshes every 5 minutes · Arc mainnet · Not financial advice
      </footer>
    </div>
  );
}

import { NavLink, Outlet } from 'react-router';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useCurrentUser } from '../context/AuthContext';

const navItems = [
  { to: '/', label: 'Graph', end: true },
  { to: '/next', label: 'Next', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export default function Layout() {
  const user = useCurrentUser();

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-bold text-violet-700">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            Hyphast
          </NavLink>
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">{user.displayName ?? user.email}</span>
            <button className="text-slate-600 hover:text-slate-900" onClick={() => signOut(auth)}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

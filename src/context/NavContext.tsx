import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Page = 'dashboard' | 'inventory' | 'movements' | 'contracts' | 'customers' | 'locations' | 'suppliers' | 'parts' | 'users';
export const PAGES: Page[] = ['dashboard', 'inventory', 'movements', 'contracts', 'customers', 'locations', 'suppliers', 'parts', 'users'];

type Params = Record<string, string>;

interface NavValue {
  page: Page;
  /** Filter / konteks halaman, tersimpan di URL supaya refresh & tombol back tetap di tempat yang sama. */
  params: Params;
  go: (page: Page, params?: Params) => void;
  /** Buka menu Pergerakan dengan unit yang sudah dipilih dari halaman lain. */
  startMovement: (assetIds: string[], type?: string) => void;
  movementSeed: { assetIds: string[]; type?: string } | null;
  clearMovementSeed: () => void;
}

const NavContext = createContext<NavValue | null>(null);

export function useNav(): NavValue {
  const value = useContext(NavContext);
  if (!value) throw new Error('useNav harus dipakai di dalam <NavProvider>');
  return value;
}

function parseHash(): { page: Page; params: Params } {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const page = (PAGES as string[]).includes(path) ? (path as Page) : 'dashboard';
  return { page, params: Object.fromEntries(new URLSearchParams(query)) };
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState(parseHash);
  const [movementSeed, setMovementSeed] = useState<NavValue['movementSeed']>(null);

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const go = useCallback((page: Page, params: Params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const query = new URLSearchParams(clean).toString();
    window.location.hash = `/${page}${query ? `?${query}` : ''}`;
  }, []);

  const startMovement = useCallback((assetIds: string[], type?: string) => {
    setMovementSeed({ assetIds, type });
    go('movements');
  }, [go]);

  const clearMovementSeed = useCallback(() => setMovementSeed(null), []);

  const value = useMemo(
    () => ({ ...route, go, startMovement, movementSeed, clearMovementSeed }),
    [route, go, startMovement, movementSeed, clearMovementSeed],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

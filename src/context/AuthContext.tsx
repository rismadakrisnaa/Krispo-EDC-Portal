import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, setActorName } from '../lib/firebase';
import { BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME, can, usernameFromEmail, type Permission } from '../lib/constants';
import type { UserProfile } from '../lib/types';

/**
 * loading      : sedang memeriksa sesi
 * signed-out   : belum login
 * no-access    : login berhasil, tapi akun belum punya profil (bukan dibuat Admin)
 * inactive     : akun dinonaktifkan Admin
 * ready        : punya profil aktif
 */
type AuthState = 'loading' | 'signed-out' | 'no-access' | 'inactive' | 'ready' | 'error';

interface AuthValue {
  state: AuthState;
  user: User | null;
  profile: UserProfile | null;
  role: string | null;
  can: (permission: Permission) => boolean;
  /** Kode error teknis terakhir (untuk ditampilkan saat state = 'error'). */
  errorCode: string | null;
}

const AuthContext = createContext<AuthValue>({ state: 'loading', user: null, profile: null, role: null, can: () => false, errorCode: null });
export const useAuth = () => useContext(AuthContext);

/**
 * Profil untuk admin pertama. Akun user lain dibuat oleh Admin lengkap dengan profilnya,
 * jadi hanya bootstrap admin yang membuat profilnya sendiri. Role tidak pernah
 * ditentukan client: rules hanya menerima role 'Admin' untuk username bootstrap.
 */
async function claimBootstrapProfile(user: User): Promise<boolean> {
  const email = (user.email || '').toLowerCase();
  if (email !== BOOTSTRAP_ADMIN_EMAIL) return false;
  await setDoc(doc(db, 'users', user.uid), {
    email,
    username: BOOTSTRAP_ADMIN_USERNAME,
    displayName: 'Administrator',
    role: 'Admin',
    status: 'Active',
    mustChangePassword: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [state, setState] = useState<AuthState>('loading');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const fail = (step: string, error: unknown) => {
    console.error(`Gagal ${step}`, error);
    setErrorCode(`${step}: ${(error as any)?.code || (error as any)?.message || 'unknown'}`);
    setState('error');
  };

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, async current => {
      unsubProfile?.();
      unsubProfile = undefined;
      setUser(current);
      setProfile(null);
      setActorName('');
      setErrorCode(null);

      if (!current) {
        setState('signed-out');
        return;
      }
      setState('loading');

      try {
        const profileRef = doc(db, 'users', current.uid);
        const existing = await getDoc(profileRef);
        if (!existing.exists() && !(await claimBootstrapProfile(current))) {
          setState('no-access');
          return;
        }

        // Listener live: perubahan role / status oleh Admin langsung berlaku tanpa login ulang.
        unsubProfile = onSnapshot(
          profileRef,
          snap => {
            if (!snap.exists()) {
              setProfile(null);
              setState('no-access');
              return;
            }
            const data = { id: snap.id, ...snap.data() } as UserProfile;
            setActorName(data.displayName || data.username || usernameFromEmail(data.email));
            setProfile(data);
            setState(data.status === 'Inactive' ? 'inactive' : 'ready');
          },
          error => fail('memuat profil', error),
        );
      } catch (error) {
        fail('memeriksa akses', error);
      }
    });

    return () => {
      unsubProfile?.();
      unsubAuth();
    };
  }, []);

  const role = state === 'ready' ? profile?.role || null : null;

  return (
    <AuthContext.Provider value={{ state, user, profile, role, can: permission => can(role, permission), errorCode }}>
      {children}
    </AuthContext.Provider>
  );
}

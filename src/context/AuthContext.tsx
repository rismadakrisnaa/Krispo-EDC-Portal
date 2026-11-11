import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { BOOTSTRAP_ADMIN_EMAIL, can, type Permission } from '../lib/constants';
import type { UserProfile } from '../lib/types';

/**
 * loading      : sedang memeriksa sesi
 * signed-out   : belum login
 * no-access    : login Google berhasil, tapi belum diundang Admin
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
}

const AuthContext = createContext<AuthValue>({ state: 'loading', user: null, profile: null, role: null, can: () => false });
export const useAuth = () => useContext(AuthContext);

/**
 * Buat profil saat login pertama. Role TIDAK ditentukan client:
 * rules hanya menerima role dari undangan Admin (atau 'Admin' untuk bootstrap admin).
 */
async function claimProfile(user: User): Promise<boolean> {
  const email = (user.email || '').toLowerCase();
  if (!email) return false;

  const base = {
    email,
    displayName: user.displayName || email.split('@')[0],
    status: 'Active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  const profileRef = doc(db, 'users', user.uid);

  if (email === BOOTSTRAP_ADMIN_EMAIL) {
    batch.set(profileRef, { ...base, role: 'Admin' });
    await batch.commit();
    return true;
  }

  const inviteRef = doc(db, 'invites', email);
  const invite = await getDoc(inviteRef);
  if (!invite.exists()) return false;

  batch.set(profileRef, { ...base, displayName: user.displayName || invite.data().displayName || base.displayName, role: invite.data().role });
  batch.delete(inviteRef);
  await batch.commit();
  return true;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [state, setState] = useState<AuthState>('loading');

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, async current => {
      unsubProfile?.();
      unsubProfile = undefined;
      setUser(current);
      setProfile(null);

      if (!current) {
        setState('signed-out');
        return;
      }
      setState('loading');

      try {
        const profileRef = doc(db, 'users', current.uid);
        const existing = await getDoc(profileRef);
        if (!existing.exists() && !(await claimProfile(current))) {
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
            setProfile(data);
            setState(data.status === 'Inactive' ? 'inactive' : 'ready');
          },
          error => {
            console.error('Gagal memuat profil', error);
            setState('error');
          },
        );
      } catch (error) {
        console.error('Gagal memeriksa akses', error);
        setState('error');
      }
    });

    return () => {
      unsubProfile?.();
      unsubAuth();
    };
  }, []);

  const role = state === 'ready' ? profile?.role || null : null;

  return (
    <AuthContext.Provider value={{ state, user, profile, role, can: permission => can(role, permission) }}>
      {children}
    </AuthContext.Provider>
  );
}

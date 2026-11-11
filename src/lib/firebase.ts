import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut,
  connectAuthEmulator,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * Mode emulator untuk development lokal (`npm run dev:emulator`).
 * Hanya aktif di dev build, tidak pernah ikut ke production bundle.
 */
export const USE_EMULATORS = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  // Login cepat tanpa popup, khusus emulator: window.__devSignIn('nama@contoh.com')
  (window as any).__devSignIn = (email: string, name = email.split('@')[0]) =>
    signInWithCredential(
      auth,
      GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name })),
    );
}

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

/** Pesan error yang bisa dibaca user dari error Firestore / Auth. */
export function describeError(error: unknown): string {
  const code = (error as any)?.code as string | undefined;
  if (code === 'permission-denied') return 'Akses ditolak. Role Anda tidak punya izin untuk aksi ini.';
  if (code === 'unavailable') return 'Koneksi ke server terputus. Coba lagi.';
  if (code === 'failed-precondition') return 'Data berubah saat diproses. Muat ulang lalu coba lagi.';
  return error instanceof Error ? error.message : 'Terjadi kesalahan tak terduga.';
}

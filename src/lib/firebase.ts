import { deleteApp, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type Auth,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { loginEmailFor, usernameFromEmail } from './constants';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

/**
 * Mode emulator untuk development lokal (`npm run dev:emulator`).
 * Hanya aktif di dev build, tidak pernah ikut ke production bundle.
 */
export const USE_EMULATORS = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

const useAuthEmulator = (target: Auth) => connectAuthEmulator(target, 'http://127.0.0.1:9099', { disableWarnings: true });

if (USE_EMULATORS) {
  useAuthEmulator(auth);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/**
 * Nama user yang sedang login untuk dicatat di log & Berita Acara.
 * Diambil dari profil Firestore (diset AuthContext), bukan dari akun Firebase Auth,
 * karena akun username + password tidak punya nama tampilan.
 */
let actorDisplayName = '';
export const setActorName = (name: string) => { actorDisplayName = name; };
export const actorName = () =>
  actorDisplayName || auth.currentUser?.displayName || usernameFromEmail(auth.currentUser?.email) || 'User';

export const signInWithUsername = (username: string, password: string) =>
  signInWithEmailAndPassword(auth, loginEmailFor(username), password);

export const logout = () => signOut(auth);

/** Daftarkan akun login untuk diri sendiri (dipakai sekali untuk setup admin pertama). */
export const registerOwnAccount = (username: string, password: string) =>
  createUserWithEmailAndPassword(auth, loginEmailFor(username), password);

/**
 * Buat akun login untuk user LAIN tanpa mengganggu sesi Admin yang sedang login.
 * Firebase client SDK otomatis login sebagai akun yang baru dibuat, jadi pembuatan
 * dilakukan di instance Firebase terpisah yang langsung dibuang. Mengembalikan UID baru.
 */
export async function createLoginAccount(username: string, password: string): Promise<string> {
  const secondary = initializeApp(firebaseConfig, `create-user-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  if (USE_EMULATORS) useAuthEmulator(secondaryAuth);
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, loginEmailFor(username), password);
    return credential.user.uid;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondary).catch(() => {});
  }
}

/** Ganti password akun yang sedang login. Butuh password lama untuk verifikasi ulang. */
export async function changeOwnPassword(currentPassword: string, newPassword: string) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Sesi login berakhir. Silakan login ulang.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, newPassword);
}

/** Pesan error yang bisa dibaca user dari error Firestore / Auth. */
export function describeError(error: unknown): string {
  const code = (error as any)?.code as string | undefined;
  switch (code) {
    case 'permission-denied': return 'Akses ditolak. Role Anda tidak punya izin untuk aksi ini.';
    case 'unavailable': return 'Koneksi ke server terputus. Coba lagi.';
    case 'failed-precondition': return 'Data berubah saat diproses. Muat ulang lalu coba lagi.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email': return 'Username atau password salah.';
    case 'auth/too-many-requests': return 'Terlalu banyak percobaan gagal. Tunggu beberapa menit lalu coba lagi.';
    case 'auth/user-disabled': return 'Akun ini dinonaktifkan.';
    case 'auth/email-already-in-use': return 'Username sudah dipakai.';
    case 'auth/weak-password': return 'Password terlalu lemah.';
    case 'auth/requires-recent-login': return 'Demi keamanan, silakan logout lalu login ulang sebelum mengganti password.';
    case 'auth/operation-not-allowed': return 'Login username + password belum diaktifkan. Admin perlu mengaktifkan provider "Email/Password" di Firebase Console > Authentication > Sign-in method.';
    case 'auth/network-request-failed': return 'Koneksi internet bermasalah. Coba lagi.';
  }
  return error instanceof Error ? error.message : 'Terjadi kesalahan tak terduga.';
}

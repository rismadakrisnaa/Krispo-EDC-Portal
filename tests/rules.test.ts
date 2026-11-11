/**
 * Test security rules terhadap Firestore emulator.
 * Jalankan: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;

const asUser = (uid: string, email: string, verified = true) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).firestore();

const asset = (extra: Record<string, unknown> = {}) => ({ sn: 'SN-1', assetType: 'perangkat', status: 'Available in Warehouse', ...extra });
const movement = (uid: string, extra: Record<string, unknown> = {}) => ({
  edcId: 'e1', type: 'Install', userId: uid, timestamp: serverTimestamp(), ...extra,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cim-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const profile = (email: string, role: string, status = 'Active') => ({ email, role, status });
    await setDoc(doc(db, 'users/admin'), profile('admin@x.co', 'Admin'));
    await setDoc(doc(db, 'users/ops'), profile('ops@x.co', 'Operations'));
    await setDoc(doc(db, 'users/wh'), profile('wh@x.co', 'Warehouse'));
    await setDoc(doc(db, 'users/svc'), profile('svc@x.co', 'Service'));
    await setDoc(doc(db, 'users/am'), profile('am@x.co', 'Account Manager'));
    await setDoc(doc(db, 'users/mgmt'), profile('mgmt@x.co', 'Management'));
    await setDoc(doc(db, 'users/off'), profile('off@x.co', 'Operations', 'Inactive'));
    // profil lama tanpa field status tetap dianggap aktif
    await setDoc(doc(db, 'users/legacy'), { email: 'legacy@x.co', role: 'Operations' });
    await setDoc(doc(db, 'invites/baru@x.co'), { email: 'baru@x.co', role: 'Warehouse' });
    await setDoc(doc(db, 'edcs/e1'), asset());
    await setDoc(doc(db, 'customers/c1'), { name: 'PT A', email: 'a@a.co', value: 1000 });
    await setDoc(doc(db, 'edc_parts/p1'), { name: 'Charger', price: 50000 });
    await setDoc(doc(db, 'locations/l1'), { name: 'Gudang', type: 'Warehouse' });
    await setDoc(doc(db, 'movements/m1'), { edcId: 'e1', type: 'Install', userId: 'ops' });
  });
});

describe('akses dasar', () => {
  it('tanpa login: semua ditolak', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'edcs/e1')));
    await assertFails(getDocs(collection(db, 'customers')));
  });

  it('akun Google yang tidak terdaftar: tidak bisa baca / tulis apa pun', async () => {
    const db = asUser('stranger', 'orang@luar.com');
    await assertFails(getDoc(doc(db, 'edcs/e1')));
    await assertFails(getDocs(collection(db, 'movements')));
    await assertFails(setDoc(doc(db, 'edcs/x'), asset()));
    await assertFails(setDoc(doc(db, 'movements/x'), movement('stranger')));
  });

  it('user nonaktif: ditolak', async () => {
    const db = asUser('off', 'off@x.co');
    await assertFails(getDoc(doc(db, 'edcs/e1')));
    await assertFails(updateDoc(doc(db, 'edcs/e1'), { vendor: 'X' }));
  });

  it('profil lama tanpa status tetap aktif', async () => {
    const db = asUser('legacy', 'legacy@x.co');
    await assertSucceeds(getDoc(doc(db, 'edcs/e1')));
    await assertSucceeds(updateDoc(doc(db, 'edcs/e1'), { vendor: 'X' }));
  });

  it('koleksi tak dikenal ditolak bahkan untuk admin', async () => {
    await assertFails(setDoc(doc(asUser('admin', 'admin@x.co'), 'rahasia/x'), { a: 1 }));
  });
});

describe('users & role', () => {
  it('user tidak bisa mengangkat dirinya jadi Admin saat daftar', async () => {
    const db = asUser('stranger', 'orang@luar.com');
    for (const role of ['Admin', 'Management', 'Operations', 'User']) {
      await assertFails(setDoc(doc(db, 'users/stranger'), { email: 'orang@luar.com', role, status: 'Active' }));
    }
  });

  it('user yang diundang hanya bisa klaim role sesuai undangan', async () => {
    const db = asUser('newbie', 'baru@x.co');
    await assertFails(setDoc(doc(db, 'users/newbie'), { email: 'baru@x.co', role: 'Admin', status: 'Active' }));
    await assertFails(setDoc(doc(db, 'users/newbie'), { email: 'lain@x.co', role: 'Warehouse', status: 'Active' }));
    await assertFails(setDoc(doc(db, 'users/newbie'), { email: 'baru@x.co', role: 'Warehouse', status: 'Active', isVerified: true }));
    await assertFails(setDoc(doc(db, 'users/orang-lain'), { email: 'baru@x.co', role: 'Warehouse', status: 'Active' }));

    const batch = writeBatch(db);
    batch.set(doc(db, 'users/newbie'), { email: 'baru@x.co', displayName: 'Baru', role: 'Warehouse', status: 'Active', createdAt: serverTimestamp() });
    batch.delete(doc(db, 'invites/baru@x.co'));
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(db, 'edcs/e1')));
  });

  it('email belum terverifikasi tidak bisa klaim undangan', async () => {
    const db = asUser('newbie', 'baru@x.co', false);
    await assertFails(setDoc(doc(db, 'users/newbie'), { email: 'baru@x.co', role: 'Warehouse', status: 'Active' }));
  });

  it('bootstrap admin bisa membuat profil Admin-nya sendiri, bukan role lain', async () => {
    const db = asUser('boss', 'rismadakrisnaa@gmail.com');
    await assertFails(setDoc(doc(db, 'users/boss'), { email: 'rismadakrisnaa@gmail.com', role: 'Operations', status: 'Active' }));
    await assertSucceeds(setDoc(doc(db, 'users/boss'), { email: 'rismadakrisnaa@gmail.com', role: 'Admin', status: 'Active' }));
    await assertFails(setDoc(doc(asUser('fake', 'rismadakrisnaa@gmail.com', false), 'users/fake'), { email: 'rismadakrisnaa@gmail.com', role: 'Admin', status: 'Active' }));
  });

  it('user tidak bisa menaikkan role-nya sendiri', async () => {
    const db = asUser('mgmt', 'mgmt@x.co');
    await assertFails(updateDoc(doc(db, 'users/mgmt'), { role: 'Admin' }));
    await assertFails(updateDoc(doc(db, 'users/mgmt'), { status: 'Active', role: 'Operations' }));
    await assertSucceeds(updateDoc(doc(db, 'users/mgmt'), { displayName: 'Nama Baru' }));
  });

  it('daftar user hanya untuk Admin (cegah kebocoran PII)', async () => {
    await assertFails(getDocs(collection(asUser('ops', 'ops@x.co'), 'users')));
    await assertFails(getDoc(doc(asUser('ops', 'ops@x.co'), 'users/admin')));
    await assertSucceeds(getDoc(doc(asUser('ops', 'ops@x.co'), 'users/ops')));
    await assertSucceeds(getDocs(collection(asUser('admin', 'admin@x.co'), 'users')));
  });

  it('admin mengelola user lain tapi tidak bisa mengubah / menghapus dirinya sendiri', async () => {
    const db = asUser('admin', 'admin@x.co');
    await assertSucceeds(updateDoc(doc(db, 'users/ops'), { role: 'Service', status: 'Active' }));
    await assertSucceeds(updateDoc(doc(db, 'users/ops'), { status: 'Inactive' }));
    await assertFails(updateDoc(doc(db, 'users/ops'), { role: 'Dewa', status: 'Active' }));
    await assertFails(updateDoc(doc(db, 'users/admin'), { role: 'Management', status: 'Active' }));
    await assertFails(deleteDoc(doc(db, 'users/admin')));
    await assertSucceeds(deleteDoc(doc(db, 'users/mgmt')));
  });

  it('undangan hanya dikelola Admin', async () => {
    const admin = asUser('admin', 'admin@x.co');
    await assertSucceeds(setDoc(doc(admin, 'invites/x@x.co'), { email: 'x@x.co', role: 'Service' }));
    await assertFails(setDoc(doc(admin, 'invites/X@x.co'), { email: 'X@x.co', role: 'Service' }));
    await assertFails(setDoc(doc(admin, 'invites/y@x.co'), { email: 'y@x.co', role: 'Dewa' }));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'invites/z@x.co'), { email: 'z@x.co', role: 'Admin' }));
    await assertFails(getDoc(doc(asUser('ops', 'ops@x.co'), 'invites/baru@x.co')));
    await assertFails(getDocs(collection(asUser('ops', 'ops@x.co'), 'invites')));
    await assertSucceeds(getDoc(doc(asUser('newbie', 'baru@x.co'), 'invites/baru@x.co')));
  });
});

describe('aset', () => {
  it('matriks role untuk tulis aset', async () => {
    await assertSucceeds(setDoc(doc(asUser('ops', 'ops@x.co'), 'edcs/a'), asset({ sn: 'A' })));
    await assertSucceeds(setDoc(doc(asUser('wh', 'wh@x.co'), 'edcs/b'), asset({ sn: 'B' })));
    await assertFails(setDoc(doc(asUser('svc', 'svc@x.co'), 'edcs/c'), asset({ sn: 'C' })));
    await assertFails(setDoc(doc(asUser('am', 'am@x.co'), 'edcs/d'), asset({ sn: 'D' })));
    await assertFails(setDoc(doc(asUser('mgmt', 'mgmt@x.co'), 'edcs/f'), asset({ sn: 'F' })));

    await assertSucceeds(updateDoc(doc(asUser('svc', 'svc@x.co'), 'edcs/e1'), { status: 'Under Repair' }));
    await assertFails(updateDoc(doc(asUser('mgmt', 'mgmt@x.co'), 'edcs/e1'), { status: 'Under Repair' }));
    await assertFails(updateDoc(doc(asUser('am', 'am@x.co'), 'edcs/e1'), { vendor: 'X' }));
  });

  it('validasi data aset', async () => {
    const db = asUser('ops', 'ops@x.co');
    await assertFails(setDoc(doc(db, 'edcs/x'), asset({ sn: 'x'.repeat(200) })));
    await assertFails(setDoc(doc(db, 'edcs/x'), asset({ sn: '' })));
    await assertFails(setDoc(doc(db, 'edcs/x'), asset({ status: 'Status Ngarang' })));
    await assertFails(setDoc(doc(db, 'edcs/x'), asset({ assetType: 'pesawat' })));
    await assertFails(setDoc(doc(db, 'edcs/x'), { sn: 'X', status: 'Available in Warehouse' }));
    await assertFails(updateDoc(doc(db, 'edcs/e1'), { partPenaltyAmount: -5 }));
    await assertFails(updateDoc(doc(db, 'edcs/e1'), { penaltyAmount: 'gratis' }));
    await assertFails(updateDoc(doc(db, 'edcs/e1'), { sn: 'SN-GANTI' }));
    await assertSucceeds(updateDoc(doc(db, 'edcs/e1'), { customerName: null, currentCustomerId: null, penaltyAmount: 0 }));
  });

  it('hapus aset hanya Admin', async () => {
    await assertFails(deleteDoc(doc(asUser('ops', 'ops@x.co'), 'edcs/e1')));
    await assertSucceeds(deleteDoc(doc(asUser('admin', 'admin@x.co'), 'edcs/e1')));
  });

  it('batch besar (import / pergerakan massal) tidak kena limit rules', async () => {
    const db = asUser('ops', 'ops@x.co');
    const batch = writeBatch(db);
    for (let i = 0; i < 200; i++) {
      batch.set(doc(db, `edcs/bulk${i}`), asset({ sn: `BULK-${i}` }));
      batch.set(doc(db, `movements/bulk${i}`), movement('ops', { edcId: `bulk${i}`, type: 'Initial stock (Import)' }));
    }
    await assertSucceeds(batch.commit());
  });
});

describe('master data', () => {
  it('customer', async () => {
    const c = { name: 'PT B', email: 'b@b.co', value: 100000, contractDuration: 12 };
    await assertSucceeds(setDoc(doc(asUser('am', 'am@x.co'), 'customers/a'), c));
    await assertSucceeds(setDoc(doc(asUser('ops', 'ops@x.co'), 'customers/b'), c));
    await assertFails(setDoc(doc(asUser('wh', 'wh@x.co'), 'customers/c'), c));
    await assertFails(setDoc(doc(asUser('mgmt', 'mgmt@x.co'), 'customers/d'), c));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'customers/e'), { ...c, value: -1 }));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'customers/e'), { ...c, value: '100000' }));
    await assertFails(deleteDoc(doc(asUser('am', 'am@x.co'), 'customers/c1')));
  });

  it('part: harga tidak bisa negatif / bukan angka, dan hanya role berwenang', async () => {
    await assertSucceeds(updateDoc(doc(asUser('svc', 'svc@x.co'), 'edc_parts/p1'), { price: 75000 }));
    await assertFails(updateDoc(doc(asUser('svc', 'svc@x.co'), 'edc_parts/p1'), { price: -1 }));
    await assertFails(updateDoc(doc(asUser('svc', 'svc@x.co'), 'edc_parts/p1'), { price: '0' }));
    await assertFails(updateDoc(doc(asUser('wh', 'wh@x.co'), 'edc_parts/p1'), { price: 0 }));
  });

  it('lokasi', async () => {
    await assertSucceeds(setDoc(doc(asUser('wh', 'wh@x.co'), 'locations/a'), { name: 'G2', type: 'Warehouse', address: '' }));
    await assertFails(setDoc(doc(asUser('wh', 'wh@x.co'), 'locations/b'), { name: 'G2', type: 'Kebun' }));
    await assertFails(setDoc(doc(asUser('svc', 'svc@x.co'), 'locations/c'), { name: 'G2', type: 'Warehouse' }));
  });
});

describe('log pergerakan', () => {
  it('hanya role operasional, atas nama sendiri, dengan waktu server', async () => {
    await assertSucceeds(setDoc(doc(asUser('ops', 'ops@x.co'), 'movements/a'), movement('ops')));
    await assertSucceeds(setDoc(doc(asUser('svc', 'svc@x.co'), 'movements/b'), movement('svc')));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'movements/c'), movement('admin')));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'movements/d'), movement('ops', { timestamp: new Date('2020-01-01') })));
    await assertFails(setDoc(doc(asUser('mgmt', 'mgmt@x.co'), 'movements/e'), movement('mgmt')));
    await assertFails(setDoc(doc(asUser('am', 'am@x.co'), 'movements/f'), movement('am')));
  });

  it('log tidak bisa diedit siapa pun; hapus hanya Admin', async () => {
    await assertFails(updateDoc(doc(asUser('admin', 'admin@x.co'), 'movements/m1'), { notes: 'diubah' }));
    await assertFails(updateDoc(doc(asUser('ops', 'ops@x.co'), 'movements/m1'), { notes: 'diubah' }));
    await assertFails(deleteDoc(doc(asUser('ops', 'ops@x.co'), 'movements/m1')));
    await assertSucceeds(deleteDoc(doc(asUser('admin', 'admin@x.co'), 'movements/m1')));
  });
});

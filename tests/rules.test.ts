/**
 * Test security rules terhadap Firestore emulator.
 * Jalankan: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;

const D = '@krispo-edc.local';
// Akun username/password: email internal, tidak pernah terverifikasi.
const asUser = (uid: string, email: string) => env.authenticatedContext(uid, { email, email_verified: false }).firestore();
const profile = (username: string, role: string, extra: Record<string, unknown> = {}) =>
  ({ email: username + D, username, displayName: username, role, status: 'Active', mustChangePassword: true, ...extra });

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
    const p = (email: string, role: string, status = 'Active') => ({ email, role, status });
    await setDoc(doc(db, 'users/admin'), p('admin@x.co', 'Admin'));
    await setDoc(doc(db, 'users/ops'), p('ops@x.co', 'Operations'));
    await setDoc(doc(db, 'users/wh'), p('wh@x.co', 'Warehouse'));
    await setDoc(doc(db, 'users/svc'), p('svc@x.co', 'Service'));
    await setDoc(doc(db, 'users/am'), p('am@x.co', 'Account Manager'));
    await setDoc(doc(db, 'users/mgmt'), { ...p('mgmt' + D, 'Management'), username: 'mgmt' });
    await setDoc(doc(db, 'users/off'), p('off@x.co', 'Operations', 'Inactive'));
    // profil lama tanpa field status tetap dianggap aktif
    await setDoc(doc(db, 'users/legacy'), { email: 'legacy@x.co', role: 'Operations' });
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

  it('akun login tanpa profil (mis. daftar sendiri lewat API): tidak bisa baca / tulis apa pun', async () => {
    const db = asUser('stranger', 'orang' + D);
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
  it('user tidak bisa membuat profilnya sendiri (role apa pun)', async () => {
    const db = asUser('stranger', 'orang' + D);
    for (const role of ['Admin', 'Management', 'Operations']) {
      await assertFails(setDoc(doc(db, 'users/stranger'), profile('orang', role)));
    }
  });

  it('admin pertama hanya bisa membuat profil Admin untuk dirinya sendiri', async () => {
    const db = asUser('boss', 'admin' + D);
    await assertFails(setDoc(doc(db, 'users/boss'), profile('admin', 'Operations')));
    await assertFails(setDoc(doc(db, 'users/boss'), profile('admin', 'Admin', { isVerified: true })));
    await assertSucceeds(setDoc(doc(db, 'users/boss'), profile('admin', 'Admin', { mustChangePassword: false })));
    // akun lain yang mengaku 'admin' lewat username di dokumen tetap ditolak
    await assertFails(setDoc(doc(asUser('fake', 'palsu' + D), 'users/fake'), profile('admin', 'Admin')));
  });

  it('admin membuat akun user lain, dengan validasi', async () => {
    const db = asUser('admin', 'admin@x.co');
    await assertSucceeds(setDoc(doc(db, 'users/u1'), profile('budi.s', 'Warehouse')));
    await assertFails(setDoc(doc(db, 'users/u2'), profile('budi', 'Dewa')));
    await assertFails(setDoc(doc(db, 'users/u3'), profile('Budi Besar', 'Warehouse')));
    await assertFails(setDoc(doc(db, 'users/u4'), { ...profile('budi4', 'Warehouse'), email: 'lain' + D }));
    await assertFails(setDoc(doc(db, 'users/u5'), profile('budi5', 'Warehouse', { status: 'Inactive' })));
    await assertFails(setDoc(doc(db, 'users/admin'), profile('admin2', 'Admin')));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'users/u6'), profile('budi6', 'Operations')));
  });

  it('user tidak bisa menaikkan role / mengaktifkan dirinya sendiri', async () => {
    const db = asUser('mgmt', 'mgmt' + D);
    await assertFails(updateDoc(doc(db, 'users/mgmt'), { role: 'Admin' }));
    await assertFails(updateDoc(doc(db, 'users/mgmt'), { status: 'Active', role: 'Operations' }));
    await assertFails(updateDoc(doc(db, 'users/mgmt'), { username: 'boss' }));
    await assertFails(updateDoc(doc(db, 'users/mgmt'), { mustChangePassword: true }));
    await assertSucceeds(updateDoc(doc(db, 'users/mgmt'), { displayName: 'Nama Baru', mustChangePassword: false }));
    await assertFails(updateDoc(doc(asUser('off', 'off@x.co'), 'users/off'), { status: 'Active' }));
  });

  it('daftar user hanya untuk Admin (cegah kebocoran data)', async () => {
    await assertFails(getDocs(collection(asUser('ops', 'ops@x.co'), 'users')));
    await assertFails(getDoc(doc(asUser('ops', 'ops@x.co'), 'users/admin')));
    await assertSucceeds(getDoc(doc(asUser('ops', 'ops@x.co'), 'users/ops')));
    await assertSucceeds(getDocs(collection(asUser('admin', 'admin@x.co'), 'users')));
  });

  it('admin mengelola user lain tapi tidak bisa mengubah / menghapus dirinya sendiri', async () => {
    const db = asUser('admin', 'admin@x.co');
    await assertSucceeds(updateDoc(doc(db, 'users/ops'), { role: 'Service', status: 'Active' }));
    await assertSucceeds(updateDoc(doc(db, 'users/ops'), { status: 'Inactive', displayName: 'Ops' }));
    await assertFails(updateDoc(doc(db, 'users/ops'), { role: 'Dewa', status: 'Active' }));
    await assertFails(updateDoc(doc(db, 'users/ops'), { email: 'baru@x.co' }));
    await assertFails(updateDoc(doc(db, 'users/mgmt'), { username: 'lain' }));
    await assertFails(updateDoc(doc(db, 'users/admin'), { role: 'Management', status: 'Active' }));
    await assertFails(deleteDoc(doc(db, 'users/admin')));
    await assertSucceeds(deleteDoc(doc(db, 'users/mgmt')));
  });

  it('koleksi undangan lama sudah tidak bisa diakses', async () => {
    await assertFails(setDoc(doc(asUser('admin', 'admin@x.co'), 'invites/x@x.co'), { email: 'x@x.co', role: 'Admin' }));
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

describe('pengadaan & lifecycle', () => {
  it('supplier & model: role gudang/operasional boleh, lainnya tidak; data divalidasi', async () => {
    await assertSucceeds(setDoc(doc(asUser('wh', 'wh@x.co'), 'suppliers/s1'), { name: 'PT Distributor EDC', phone: '021' }));
    await assertSucceeds(setDoc(doc(asUser('ops', 'ops@x.co'), 'device_models/m1'), { brand: 'PAX', model: 'A920', warrantyMonths: 12 }));
    await assertFails(setDoc(doc(asUser('svc', 'svc@x.co'), 'suppliers/s2'), { name: 'X' }));
    await assertFails(setDoc(doc(asUser('mgmt', 'mgmt@krispo-edc.local'), 'device_models/m2'), { brand: 'PAX', model: 'A50' }));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'suppliers/s3'), { name: '' }));
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'device_models/m3'), { brand: 'PAX', model: 'A50', warrantyMonths: -1 }));
    await assertFails(deleteDoc(doc(asUser('ops', 'ops@x.co'), 'suppliers/s1')));
    await assertSucceeds(getDocs(collection(asUser('mgmt', 'mgmt@krispo-edc.local'), 'suppliers')));
  });

  it('status baru (siap pasang, diretur ke supplier) & data pengadaan diterima', async () => {
    const db = asUser('ops', 'ops@x.co');
    await assertSucceeds(updateDoc(doc(db, 'edcs/e1'), { status: 'Staged / Ready', tid: 'T1' }));
    await assertSucceeds(updateDoc(doc(db, 'edcs/e1'), { status: 'Returned to Supplier', purchasePrice: 2500000, poNumber: 'PO-1' }));
    await assertFails(updateDoc(doc(db, 'edcs/e1'), { purchasePrice: -1 }));
  });

  it('merchant: koordinat divalidasi', async () => {
    const db = asUser('wh', 'wh@x.co');
    const merchant = { name: 'Toko A', type: 'Merchant Site', customerId: 'c1', address: 'Jl. A', city: 'Jakarta', latitude: -6.2, longitude: 106.8 };
    await assertSucceeds(setDoc(doc(db, 'locations/m1'), merchant));
    await assertSucceeds(setDoc(doc(db, 'locations/m2'), { ...merchant, latitude: null, longitude: null }));
    await assertFails(setDoc(doc(db, 'locations/m3'), { ...merchant, latitude: 200 }));
    await assertFails(setDoc(doc(db, 'locations/m4'), { ...merchant, longitude: '106' }));
  });

  it('log pergerakan: biaya tidak boleh negatif', async () => {
    await assertFails(setDoc(doc(asUser('ops', 'ops@x.co'), 'movements/x'), movement('ops', { cost: -5 })));
    await assertSucceeds(setDoc(doc(asUser('ops', 'ops@x.co'), 'movements/y'), movement('ops', { cost: 150000, referenceNo: 'TKT-1' })));
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

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Approval, Asset, Customer, DeviceModel, Location, Part, Supplier } from '../lib/types';

/**
 * Satu sumber data untuk semua halaman.
 * Sebelumnya tiap halaman membuka listener sendiri ke koleksi yang sama, sehingga
 * (1) biaya baca Firestore berlipat tiap pindah menu dan (2) tiap halaman punya
 * salinan data & aturan normalisasi sendiri-sendiri. Sekarang listener dibuka sekali
 * selama user login dan semua menu membaca data yang sama persis.
 */
interface DataValue {
  assets: Asset[];
  customers: Customer[];
  locations: Location[];
  parts: Part[];
  suppliers: Supplier[];
  models: DeviceModel[];
  /** Pengajuan yang masih berjalan (menunggu persetujuan / menunggu eksekusi). */
  openApprovals: Approval[];
  /** Unit yang sedang terkunci oleh pengajuan: asset id -> pengajuan. */
  approvalByAsset: Map<string, Approval>;
  loading: boolean;
  error: string | null;
  assetById: Map<string, Asset>;
  customerById: Map<string, Customer>;
  locationById: Map<string, Location>;
  /** SIM / peripheral yang tertaut ke sebuah perangkat. */
  childrenOf: (deviceId: string) => Asset[];
}

const DataContext = createContext<DataValue | null>(null);

export function useData(): DataValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData harus dipakai di dalam <DataProvider>');
  return value;
}

const byName = (a: { name?: string }, b: { name?: string }) => (a.name || '').localeCompare(b.name || '');

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [rawAssets, setAssets] = useState<Asset[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [openApprovals, setOpenApprovals] = useState<Approval[]>([]);
  const [loaded, setLoaded] = useState({ assets: false, customers: false, locations: false, parts: false, suppliers: false, models: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const markLoaded = (key: keyof typeof loaded) => setLoaded(prev => (prev[key] ? prev : { ...prev, [key]: true }));
    const onError = (key: keyof typeof loaded) => (err: Error) => {
      console.error(`Gagal memuat ${String(key)}`, err);
      setError('Sebagian data gagal dimuat. Periksa koneksi atau hak akses Anda.');
      markLoaded(key);
    };

    const unsubs = [
      onSnapshot(collection(db, 'edcs'), snap => {
        // Normalisasi di satu tempat: data lama tanpa assetType dianggap perangkat.
        const list = snap.docs.map(d => {
          const data = d.data();
          return { ...data, id: d.id, sn: String(data.sn ?? ''), assetType: data.assetType || 'perangkat' } as Asset;
        });
        list.sort((a, b) => a.sn.localeCompare(b.sn, undefined, { numeric: true }));
        setAssets(list);
        markLoaded('assets');
      }, onError('assets')),
      onSnapshot(collection(db, 'customers'), snap => {
        setCustomers(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Customer).sort(byName));
        markLoaded('customers');
      }, onError('customers')),
      onSnapshot(collection(db, 'locations'), snap => {
        setLocations(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Location).sort(byName));
        markLoaded('locations');
      }, onError('locations')),
      onSnapshot(collection(db, 'edc_parts'), snap => {
        setParts(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Part).sort(byName));
        markLoaded('parts');
      }, onError('parts')),
      onSnapshot(collection(db, 'suppliers'), snap => {
        setSuppliers(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Supplier).sort(byName));
        markLoaded('suppliers');
      }, onError('suppliers')),
      onSnapshot(query(collection(db, 'approvals'), where('status', 'in', ['Pending', 'Approved'])), snap => {
        setOpenApprovals(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Approval)
          .sort((a, b) => (b.requestedAt?.toMillis() || 0) - (a.requestedAt?.toMillis() || 0)));
      }, err => console.error('Gagal memuat pengajuan', err)),
      onSnapshot(collection(db, 'device_models'), snap => {
        setModels(
          snap.docs.map(d => ({ ...d.data(), id: d.id }) as DeviceModel)
            .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)),
        );
        markLoaded('models');
      }, onError('models')),
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, []);

  const value = useMemo<DataValue>(() => {
    const customerById = new Map<string, Customer>(customers.map(c => [c.id, c] as [string, Customer]));
    const locationById = new Map<string, Location>(locations.map(l => [l.id, l] as [string, Location]));
    // Nama customer & lokasi di aset adalah salinan (denormalisasi). Supaya selalu sinkron
    // dengan master walau master di-rename, nama diambil ulang dari master berdasarkan ID.
    const assets = rawAssets.map(a => {
      const customerName = (a.currentCustomerId && customerById.get(a.currentCustomerId)?.name) || a.customerName;
      const locationName = (a.currentLocationId && locationById.get(a.currentLocationId)?.name) || a.locationName;
      const contractCustomerName = (a.contractCustomerId && customerById.get(a.contractCustomerId)?.name) || a.contractCustomerName;
      return customerName === a.customerName && locationName === a.locationName && contractCustomerName === a.contractCustomerName
        ? a
        : { ...a, customerName, locationName, contractCustomerName };
    });
    const assetById = new Map<string, Asset>(assets.map(a => [a.id, a] as [string, Asset]));
    const approvalByAsset = new Map<string, Approval>();
    for (const approval of openApprovals) for (const id of approval.assetIds || []) approvalByAsset.set(id, approval);
    const childMap = new Map<string, Asset[]>();
    for (const asset of assets) {
      if (!asset.parentDeviceId) continue;
      const list = childMap.get(asset.parentDeviceId);
      if (list) list.push(asset);
      else childMap.set(asset.parentDeviceId, [asset]);
    }
    return {
      assets,
      customers,
      locations,
      parts,
      suppliers,
      models,
      openApprovals,
      approvalByAsset,
      loading: !Object.values(loaded).every(Boolean),
      error,
      assetById,
      customerById,
      locationById,
      childrenOf: deviceId => childMap.get(deviceId) || [],
    };
  }, [rawAssets, customers, locations, parts, suppliers, models, openApprovals, loaded, error]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

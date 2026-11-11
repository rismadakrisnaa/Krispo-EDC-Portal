import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Asset, Customer, Location, Part } from '../lib/types';

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
  loading: boolean;
  error: string | null;
  assetById: Map<string, Asset>;
  customerById: Map<string, Customer>;
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
  const [loaded, setLoaded] = useState({ assets: false, customers: false, locations: false, parts: false });
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
      loading: !(loaded.assets && loaded.customers && loaded.locations && loaded.parts),
      error,
      assetById,
      customerById,
      childrenOf: deviceId => childMap.get(deviceId) || [],
    };
  }, [rawAssets, customers, locations, parts, loaded, error]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

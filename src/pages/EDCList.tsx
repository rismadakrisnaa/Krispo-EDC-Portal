import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, doc, setDoc, deleteDoc, writeBatch, where, limit, getDocs, updateDoc, deleteField } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { 
  Search, 
  Filter, 
  Plus, 
  MoreHorizontal, 
  Tag, 
  MapPin, 
  User,
  History,
  FileDown,
  FileCheck,
  RefreshCw,
  Scan,
  Package,
  FileUp,
  X,
  ArrowRight,
  ArrowLeftRight,
  Smartphone,
  Zap,
  Box,
  Edit2,
  Eye,
  Download,
  Trash2,
  CheckSquare,
  Square,
  Hash
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';
import { generateBAPDF, generateAssetReportPDF } from '../lib/baGenerator';

export function EDCList({ initialFilter, onNavigate }: { initialFilter: string | null, onNavigate?: (page: any, options?: any) => void }) {
  const [edcs, setEdcs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string, sn: string } | { count: number, ids: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingEdc, setEditingEdc] = useState<any>(null);
  const [selectedEdc, setSelectedEdc] = useState<any>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdcMovements, setSelectedEdcMovements] = useState<any[]>([]);
  const [activeSection, setActiveSection] = useState<'perangkat' | 'sim' | 'peripheral'>('perangkat');

  const downloadBA = (move: any) => {
    const baPdfData = {
      movementType: move.type,
      transactionDate: move.transactionDate || (move.timestamp ? format(move.timestamp.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')),
      customerName: move.customerName || 'General Merchant',
      customerAddress: '-',
      customerPIC: move.baData?.customerPIC || '-',
      devices: [{
        sn: selectedEdc.sn,
        model: selectedEdc.model,
        tid: selectedEdc.tid,
        mid: selectedEdc.mid,
        status: move.toStatus
      }],
      notes: move.notes,
      technicianName: move.baData?.technician || move.userName || 'Admin',
      generatedAt: move.baData?.generatedAt || move.timestamp?.toDate()?.toISOString() || new Date().toISOString()
    };
    
    const docPdf = generateBAPDF(baPdfData);
    docPdf.save(`BA_${move.type}_${selectedEdc.sn}.pdf`);
  };

  const downloadAssetReport = (edc: any) => {
    const reportData = {
      sn: edc.sn,
      tid: edc.tid,
      mid: edc.mid,
      vendor: edc.vendor,
      model: edc.model,
      status: edc.status,
      condition: edc.condition || 'Good',
      customerName: edc.customerName || '(Warehouse)',
      customerAddress: '-', // Can be expanded if customer data is fetched
      locationName: edc.locationName || 'Main Center',
      contractStatus: edc.contractStatus,
      contractEndDate: edc.expectedEndDate ? format(new Date(edc.expectedEndDate), 'dd MMM yyyy') : '-',
      penaltyAmount: (edc.penaltyAmount || 0) + (edc.partPenaltyAmount || 0),
      peripherals: edcs.filter(e => e.parentDeviceId === edc.id).map(p => ({
        type: p.peripheralType || (p.assetType === 'sim' ? 'SIM Card' : 'Component'),
        sn: p.sn
      })),
      generatedAt: new Date().toISOString()
    };

    const docPdf = generateAssetReportPDF(reportData);
    docPdf.save(`AssetReport_${edc.sn}.pdf`);
  };

  const downloadAllBAs = () => {
    const movesWithBA = selectedEdcMovements.filter(m => m.baGenerated);
    movesWithBA.forEach((move, index) => {
      setTimeout(() => {
        downloadBA(move);
      }, index * 800);
    });
  };
  
  const [filters, setFilters] = useState({
    status: 'All',
    vendor: 'All',
    condition: 'All',
    provider: 'All',
    simType: 'All'
  });
  
  const [newEdc, setNewEdc] = useState({
    sn: '',
    vendor: '',
    model: '',
    status: 'Available in Warehouse',
    simCardNumber: '',
    chargerIncluded: true,
    batteryIncluded: true,
    otherPeripherals: '',
    tid: '',
    mid: '',
    osVersion: '',
    condition: 'New',
    provider: '',
    simType: 'Public',
    iccid: '',
    msisdn: '',
    modemDongle: '',
    imei: '',
    assetType: 'perangkat',
    chargerSN: '',
    batterySN: '',
    peripheralType: ''
  });

  useEffect(() => {
    const q = query(collection(db, 'edcs'), orderBy('sn', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEdcs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (selectedEdc?.id && showDetailModal) {
      const q = query(
        collection(db, 'movements'),
        where('edcId', '==', selectedEdc.id),
        orderBy('timestamp', 'desc')
      );
      getDocs(q).then(s => {
        setSelectedEdcMovements(s.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    }
  }, [selectedEdc, showDetailModal]);

  const filteredEdcs = edcs.filter(edc => {
    const matchesSearch = edc.sn.toLowerCase().includes(searchTerm.toLowerCase()) ||
      edc.vendor.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesInitialFilter = !initialFilter || edc.customerId === initialFilter || edc.customerName?.toLowerCase().includes(initialFilter.toLowerCase());
    
    const isAvailable = (s: string) => s === 'Available in Warehouse' || s === 'Withdrawn';
    const matchesStatus = filters.status === 'All' || 
      (filters.status === 'Available' ? isAvailable(edc.status) : 
       filters.status === 'In Use' ? !isAvailable(edc.status) : true);
    const matchesVendor = filters.vendor === 'All' || edc.vendor === filters.vendor;
    const matchesCondition = filters.condition === 'All' || edc.condition === filters.condition;
    const matchesProvider = filters.provider === 'All' || edc.provider === filters.provider;
    const matchesSimType = filters.simType === 'All' || edc.simType === filters.simType;

    return matchesSearch && matchesInitialFilter && matchesStatus && matchesVendor && matchesCondition && matchesProvider && matchesSimType;
  });

  const finalDisplayList = filteredEdcs.filter(edc => {
    if (activeSection === 'perangkat') return !edc.assetType || edc.assetType === 'perangkat';
    return edc.assetType === activeSection;
  });

  const getStatusColor = (status: string) => {
    if (status === 'Available in Warehouse' || status === 'Withdrawn') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'Installed / Active') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (status === 'Under Repair') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-gray-50 text-gray-700 border-gray-200';
  };

  const [linkTargetSN, setLinkTargetSN] = useState('');
  const [linking, setLinking] = useState(false);

  const handleLinkAsset = async (assetId: string) => {
    if (!linkTargetSN) return;
    setLinking(true);
    try {
      // Find the device by SN
      const q = query(collection(db, 'edcs'), where('sn', '==', linkTargetSN), where('assetType', '==', 'perangkat'), limit(1));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        alert('Device dengan SN tersebut tidak ditemukan (Pastikan itu adalah tipe Perangkat).');
        return;
      }
      
      const deviceDoc = snap.docs[0];
      await updateDoc(doc(db, 'edcs', assetId), {
        parentDeviceId: deviceDoc.id,
        parentDeviceSN: linkTargetSN,
        status: deviceDoc.data().status
      });
      
      setLinkTargetSN('');
      alert('Asset berhasil ditautkan!');
    } catch (err) {
      console.error(err);
      alert('Gagal menautkan asset.');
    } finally {
      setLinking(false);
    }
  };

  const handeAddEdc = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check for duplicate SN
    const isDuplicate = edcs.some(e => e.sn.toLowerCase() === newEdc.sn.toLowerCase());
    if (isDuplicate) {
      alert('Error: Serial Number sudah terdaftar dalam sistem!');
      return;
    }

    try {
      const typeToSave = activeSection; // Use activeSection directly for auto-choose
      
      let parentDeviceId = undefined;
      let parentDeviceSN = undefined;
      let targetStatus = newEdc.status;

      // Handle Linking if provided (for SIM & PERIPHERAL)
      if ((typeToSave === 'sim' || typeToSave === 'peripheral') && newEdc.linkTargetSN) {
        const q = query(collection(db, 'edcs'), where('sn', '==', newEdc.linkTargetSN), where('assetType', '==', 'perangkat'), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          parentDeviceId = snap.docs[0].id;
          parentDeviceSN = newEdc.linkTargetSN;
          targetStatus = snap.docs[0].data().status;
        }
      }

      const assetData: any = {
        ...newEdc,
        assetType: typeToSave,
        status: targetStatus,
        updatedAt: serverTimestamp(),
      };

      if (auth.currentUser?.uid) assetData.lastUpdatedBy = auth.currentUser.uid;
      if (parentDeviceId) assetData.parentDeviceId = parentDeviceId;
      if (parentDeviceSN) assetData.parentDeviceSN = parentDeviceSN;

      const docRef = await addDoc(collection(db, 'edcs'), assetData);
      
      // LOGIC: Peripheral Check - Handle existing or create new
      if (typeToSave === 'perangkat') {
        const handlePeripheral = async (sn: string, pType: string) => {
          if (!sn) return;
          const q = query(collection(db, 'edcs'), where('sn', '==', sn), where('assetType', '==', 'peripheral'), where('peripheralType', '==', pType), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) {
            // Update existing
            await setDoc(doc(db, 'edcs', snap.docs[0].id), {
              parentDeviceId: docRef.id,
              parentDeviceSN: newEdc.sn,
              status: newEdc.status,
              updatedAt: serverTimestamp(),
              lastUpdatedBy: auth.currentUser?.uid
            }, { merge: true });
          } else {
            // Create new
            const pData: any = {
              sn: sn,
              assetType: 'peripheral',
              peripheralType: pType,
              parentDeviceId: docRef.id,
              parentDeviceSN: newEdc.sn,
              status: newEdc.status,
              vendor: newEdc.vendor,
              updatedAt: serverTimestamp(),
            };
            if (auth.currentUser?.uid) pData.lastUpdatedBy = auth.currentUser.uid;
            await addDoc(collection(db, 'edcs'), pData);
          }
        };

        await handlePeripheral(newEdc.chargerSN, 'Charger');
        await handlePeripheral(newEdc.batterySN, 'Battery');
      }

      // Log movement as audit trail
      const movementData: any = {
        edcId: docRef.id,
        type: 'Initial stock',
        toStatus: newEdc.status || 'Available in Warehouse',
        timestamp: serverTimestamp(),
      };
      if (auth.currentUser?.uid) movementData.userId = auth.currentUser.uid;
      if (auth.currentUser?.displayName) movementData.userName = auth.currentUser.displayName;

      await addDoc(collection(db, 'movements'), movementData);

      setShowAddModal(false);
      setNewEdc({ 
        sn: '', vendor: '', model: '', status: 'Available in Warehouse', 
        simCardNumber: '', chargerIncluded: true, batteryIncluded: true, 
        otherPeripherals: '', tid: '', mid: '', osVersion: '', condition: 'New',
        provider: '', simType: 'Public', iccid: '', msisdn: '', modemDongle: '', imei: '',
        assetType: 'perangkat', chargerSN: '', batterySN: '', peripheralType: '', linkTargetSN: ''
      });
    } catch (error) {
      console.error(error);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);

        let importedCount = 0;
        let linkedCount = 0;
        let duplicateCount = 0;
        
        let batch = writeBatch(db);
        let batchCount = 0;
        const commitBatch = async () => {
          if (batchCount > 0) {
            await batch.commit();
            batch = writeBatch(db);
            batchCount = 0;
          }
        };

        const processedSNs = new Set();
        const existingSNs = new Set(edcs.map(e => e.sn.toLowerCase()));

        for (const row of data) {
          const sn = String(row['Serial Number'] || row['SN'] || row['ICCID'] || '').trim();
          if (!sn) continue;

          // Check duplicate in DB and in this import
          if (existingSNs.has(sn.toLowerCase()) || processedSNs.has(sn.toLowerCase())) {
            duplicateCount++;
            continue;
          }
          processedSNs.add(sn.toLowerCase());

          const deviceRef = doc(collection(db, 'edcs'));
          const edcData: any = {
            sn,
            assetType: activeSection,
            updatedAt: serverTimestamp(),
            lastUpdatedBy: auth.currentUser?.uid
          };

          if (activeSection === 'perangkat') {
            edcData.vendor = String(row['Merk'] || row['Vendor'] || '').trim() || 'UNKNOWN';
            edcData.model = String(row['Model'] || '').trim() || 'UNKNOWN';
            edcData.tid = String(row['TID'] || '').trim();
            edcData.mid = String(row['MID'] || '').trim();
            edcData.osVersion = String(row['OS/Version'] || row['OS Version'] || '').trim();
            edcData.condition = String(row['Condition'] || 'New').trim();
            edcData.imei = String(row['IMEI'] || '').trim();
            edcData.status = String(row['Status'] || 'Available in Warehouse').trim();
          } else if (activeSection === 'sim') {
            edcData.provider = String(row['Provider'] || '').trim();
            edcData.msisdn = String(row['MSISDN'] || '').trim();
            edcData.simType = String(row['Jenis SIM'] || 'Public').trim();
            edcData.status = String(row['Status'] || 'Available in Warehouse').trim();
          } else if (activeSection === 'peripheral') {
            edcData.peripheralType = String(row['Jenis'] || '').trim();
            edcData.vendor = String(row['Merk'] || '').trim();
            edcData.model = String(row['Model'] || '').trim();
            edcData.status = String(row['Status'] || 'Available in Warehouse').trim();
          }

          batch.set(deviceRef, edcData);
          batchCount++;

          // Create initial movement log for audit trail
          const movementRef = doc(collection(db, 'movements'));
          batch.set(movementRef, {
            edcId: deviceRef.id,
            type: 'Initial stock (Import)',
            toStatus: edcData.status,
            timestamp: serverTimestamp(),
            userId: auth.currentUser?.uid,
            userName: auth.currentUser?.displayName || 'System'
          });
          batchCount++;

          importedCount++;

          // Handle Perangkat peripherals
          if (activeSection === 'perangkat') {
            const chargerSN = String(row['SN Charger'] || '').trim();
            const batterySN = String(row['SN Battery'] || '').trim();
            
            if (chargerSN && !existingSNs.has(chargerSN.toLowerCase()) && !processedSNs.has(chargerSN.toLowerCase())) {
              processedSNs.add(chargerSN.toLowerCase());
              const pRef = doc(collection(db, 'edcs'));
              batch.set(pRef, {
                sn: chargerSN,
                assetType: 'peripheral',
                peripheralType: 'Charger',
                parentDeviceId: deviceRef.id,
                parentDeviceSN: sn,
                status: edcData.status,
                vendor: edcData.vendor,
                updatedAt: serverTimestamp(),
                lastUpdatedBy: auth.currentUser?.uid
              });
              batchCount++;
              linkedCount++;
            }
            if (batterySN && !existingSNs.has(batterySN.toLowerCase()) && !processedSNs.has(batterySN.toLowerCase())) {
              processedSNs.add(batterySN.toLowerCase());
              const pRef = doc(collection(db, 'edcs'));
              batch.set(pRef, {
                sn: batterySN,
                assetType: 'peripheral',
                peripheralType: 'Battery',
                parentDeviceId: deviceRef.id,
                parentDeviceSN: sn,
                status: edcData.status,
                vendor: edcData.vendor,
                updatedAt: serverTimestamp(),
                lastUpdatedBy: auth.currentUser?.uid
              });
              batchCount++;
              linkedCount++;
            }
          }

          // Check if batch is full (Firestore limit is 500, we use 400 for safety)
          if (batchCount >= 400) {
            await commitBatch();
          }
        }

        await commitBatch();

        setShowImportModal(false);
        alert(`Import Berhasil!\nUtama: ${importedCount}\nPeripheral Linked: ${linkedCount}\nDuplikat Dilewati: ${duplicateCount}`);
      } catch (err) {
        console.error('Error importing excel:', err);
        alert('Format file tidak didukung atau terjadi kesalahan.');
      } finally {
        setImportLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    let templateData: any[] = [];
    if (activeSection === 'perangkat') {
      templateData = [{
        'Serial Number': 'SN-DEVICE-001',
        'Merk': 'INGENICO',
        'Model': 'MOVE5000',
        'TID': 'TID001',
        'MID': 'MID001',
        'OS/Version': 'v1.0',
        'Condition': 'New',
        'IMEI': '35...',
        'Status': 'Available in Warehouse',
        'SN Charger': 'CH-SN-001',
        'SN Battery': 'BT-SN-001'
      }];
    } else if (activeSection === 'sim') {
      templateData = [{
        'ICCID': '8962...',
        'Provider': 'TELKOMSEL',
        'MSISDN': '0812...',
        'Jenis SIM': 'Public'
      }];
    } else {
      templateData = [{
        'Serial Number': 'PERIPH-001',
        'Jenis': 'Modem',
        'Merk': 'HUAWEI',
        'Model': 'E3372',
        'Status': 'Available in Warehouse'
      }];
    }

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master_Aset_Template");
    XLSX.writeFile(wb, `Template_Master_${activeSection}.xlsx`);
  };

  const handleEditEdc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEdc) return;

    try {
      const edcRef = doc(db, 'edcs', editingEdc.id);
      
      let parentDeviceId = editingEdc.parentDeviceId || undefined;
      let parentDeviceSN = editingEdc.parentDeviceSN || undefined;
      let targetStatus = editingEdc.status;

      // Handle Linking if linkTargetSN is provided and changed (for SIM & PERIPHERAL)
      if ((editingEdc.assetType === 'sim' || editingEdc.assetType === 'peripheral')) {
        if (editingEdc.linkTargetSN && editingEdc.linkTargetSN !== editingEdc.parentDeviceSN) {
          const q = query(collection(db, 'edcs'), where('sn', '==', editingEdc.linkTargetSN), where('assetType', '==', 'perangkat'), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) {
            parentDeviceId = snap.docs[0].id;
            parentDeviceSN = editingEdc.linkTargetSN;
            targetStatus = snap.docs[0].data().status;
          } else {
            alert(`Error: Perangkat dengan SN ${editingEdc.linkTargetSN} tidak ditemukan.`);
            return;
          }
        } else if (!editingEdc.linkTargetSN) {
          // If cleared, unlink
          parentDeviceId = deleteField() as any;
          parentDeviceSN = deleteField() as any;
        }
      }

      const editData: any = {
        ...editingEdc,
        updatedAt: serverTimestamp(),
        status: targetStatus
      };
      
      if (auth.currentUser?.uid) editData.lastUpdatedBy = auth.currentUser.uid;
      if (parentDeviceId !== undefined) editData.parentDeviceId = parentDeviceId;
      if (parentDeviceSN !== undefined) editData.parentDeviceSN = parentDeviceSN;

      // Remove UI-only helper fields before saving
      delete editData.linkTargetSN;
      delete editData.chargerSN;
      delete editData.batterySN;

      await setDoc(edcRef, editData, { merge: true });

      // Handle Perangkat auto-link/create peripherals in Edit (consistent with Add)
      if (editingEdc.assetType === 'perangkat') {
        const handlePeripheralEdit = async (sn: string, pType: string) => {
          if (!sn) return;
          const q = query(collection(db, 'edcs'), where('sn', '==', sn), where('assetType', '==', 'peripheral'), where('peripheralType', '==', pType), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) {
            // Link existing
            await setDoc(doc(db, 'edcs', snap.docs[0].id), {
              parentDeviceId: editingEdc.id,
              parentDeviceSN: editingEdc.sn,
              status: editingEdc.status,
              updatedAt: serverTimestamp(),
              lastUpdatedBy: auth.currentUser?.uid
            }, { merge: true });
          } else {
            // Create new if SN doesn't exist
            const pData: any = {
              sn: sn,
              assetType: 'peripheral',
              peripheralType: pType,
              parentDeviceId: editingEdc.id,
              parentDeviceSN: editingEdc.sn,
              status: editingEdc.status,
              vendor: editingEdc.vendor,
              updatedAt: serverTimestamp(),
            };
            if (auth.currentUser?.uid) pData.lastUpdatedBy = auth.currentUser.uid;
            await addDoc(collection(db, 'edcs'), pData);
          }
        };

        await handlePeripheralEdit(editingEdc.chargerSN, 'Charger');
        await handlePeripheralEdit(editingEdc.batterySN, 'Battery');
      }

      setShowEditModal(false);
      setEditingEdc(null);
    } catch (error) {
      console.error(error);
      alert('Gagal memperbarui data.');
    }
  };

  const handleDeleteSingle = (id: string, sn: string) => {
    setDeleteTarget({ id, sn });
    setShowDeleteConfirm(true);
  };

  const handleDeleteBulk = () => {
    if (selectedIds.length === 0) return;
    setDeleteTarget({ count: selectedIds.length, ids: [...selectedIds] });
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      if ('ids' in deleteTarget) {
        // Bulk delete
        const batch = writeBatch(db);
        deleteTarget.ids.forEach(id => {
          batch.delete(doc(db, 'edcs', id));
        });
        await batch.commit();
        setSelectedIds([]);
      } else {
        // Single delete
        await deleteDoc(doc(db, 'edcs', deleteTarget.id));
      }
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
      alert('Gagal menghapus data. Silakan coba lagi.');
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === finalDisplayList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(finalDisplayList.map(edc => edc.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleExportExcel = () => {
    if (finalDisplayList.length === 0) {
      alert('Tidak ada data untuk diexport.');
      return;
    }

    const exportData = finalDisplayList.map(edc => ({
      'Asset Category': edc.assetType || 'perangkat',
      'Serial Number': edc.sn,
      'Vendor': edc.vendor,
      'Model': edc.model,
      'TID': edc.tid,
      'MID': edc.mid,
      'OS Version': edc.osVersion,
      'Condition': edc.condition,
      'IMEI': edc.imei,
      'Modem Dongle': edc.modemDongle,
      'Status': edc.status,
      'Provider': edc.provider,
      'Jenis SIM': edc.simType,
      'MSISDN': edc.msisdn,
      'ICCID': edc.iccid,
      'SIM Card Number': edc.simCardNumber,
      'Charger': edc.chargerIncluded ? 'YES' : 'NO',
      'Battery': edc.batteryIncluded ? 'YES' : 'NO',
      'Peripherals / Notes': edc.otherPeripherals,
      'Customer': edc.customerName || 'Gudang',
      'Location': edc.locationName || 'Main'
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory_Export");
    
    const datestamp = format(new Date(), 'dd-MM-yyyy_HHmm');
    XLSX.writeFile(wb, `Master_Aset_Export_${datestamp}.xlsx`);
  };

  // Get unique values for filters
  const vendors = Array.from(new Set(edcs.map(e => e.vendor))).filter(Boolean);
  const providers = Array.from(new Set(edcs.map(e => e.provider))).filter(Boolean);

  const sections = [
    { id: 'perangkat', label: 'Perangkat', sub: 'EDC, Soundbox, dll', icon: Smartphone },
    { id: 'sim', label: 'SIM Card', sub: 'Data SIM Terintegrasi', icon: Zap },
    { id: 'peripheral', label: 'Peripheral', sub: 'Dongle, Modem, etc', icon: Box }
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-brand-text-main uppercase tracking-tight">Master Aset</h1>
          {initialFilter && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-bold text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded-full border border-brand-primary/20 flex items-center gap-1">
                Filter: {initialFilter.length > 20 ? initialFilter.slice(0, 20) + '...' : initialFilter}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <>
              <button 
                onClick={() => onNavigate?.('movements', { preSelectedIds: selectedIds })}
                className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-semibold hover:bg-brand-primary-dark transition-all flex items-center gap-2 shadow-lg shadow-blue-100"
              >
                <ArrowLeftRight size={16} />
                Proses Pergerakan ({selectedIds.length})
              </button>
              <button 
                onClick={handleDeleteBulk}
                className="px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-sm font-semibold hover:bg-red-100 transition-all flex items-center gap-2"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </>
          )}
          <button 
            onClick={handleExportExcel}
            className="px-4 py-2 border border-brand-border text-brand-text-main rounded-lg text-sm font-semibold hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            <Download size={16} />
            Export Excel
          </button>
          <button 
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 border border-brand-border text-brand-text-main rounded-lg text-sm font-semibold hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            <FileUp size={16} />
            Bulk Import
          </button>
          <button 
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-semibold hover:bg-brand-primary-dark transition-all flex items-center gap-2"
          >
            <Plus size={16} />
            New Device
          </button>
        </div>
      </header>

      <div className="flex bg-white rounded-xl border border-brand-border p-1 gap-1">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id as any)}
            className={cn(
              "flex-1 flex flex-col items-center py-2.5 rounded-lg transition-all border",
              activeSection === s.id 
                ? "bg-brand-primary text-white border-brand-primary shadow-lg shadow-blue-100" 
                : "bg-white text-brand-text-muted border-transparent hover:bg-gray-50"
            )}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <s.icon size={16} />
              <span className="text-[11px] font-black uppercase tracking-wider">{s.label}</span>
            </div>
            <span className={cn(
              "text-[9px] font-bold uppercase tracking-tight",
              activeSection === s.id ? "text-white opacity-60" : "text-brand-text-muted/60"
            )}>{s.sub}</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-brand-border overflow-hidden flex flex-col min-h-[500px]">
        <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between bg-white">
          <div className="font-bold text-sm text-brand-text-main uppercase tracking-wider">
            {sections.find(s => s.id === activeSection)?.label} Registry
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "px-3 py-1.5 border rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all",
                showFilters 
                  ? "bg-brand-primary text-white border-brand-primary" 
                  : "bg-white text-brand-text-muted border-brand-border hover:bg-gray-50"
              )}
            >
              <Filter size={14} />
              Filter
            </button>
             <input 
              type="text"
              placeholder={`Cari SN atau ${activeSection === 'sim' ? 'Provider' : 'Merk'}...`}
              className="px-3 py-1.5 bg-gray-50 border border-brand-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-brand-primary w-40"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-[#F8FAFC] border-b border-brand-border overflow-hidden"
            >
              <div className="p-5 grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em] px-1">Status Stok</label>
                  <select 
                    className="w-full px-3 py-2 bg-white border border-brand-border rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-brand-primary"
                    value={filters.status}
                    onChange={e => setFilters({...filters, status: e.target.value})}
                  >
                    <option value="All">Semua Unit</option>
                    <option value="Available">Tersedia (Gudang)</option>
                    <option value="In Use">Terpakai (Merchant)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em] px-1">Vendor</label>
                  <select 
                    className="w-full px-3 py-2 bg-white border border-brand-border rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-brand-primary"
                    value={filters.vendor}
                    onChange={e => setFilters({...filters, vendor: e.target.value})}
                  >
                    <option value="All">Semua Vendor</option>
                    {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em] px-1">Kondisi</label>
                  <select 
                    className="w-full px-3 py-2 bg-white border border-brand-border rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-brand-primary"
                    value={filters.condition}
                    onChange={e => setFilters({...filters, condition: e.target.value})}
                  >
                    <option value="All">Semua Kondisi</option>
                    <option>New</option>
                    <option>Refurbished</option>
                    <option>Second</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em] px-1">Provider</label>
                  <select 
                    className="w-full px-3 py-2 bg-white border border-brand-border rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-brand-primary"
                    value={filters.provider}
                    onChange={e => setFilters({...filters, provider: e.target.value})}
                  >
                    <option value="All">Semua Provider</option>
                    {providers.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-[0.2em] px-1">Jenis SIM</label>
                  <select 
                    className="w-full px-3 py-2 bg-white border border-brand-border rounded-lg text-xs font-medium outline-none focus:ring-1 focus:ring-brand-primary"
                    value={filters.simType}
                    onChange={e => setFilters({...filters, simType: e.target.value})}
                  >
                    <option value="All">Semua Jenis SIM</option>
                    <option>Public</option>
                    <option>Private</option>
                  </select>
                </div>
              </div>
              <div className="px-5 pb-4 flex justify-end">
                <button 
                  onClick={() => setFilters({ status: 'All', vendor: 'All', condition: 'All', provider: 'All', simType: 'All' })}
                  className="text-[10px] font-bold text-brand-primary uppercase hover:underline"
                >
                  Reset Filters
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC]">
                <th className="px-6 py-3 w-10 border-b border-brand-border">
                  <button onClick={toggleSelectAll} className="p-1 text-brand-text-muted hover:text-brand-primary transition-colors">
                    {selectedIds.length === finalDisplayList.length && finalDisplayList.length > 0 ? (
                      <CheckSquare size={16} className="text-brand-primary" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">S/N Data</th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">
                  {activeSection === 'sim' ? 'Provider / Detail' : activeSection === 'peripheral' ? 'Jenis / Merk' : 'Merk / Model'}
                </th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">
                   {activeSection === 'perangkat' ? 'IDS (TID/MID)' : 'Relationship'}
                </th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Pelanggan</th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Status</th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {finalDisplayList.map((edc) => (
                <tr key={edc.id} className={cn(
                  "hover:bg-gray-50 transition-colors group text-[13px]",
                  selectedIds.includes(edc.id) && "bg-blue-50/30"
                )}>
                  <td className="px-6 py-4">
                    <button onClick={() => toggleSelectOne(edc.id)} className="p-1 text-brand-text-muted hover:text-brand-primary transition-colors">
                      {selectedIds.includes(edc.id) ? (
                        <CheckSquare size={16} className="text-brand-primary" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-4 flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-brand-text-main uppercase tracking-tight">{edc.sn}</span>
                      {edc.hasBA && (
                        <div title="Has Documented BA" className="text-emerald-600 bg-emerald-50 p-0.5 rounded border border-emerald-100">
                          <FileCheck size={10} />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-brand-text-muted font-black uppercase tracking-widest">{activeSection === 'sim' ? 'ICCID' : 'S/N'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      {activeSection === 'sim' ? (
                        <>
                          <span className="text-brand-text-main font-bold uppercase tracking-tight">{edc.provider || 'NO PROVIDER'}</span>
                          <span className="text-[10px] text-brand-text-muted font-bold tracking-tighter uppercase whitespace-nowrap">MSISDN: {edc.msisdn || '-'}</span>
                        </>
                      ) : activeSection === 'peripheral' ? (
                        <>
                          <span className="text-brand-primary font-black uppercase tracking-tighter text-[11px] mb-0.5">{edc.peripheralType || 'Peripheral'}</span>
                          <span className="text-[10px] text-brand-text-main font-bold uppercase">{edc.vendor || '-'} {edc.model || ''}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-brand-text-main font-bold uppercase tracking-tight">{edc.vendor}</span>
                          <span className="text-[10px] text-brand-text-muted font-bold tracking-tighter uppercase">{edc.model}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      {activeSection === 'perangkat' ? (
                        <>
                          <span className="text-[10px] font-bold text-brand-text-muted uppercase flex items-center gap-1">
                            <Hash size={10} /> TID: <span className="text-brand-text-main">{edc.tid || '-'}</span>
                          </span>
                          <span className="text-[10px] font-bold text-brand-text-muted uppercase flex items-center gap-1">
                            <Tag size={10} /> MID: <span className="text-brand-text-main">{edc.mid || '-'}</span>
                          </span>
                        </>
                      ) : (
                         edc.parentDeviceSN ? (
                           <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded border border-indigo-100 flex items-center gap-1 w-fit">
                             <Smartphone size={10} /> {edc.parentDeviceSN}
                           </span>
                         ) : (
                           <span className="text-[10px] text-gray-400 italic">Standalone</span>
                         )
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      {edc.customerName ? (
                        <button 
                          onClick={() => onNavigate?.('customers')}
                          className="font-bold text-brand-primary hover:underline text-left uppercase tracking-tighter"
                        >
                          {edc.customerName}
                        </button>
                      ) : (
                        <span className="font-bold text-brand-text-main uppercase tracking-tighter">(Gudang)</span>
                      )}
                      <span className="text-[10px] text-brand-text-muted font-bold tracking-tighter">{edc.locationName || 'Kantor Pusat'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter border whitespace-nowrap",
                      getStatusColor(edc.status)
                    )}>
                      {edc.status === 'Available in Warehouse' || edc.status === 'Withdrawn' ? 'Tersedia' : 'Terpakai'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => {
                          setSelectedEdc(edc);
                          setShowDetailModal(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white text-[10px] font-bold uppercase rounded-lg hover:bg-brand-primary-dark transition-all"
                        title="View Details"
                      >
                        <Eye size={12} />
                        Detail
                      </button>

                      {edc.hasBA && (
                        <button 
                          onClick={async () => {
                            setSelectedEdc(edc);
                            // We need to fetch movements first to download all
                            const q = query(collection(db, 'movements'), where('edcId', '==', edc.id), where('baGenerated', '==', true));
                            const s = await getDocs(q);
                            const moves = s.docs.map(d => d.data());
                            moves.forEach((move, index) => {
                              setTimeout(() => {
                                const baPdfData = {
                                  movementType: move.type,
                                  transactionDate: move.transactionDate || (move.timestamp ? format(move.timestamp.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')),
                                  customerName: move.customerName || 'General Merchant',
                                  customerAddress: '-',
                                  customerPIC: move.baData?.customerPIC || '-',
                                  devices: [{
                                    sn: edc.sn,
                                    model: edc.model,
                                    tid: edc.tid,
                                    mid: edc.mid,
                                    status: move.toStatus
                                  }],
                                  notes: move.notes,
                                  technicianName: move.baData?.technician || move.userName || 'Admin',
                                  generatedAt: move.baData?.generatedAt || move.timestamp?.toDate()?.toISOString() || new Date().toISOString()
                                };
                                const docPdf = generateBAPDF(baPdfData);
                                docPdf.save(`BA_${move.type}_${edc.sn}.pdf`);
                              }, index * 800);
                            });
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-bold uppercase rounded-lg hover:bg-emerald-700 transition-all"
                          title="Download All BA"
                        >
                          <FileDown size={12} />
                          All BA
                        </button>
                      )}

                      <div className="h-4 w-px bg-gray-200 mx-1" />

                      <button 
                        onClick={() => downloadAssetReport(edc)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-text-main text-white text-[10px] font-bold uppercase rounded-lg hover:bg-black transition-all"
                        title="Generate Asset Report"
                      >
                        <FileDown size={12} />
                        Report
                      </button>

                      <div className="h-4 w-px bg-gray-200 mx-1" />

                      <button 
                        onClick={() => {
                          setEditingEdc({...edc, linkTargetSN: edc.parentDeviceSN || ''});
                          setShowEditModal(true);
                        }}
                        className="p-1.5 text-brand-text-muted hover:text-green-600 transition-colors bg-white border border-brand-border rounded shadow-sm"
                        title="Edit Device"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        onClick={() => handleDeleteSingle(edc.id, edc.sn)}
                        className="p-1.5 text-brand-text-muted hover:text-red-600 transition-colors bg-white border border-brand-border rounded shadow-sm"
                        title="Delete Device"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredEdcs.length === 0 && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-gray-50/50">
            <div className="text-brand-text-muted opacity-20 mb-3"><Package size={48} /></div>
            <p className="text-brand-text-muted text-sm font-medium italic">Data record not found.</p>
          </div>
        )}
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden border border-brand-border"
            >
              <div className="p-6 border-b border-brand-border bg-gray-50/50">
                <h2 className="text-xl font-bold text-brand-text-main">Register New Asset</h2>
                <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">Manual Inventory Entry</p>
              </div>
              <form onSubmit={handeAddEdc} className="px-8 py-6 space-y-6 overflow-y-auto max-h-[75vh]">
                {/* AUTO CHOSEN INDICATOR */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-brand-primary bg-brand-primary/5 px-3 py-1 rounded border border-brand-primary/10 uppercase tracking-widest flex items-center gap-2">
                    <Plus size={12} /> Add New {activeSection}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  {activeSection === 'perangkat' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Serial Number</label>
                        <input required type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.sn} onChange={e => setNewEdc({...newEdc, sn: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Merk (Vendor)</label>
                        <input required type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.vendor} onChange={e => setNewEdc({...newEdc, vendor: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Terminal ID (TID)</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.tid} onChange={e => setNewEdc({...newEdc, tid: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Merchant ID (MID)</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.mid} onChange={e => setNewEdc({...newEdc, mid: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Model</label>
                        <input required type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.model} onChange={e => setNewEdc({...newEdc, model: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">OS / Version</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.osVersion} onChange={e => setNewEdc({...newEdc, osVersion: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Condition</label>
                        <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.condition} onChange={e => setNewEdc({...newEdc, condition: e.target.value})}>
                          <option>New</option><option>Refurbished</option><option>Second</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">IMEI</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.imei} onChange={e => setNewEdc({...newEdc, imei: e.target.value})} />
                      </div>
                      <div className="col-span-2 border-t border-brand-border pt-4 mt-2">
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mb-3">Peripheral Check (Auto-Create)</p>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-brand-text-muted uppercase px-1 text-emerald-600">S/N Charger</label>
                            <input 
                              type="text" 
                              list="charger-sn-list"
                              className="w-full px-4 py-2 bg-emerald-50/30 border border-emerald-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-emerald-400 placeholder:text-emerald-300" 
                              placeholder="Input SN Charger" 
                              value={newEdc.chargerSN} 
                              onChange={e => setNewEdc({...newEdc, chargerSN: e.target.value})} 
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-brand-text-muted uppercase px-1 text-purple-600">S/N Battery</label>
                            <input 
                              type="text" 
                              list="battery-sn-list"
                              className="w-full px-4 py-2 bg-purple-50/30 border border-purple-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-purple-400 placeholder:text-purple-300" 
                              placeholder="Input SN Battery" 
                              value={newEdc.batterySN} 
                              onChange={e => setNewEdc({...newEdc, batterySN: e.target.value})} 
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {activeSection === 'sim' && (
                    <>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">ICCID (Serial Number)</label>
                        <input required type="text" className="w-full px-4 py-2.5 bg-blue-50/30 border border-blue-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-400 font-mono" value={newEdc.sn} onChange={e => setNewEdc({...newEdc, sn: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">MSISDN</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.msisdn} onChange={e => setNewEdc({...newEdc, msisdn: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Provider (SIM & Connectivity)</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.provider} placeholder="Telkomsel/XL/Indosat" onChange={e => setNewEdc({...newEdc, provider: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Jenis SIM</label>
                        <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.simType} onChange={e => setNewEdc({...newEdc, simType: e.target.value})}>
                          <option>Public</option><option>Private</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest px-1">Link to Device SN</label>
                        <input 
                          type="text" 
                          list="device-sn-list"
                          className="w-full px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-sm font-bold placeholder:font-normal outline-none focus:ring-1 focus:ring-blue-500" 
                          placeholder="Cari SN Perangkat..."
                          value={newEdc.linkTargetSN} 
                          onChange={e => setNewEdc({...newEdc, linkTargetSN: e.target.value})} 
                        />
                      </div>
                    </>
                  )}

                  {activeSection === 'peripheral' && (
                    <>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Serial Number Peripheral</label>
                        <input required type="text" className="w-full px-4 py-2.5 bg-purple-50/30 border border-purple-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-purple-400 font-mono" value={newEdc.sn} onChange={e => setNewEdc({...newEdc, sn: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Jenis Peripheral</label>
                        <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.peripheralType} onChange={e => setNewEdc({...newEdc, peripheralType: e.target.value})}>
                          <option value="">Pilih Jenis</option>
                          <option>Charger</option><option>Battery</option><option>Modem</option><option>Dongle</option><option>Lainnya</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Merk</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.vendor} onChange={e => setNewEdc({...newEdc, vendor: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Model</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={newEdc.model} onChange={e => setNewEdc({...newEdc, model: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest px-1">Link to Device SN</label>
                        <input 
                          type="text" 
                          list="device-sn-list"
                          className="w-full px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-lg text-sm font-bold placeholder:font-normal outline-none focus:ring-1 focus:ring-indigo-500" 
                          placeholder="Cari SN Perangkat..."
                          value={newEdc.linkTargetSN} 
                          onChange={e => setNewEdc({...newEdc, linkTargetSN: e.target.value})} 
                        />
                      </div>
                    </>
                  )}

                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Current Stock Status</label>
                    <select 
                      className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-black text-brand-primary outline-none focus:ring-1 focus:ring-brand-primary uppercase tracking-widest" 
                      value={newEdc.status} 
                      onChange={e => setNewEdc({...newEdc, status: e.target.value})}
                    >
                      <option>Incoming Stock</option><option>Available in Warehouse</option>
                    </select>
                  </div>
                </div>

                <div className="pt-6 flex gap-3 pb-2">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-3 text-sm font-bold text-brand-text-muted bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-brand-border"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 text-sm font-bold text-white bg-brand-primary rounded-lg hover:bg-brand-primary-dark shadow-lg shadow-blue-100 transition-all uppercase tracking-widest"
                  >
                    Register Asset
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowImportModal(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden border border-brand-border"
            >
              <div className="p-6 border-b border-brand-border bg-gray-50/50 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-brand-text-main">Bulk Import EDC</h2>
                  <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mt-1">Excel Data Processing</p>
                </div>
                <button onClick={() => setShowImportModal(false)} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div className="bg-brand-primary-light p-4 rounded-lg border border-brand-primary/20 flex items-start gap-4">
                  <div className="p-2 bg-brand-primary text-white rounded-lg shadow-sm">
                    <FileUp size={20} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] text-brand-primary font-bold uppercase tracking-wider mb-2">Excel Import Guide</p>
                    <p className="text-xs text-brand-text-main leading-relaxed">
                      Silakan gunakan file Excel (.xlsx) untuk mengimpor banyak unit sekaligus.
                    </p>
                    <button 
                      onClick={downloadTemplate}
                      className="mt-3 flex items-center gap-2 text-xs font-bold text-brand-primary hover:underline"
                    >
                      <Download size={14} />
                      Download Excel Template
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block p-8 border-2 border-dashed border-brand-border rounded-xl hover:border-brand-primary transition-colors cursor-pointer text-center group">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls" 
                      className="hidden" 
                      onChange={handleImportExcel}
                      disabled={importLoading}
                    />
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-brand-text-muted group-hover:scale-110 group-hover:bg-brand-primary-light group-hover:text-brand-primary transition-all">
                        {importLoading ? <RefreshCw className="animate-spin" size={24} /> : <FileUp size={24} />}
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-brand-text-main">
                          {importLoading ? 'Processing file...' : 'Pilih File Excel Anda'}
                        </p>
                        <p className="text-[10px] text-brand-text-muted uppercase tracking-widest">
                          Format: .XLSX or .XLS
                        </p>
                      </div>
                    </div>
                  </label>
                </div>

                <div className="pt-2">
                  <button 
                    onClick={() => setShowImportModal(false)}
                    className="w-full py-3 text-xs font-bold text-brand-text-muted uppercase tracking-[0.2em] hover:bg-gray-50 rounded-lg transition-colors border border-brand-border"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal (Aligned with Add Modal) */}
      <AnimatePresence>
        {showEditModal && editingEdc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditModal(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden border border-brand-border"
            >
              <div className="p-6 border-b border-brand-border bg-gray-50/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-brand-text-main">Edit Asset Detail</h2>
                  <p className="text-xs text-brand-text-muted font-bold uppercase tracking-widest mt-1">SN: {editingEdc.sn}</p>
                </div>
                <button onClick={() => setShowEditModal(false)} className="p-2 text-brand-text-muted hover:text-red-500 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleEditEdc} className="px-8 py-6 space-y-6 overflow-y-auto max-h-[75vh]">
                <div className="grid grid-cols-2 gap-5">
                  {editingEdc.assetType === 'perangkat' && (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Serial Number</label>
                        <input disabled type="text" className="w-full px-4 py-2.5 bg-gray-100 border border-brand-border rounded-lg text-sm font-bold opacity-60" value={editingEdc.sn} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Merk (Vendor)</label>
                        <input required type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.vendor} onChange={e => setEditingEdc({...editingEdc, vendor: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Terminal ID (TID)</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.tid} onChange={e => setEditingEdc({...editingEdc, tid: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Merchant ID (MID)</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.mid} onChange={e => setEditingEdc({...editingEdc, mid: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Model</label>
                        <input required type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.model} onChange={e => setEditingEdc({...editingEdc, model: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">OS / Version</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.osVersion} onChange={e => setEditingEdc({...editingEdc, osVersion: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Condition</label>
                        <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.condition} onChange={e => setEditingEdc({...editingEdc, condition: e.target.value})}>
                          <option>New</option><option>Refurbished</option><option>Second</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">IMEI</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.imei} onChange={e => setEditingEdc({...editingEdc, imei: e.target.value})} />
                      </div>
                      <div className="col-span-2 border-t border-brand-border pt-4 mt-2">
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mb-3">Peripheral Check (Auto-Create)</p>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-brand-text-muted uppercase px-1 text-emerald-600">S/N Charger</label>
                            <input 
                              type="text" 
                              list="charger-sn-list"
                              className="w-full px-4 py-2 bg-emerald-50/30 border border-emerald-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-emerald-400 placeholder:text-emerald-300" 
                              placeholder="Input SN Charger" 
                              value={editingEdc.chargerSN || ''} 
                              onChange={e => setEditingEdc({...editingEdc, chargerSN: e.target.value})} 
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-brand-text-muted uppercase px-1 text-purple-600">S/N Battery</label>
                            <input 
                              type="text" 
                              list="battery-sn-list"
                              className="w-full px-4 py-2 bg-purple-50/30 border border-purple-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-purple-400 placeholder:text-purple-300" 
                              placeholder="Input SN Battery" 
                              value={editingEdc.batterySN || ''} 
                              onChange={e => setEditingEdc({...editingEdc, batterySN: e.target.value})} 
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {editingEdc.assetType === 'sim' && (
                    <>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">ICCID (Serial Number)</label>
                        <input disabled type="text" className="w-full px-4 py-2.5 bg-gray-100 border border-brand-border rounded-lg text-sm font-bold opacity-60 font-mono" value={editingEdc.sn} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">MSISDN</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.msisdn} onChange={e => setEditingEdc({...editingEdc, msisdn: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Provider (SIM & Connectivity)</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.provider} placeholder="Telkomsel/XL/Indosat" onChange={e => setEditingEdc({...editingEdc, provider: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Jenis SIM</label>
                        <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.simType} onChange={e => setEditingEdc({...editingEdc, simType: e.target.value})}>
                          <option>Public</option><option>Private</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest px-1">Link to Device SN</label>
                        <input 
                          type="text" 
                          list="device-sn-list"
                          className="w-full px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-sm font-bold placeholder:font-normal outline-none focus:ring-1 focus:ring-blue-500" 
                          placeholder="Cari SN Perangkat..."
                          value={editingEdc.linkTargetSN || ''} 
                          onChange={e => setEditingEdc({...editingEdc, linkTargetSN: e.target.value})} 
                        />
                      </div>
                    </>
                  )}

                  {editingEdc.assetType === 'peripheral' && (
                    <>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Serial Number Peripheral</label>
                        <input disabled type="text" className="w-full px-4 py-2.5 bg-gray-100 border border-brand-border rounded-lg text-sm font-bold opacity-60 font-mono" value={editingEdc.sn} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Jenis Peripheral</label>
                        <select className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.peripheralType} onChange={e => setEditingEdc({...editingEdc, peripheralType: e.target.value})}>
                          <option value="">Pilih Jenis</option>
                          <option>Charger</option><option>Battery</option><option>Modem</option><option>Dongle</option><option>Lainnya</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Merk</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.vendor} onChange={e => setEditingEdc({...editingEdc, vendor: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Model</label>
                        <input type="text" className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-brand-primary" value={editingEdc.model} onChange={e => setEditingEdc({...editingEdc, model: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest px-1">Link to Device SN</label>
                        <input 
                          type="text" 
                          list="device-sn-list"
                          className="w-full px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-lg text-sm font-bold placeholder:font-normal outline-none focus:ring-1 focus:ring-indigo-500" 
                          placeholder="Cari SN Perangkat..."
                          value={editingEdc.linkTargetSN || ''} 
                          onChange={e => setEditingEdc({...editingEdc, linkTargetSN: e.target.value})} 
                        />
                      </div>
                    </>
                  )}

                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest px-1">Current Stock Status</label>
                    <select 
                      className="w-full px-4 py-2.5 bg-gray-50 border border-brand-border rounded-lg text-sm font-black text-brand-primary outline-none focus:ring-1 focus:ring-brand-primary uppercase tracking-widest"
                      value={editingEdc.status}
                      onChange={e => setEditingEdc({...editingEdc, status: e.target.value})}
                    >
                      <option>Incoming Stock</option>
                      <option>Available in Warehouse</option>
                      <option>Under Repair</option>
                      <option>Installed / Active</option>
                      <option>Withdrawn</option>
                    </select>
                  </div>
                </div>

                <div className="pt-6 flex gap-3 pb-2">
                  <button 
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 py-3 text-sm font-bold text-brand-text-muted bg-gray-50 rounded-lg border border-brand-border transition-colors hover:bg-gray-100"
                  >
                    Batal
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 text-sm font-bold text-white bg-brand-primary rounded-lg hover:bg-brand-primary-dark shadow-lg shadow-blue-100 uppercase tracking-widest transition-all"
                  >
                    Simpan Perubahan
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {showDetailModal && selectedEdc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowDetailModal(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-brand-border"
            >
              <div className="p-6 border-b border-brand-border bg-[#F8FAFC] flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-brand-primary flex items-center justify-center text-white shadow-lg shadow-blue-100">
                    <Smartphone size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-brand-text-main">{selectedEdc.sn}</h2>
                    <p className="text-xs text-brand-text-muted font-bold uppercase tracking-[0.2em]">{selectedEdc.vendor} • {selectedEdc.model}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadAssetReport(selectedEdc)}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-text-main text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-gray-100"
                  >
                    <Download size={14} />
                    Report PDF
                  </button>
                  <button onClick={() => setShowDetailModal(false)} className="p-2 text-brand-text-muted hover:text-red-500 transition-colors">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="p-8 space-y-8">
                {selectedEdc.assetType === 'perangkat' && (
                  <div className="grid grid-cols-2 gap-x-12 gap-y-8">
                    <div className="space-y-6">
                      <div>
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mb-3">Core Identity</p>
                        <div className="space-y-3">
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">Merk (Vendor)</span>
                            <span className="text-xs font-bold text-brand-text-main uppercase">{selectedEdc.vendor}</span>
                          </div>
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">Terminal ID</span>
                            <span className="text-xs font-bold text-brand-text-main">{selectedEdc.tid || '-'}</span>
                          </div>
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">Merchant ID</span>
                            <span className="text-xs font-bold text-brand-text-main">{selectedEdc.mid || '-'}</span>
                          </div>
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">OS / Version</span>
                            <span className="text-xs font-bold text-brand-text-main">{selectedEdc.osVersion || '-'}</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mb-3">Ownership & Location</p>
                        <div className="space-y-3">
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">Current Account</span>
                            <span className="text-xs font-bold text-brand-primary">{selectedEdc.customerName || '(Gudang)'}</span>
                          </div>
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">Location</span>
                            <span className="text-xs font-bold text-brand-text-main">{selectedEdc.locationName || 'Main Store / Office'}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mb-3">Hardware Status</p>
                        <div className="space-y-3">
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">Current Condition</span>
                            <span className="text-xs font-bold text-indigo-600 uppercase">{selectedEdc.condition || 'New'}</span>
                          </div>
                          <div className="flex justify-between border-b border-brand-border pb-2">
                            <span className="text-xs font-bold text-brand-text-muted uppercase">IMEI Registry</span>
                            <span className="text-xs font-bold text-brand-text-main font-mono">{selectedEdc.imei || '-'}</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mb-3">Linked Peripherals</p>
                        <div className="space-y-3">
                          {edcs.filter(e => e.parentDeviceId === selectedEdc.id).map(p => (
                            <div key={p.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-brand-border hover:border-brand-primary/30 transition-all animate-in fade-in slide-in-from-left-2">
                              <div className="flex items-center gap-2">
                                <Box size={14} className="text-brand-primary" />
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-black text-brand-text-main uppercase tracking-tighter">
                                    {p.assetType === 'sim' ? 'SIM Card' : p.peripheralType}: {p.sn}
                                  </span>
                                  <span className="text-[8px] text-brand-text-muted font-bold uppercase">
                                    {p.assetType === 'sim' 
                                      ? (p.provider || '-') 
                                      : p.vendor}
                                  </span>
                                </div>
                              </div>
                              <button 
                                onClick={async () => {
                                  if(confirm('Unlink peripheral ini?')) {
                                    await updateDoc(doc(db, 'edcs', p.id), { parentDeviceId: deleteField(), parentDeviceSN: deleteField() });
                                  }
                                }}
                                className="p-1 text-gray-400 hover:text-red-500"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          {edcs.filter(e => e.parentDeviceId === selectedEdc.id).length === 0 && (
                            <p className="text-[10px] text-brand-text-muted italic">Tidak ada peripheral tertaut.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedEdc.assetType === 'perangkat' && (
                  <div className="mt-12 pt-8 border-t border-brand-border">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.2em] mb-1">Logistik & Dokumen BA</p>
                        <h3 className="text-sm font-black text-brand-text-main uppercase">Movement History</h3>
                      </div>
                      {selectedEdcMovements.some(m => m.baGenerated) && (
                        <button 
                          onClick={downloadAllBAs}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                        >
                          <FileDown size={14} />
                          Download All BA
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {selectedEdcMovements.length > 0 ? (
                        selectedEdcMovements.map((move) => (
                          <div key={move.id} className="flex items-center justify-between p-4 bg-gray-50/50 rounded-xl border border-brand-border hover:bg-white transition-all group">
                            <div className="flex items-center gap-4">
                              <div className="w-8 h-8 rounded-lg bg-white border border-brand-border flex items-center justify-center text-brand-primary">
                                <History size={16} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-xs font-bold text-brand-text-main uppercase">{move.type}</span>
                                  <ArrowRight size={10} className="text-gray-400" />
                                  <span className="text-[10px] font-bold text-brand-primary bg-brand-primary-light px-2 py-0.5 rounded">{move.toStatus}</span>
                                </div>
                                <div className="flex items-center gap-3 text-[9px] text-brand-text-muted font-bold uppercase tracking-wider">
                                  <span>{move.timestamp ? format(move.timestamp.toDate(), 'dd MMM yyyy HH:mm') : 'PENDING'}</span>
                                  <span className="w-1 h-1 bg-gray-300 rounded-full" />
                                  <span>{move.userName || 'System'}</span>
                                </div>
                              </div>
                            </div>
                            
                            {move.baGenerated && (
                              <button 
                                onClick={() => downloadBA(move)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-emerald-200 text-emerald-600 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-50 transition-all"
                              >
                                <Download size={12} />
                                BA PDF
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 bg-gray-50/50 rounded-2xl border border-dashed border-brand-border">
                          <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest">No movement history found</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {selectedEdc.assetType === 'sim' && (
                  <div className="grid grid-cols-2 gap-x-12 gap-y-8">
                    <div className="space-y-6">
                      <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                        <p className="text-[10px] font-black text-blue-600 uppercase mb-2">SIM Identity</p>
                        <div className="space-y-2">
                          <div className="flex justify-between"><span className="text-[10px] font-bold uppercase text-blue-800/60">ICCID</span><span className="text-xs font-black text-blue-900 font-mono tracking-tighter">{selectedEdc.sn}</span></div>
                          <div className="flex justify-between"><span className="text-[10px] font-bold uppercase text-blue-800/60">MSISDN</span><span className="text-xs font-black text-blue-900">{selectedEdc.msisdn || '-'}</span></div>
                          <div className="flex justify-between"><span className="text-[10px] font-bold uppercase text-blue-800/60">Provider</span><span className="text-xs font-black text-blue-900 uppercase">{selectedEdc.provider || '-'}</span></div>
                          <div className="flex justify-between items-center pt-2 mt-2 border-t border-blue-200">
                            <span className="text-[10px] font-bold uppercase text-blue-800/60">Relationship</span>
                            {selectedEdc.parentDeviceSN ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200 uppercase">Linked: {selectedEdc.parentDeviceSN}</span>
                                <button 
                                  onClick={async () => {
                                    if(confirm('Unlink SIM ini?')) {
                                      await updateDoc(doc(db, 'edcs', selectedEdc.id), { parentDeviceId: deleteField(), parentDeviceSN: deleteField() });
                                    }
                                  }}
                                  className="p-1 text-red-400 hover:text-red-600 bg-white rounded border"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input 
                                  type="text" 
                                  placeholder="SN Perangkat..." 
                                  className="text-[10px] px-2 py-0.5 border rounded outline-none focus:ring-1 focus:ring-blue-400 w-24"
                                  value={linkTargetSN}
                                  onChange={e => setLinkTargetSN(e.target.value)}
                                />
                                <button 
                                  disabled={linking}
                                  onClick={() => handleLinkAsset(selectedEdc.id)}
                                  className="bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] font-bold hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {linking ? '...' : 'LINK'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedEdc.assetType === 'peripheral' && (
                  <div className="grid grid-cols-2 gap-x-12 gap-y-8">
                    <div className="space-y-6">
                      <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                        <p className="text-[10px] font-black text-purple-600 uppercase mb-2">Peripheral Info</p>
                        <div className="space-y-2">
                          <div className="flex justify-between"><span className="text-[10px] font-bold uppercase text-purple-800/60">Type</span><span className="text-xs font-black text-purple-900 uppercase tracking-tighter font-mono">{selectedEdc.peripheralType || '-'}</span></div>
                          <div className="flex justify-between"><span className="text-[10px] font-bold uppercase text-purple-800/60">Merk</span><span className="text-xs font-black text-purple-900 uppercase tracking-tighter">{selectedEdc.vendor || '-'}</span></div>
                          <div className="flex justify-between items-center pt-2 mt-2 border-t border-purple-200">
                            <span className="text-[10px] font-bold uppercase text-purple-800/60">Relationship</span>
                            {selectedEdc.parentDeviceSN ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200 uppercase">Linked Device: {selectedEdc.parentDeviceSN}</span>
                                <button 
                                  onClick={async () => {
                                    if(confirm('Unlink peripheral ini?')) {
                                      await updateDoc(doc(db, 'edcs', selectedEdc.id), { parentDeviceId: deleteField(), parentDeviceSN: deleteField() });
                                    }
                                  }}
                                  className="p-1 text-red-400 hover:text-red-600 bg-white rounded border"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input 
                                  type="text" 
                                  placeholder="SN Perangkat..." 
                                  className="text-[10px] px-2 py-0.5 border rounded outline-none focus:ring-1 focus:ring-purple-400 w-24"
                                  value={linkTargetSN}
                                  onChange={e => setLinkTargetSN(e.target.value)}
                                />
                                <button 
                                  disabled={linking}
                                  onClick={() => handleLinkAsset(selectedEdc.id)}
                                  className="bg-purple-600 text-white px-2 py-0.5 rounded text-[10px] font-bold hover:bg-purple-700 disabled:opacity-50"
                                >
                                  {linking ? '...' : 'LINK'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-8 py-6 bg-gray-50 flex justify-between items-center border-t border-brand-border">
                <div className="text-[10px] text-brand-text-muted font-medium">
                  Last Updated: {selectedEdc.updatedAt ? format(selectedEdc.updatedAt.toDate(), 'dd MMM yyyy HH:mm') : '-'}
                </div>
                <button 
                  onClick={() => setShowDetailModal(false)}
                  className="px-6 py-2 bg-brand-text-main text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !deleting && setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden border border-brand-border p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Konfirmasi Hapus</h3>
              <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                {deleteTarget && 'sn' in deleteTarget 
                  ? `Apakah Anda yakin ingin menghapus perangkat dengan SN: ${deleteTarget.sn}? Tindakan ini tidak dapat dibatalkan.`
                  : `Apakah Anda yakin ingin menghapus ${deleteTarget && 'count' in deleteTarget ? deleteTarget.count : ''} perangkat yang dipilih? Tindakan ini tidak dapat dibatalkan.`
                }
              </p>
              <div className="flex gap-3">
                <button 
                  disabled={deleting}
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-3 text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  Batal
                </button>
                <button 
                  disabled={deleting}
                  onClick={confirmDelete}
                  className="flex-1 py-3 text-xs font-bold text-white uppercase tracking-widest bg-red-600 rounded-xl hover:bg-red-700 shadow-lg shadow-red-100 transition-all flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    'Ya, Hapus'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Datalists for Searchable Suggestions */}
      <datalist id="device-sn-list">
        {edcs.filter(e => e.assetType === 'perangkat').map(e => (
          <option key={e.id} value={e.sn}>{e.vendor} - {e.model} ({e.status})</option>
        ))}
      </datalist>

      <datalist id="charger-sn-list">
        {edcs.filter(e => e.assetType === 'peripheral' && e.peripheralType === 'Charger').map(e => (
          <option key={e.id} value={e.sn}>{e.vendor} ({e.status})</option>
        ))}
      </datalist>

      <datalist id="battery-sn-list">
        {edcs.filter(e => e.assetType === 'peripheral' && e.peripheralType === 'Battery').map(e => (
          <option key={e.id} value={e.sn}>{e.vendor} ({e.status})</option>
        ))}
      </datalist>
    </div>
  );
}

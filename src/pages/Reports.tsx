import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Download, BarChart3, Search, Smartphone } from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { cn } from '../lib/utils';

export function Reports({ initialCustomerId }: { initialCustomerId?: string | null }) {
  const [edcs, setEdcs] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    status: 'All',
    customerId: 'All',
    condition: 'All'
  });

  useEffect(() => {
    const unsubEdcs = onSnapshot(collection(db, 'edcs'), (snapshot) => {
      setEdcs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    
    const unsubCusts = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubEdcs();
      unsubCusts();
    };
  }, []);

  useEffect(() => {
    if (initialCustomerId) {
      setFilters(prev => ({ ...prev, customerId: initialCustomerId }));
    }
  }, [initialCustomerId]);

  const filteredEdcs = edcs.filter(edc => {
    const searchLow = searchTerm.toLowerCase();
    const matchesSearch = edc.sn?.toLowerCase().includes(searchLow) ||
                         edc.customerName?.toLowerCase().includes(searchLow) ||
                         edc.tid?.toLowerCase().includes(searchLow) ||
                         edc.mid?.toLowerCase().includes(searchLow);
    
    const matchesStatus = filters.status === 'All' || edc.status === filters.status;
    
    // Improved matching: prioritize customerId, fallback to name matching if data is inconsistent
    const selectedCustomerName = filters.customerId !== 'All' ? customers.find(c => c.id === filters.customerId)?.name : null;
    const matchesCustomer = filters.customerId === 'All' || 
                           edc.customerId === filters.customerId || 
                           (selectedCustomerName && edc.customerName === selectedCustomerName);
                           
    const matchesCondition = filters.condition === 'All' || edc.condition === filters.condition;

    return matchesSearch && matchesStatus && matchesCustomer && matchesCondition;
  });

  const getPositionInfo = (status: string) => {
    let label = 'Di Gudang';
    let color = 'bg-gray-100 text-gray-700 border-gray-200';
    
    if (status === 'Installed / Active') {
      label = 'Terpasang';
      color = 'bg-blue-50 text-blue-700 border-blue-200';
    } else if (status === 'Withdrawn') {
      label = 'Ditarik (Gudang)';
      color = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (status === 'Under Repair') {
      label = 'Perbaikan';
      color = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (status === 'Lost / Missing') {
      label = 'Hilang';
      color = 'bg-red-50 text-red-700 border-red-200';
    }
    return { label, color };
  };

  const exportToExcel = () => {
    const dataToExport = filteredEdcs.map(e => {
      const pos = getPositionInfo(e.status);
      return {
        'Serial Number': e.sn,
        'Vendor': e.vendor || '-',
        'Model': e.model || '-',
        'Terminal ID (TID)': e.tid || '-',
        'Merchant ID (MID)': e.mid || '-',
        'Pelanggan': e.customerName || 'Warehouse',
        'Location': e.locationName || 'Kantor Pusat',
        'Posisi EDC': pos.label,
        'Movement Status': e.status || '-',
        'Condition': e.condition || '-',
        'OS Version': e.osVersion || '-',
        'IMEI': e.imei || '-',
        'SIM Provider': e.provider || '-',
        'SIM Type': e.simType || '-',
        'MSISDN': e.msisdn || '-',
        'ICCID': e.iccid || '-',
        'SIM Card Number': e.simCardNumber || '-',
        'Charger Included': e.chargerIncluded ? 'YES' : 'NO',
        'Battery Included': e.batteryIncluded ? 'YES' : 'NO',
        'Notes': e.otherPeripherals || '-',
        'Last Update': e.updatedAt ? format(e.updatedAt.toDate(), 'yyyy-MM-dd HH:mm:ss') : '-'
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MonitoringEDC');
    XLSX.writeFile(wb, `Monitoring_EDC_ArtaJasa_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-brand-text-main tracking-tight uppercase flex items-center gap-3">
             <BarChart3 className="text-brand-primary" />
             Monitoring EDC
          </h1>
          <p className="text-brand-text-muted text-xs font-bold uppercase tracking-widest mt-1">Laporan Detil Aset & Posisi Unit</p>
        </div>
        <div className="flex gap-2">
           <div className="relative">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" size={16} />
             <input 
               type="text"
               placeholder="Cari SN, Pelanggan, TID..."
               className="pl-10 pr-4 py-2 bg-white border border-brand-border rounded-lg text-xs font-bold outline-none focus:ring-1 focus:ring-brand-primary min-w-[300px]"
               value={searchTerm}
               onChange={e => setSearchTerm(e.target.value)}
             />
           </div>
           <button 
            onClick={exportToExcel}
            className="px-4 py-2 bg-brand-text-main text-white rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-black transition-all shadow-lg shadow-gray-200"
          >
            <Download size={16} />
            Export XLSX
          </button>
        </div>
      </header>

      <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden flex flex-col min-h-[400px]">
        <div className="px-6 py-4 border-b border-brand-border bg-[#F8FAFC]/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Status:</span>
              <select 
                className="bg-transparent text-xs font-black text-brand-text-main outline-none cursor-pointer"
                value={filters.status}
                onChange={e => setFilters({...filters, status: e.target.value})}
              >
                <option value="All">Semua Status</option>
                <option>Available in Warehouse</option>
                <option>Installed / Active</option>
                <option>Withdrawn</option>
                <option>Under Repair</option>
                <option>Lost / Missing</option>
              </select>
            </div>
            <div className="flex items-center gap-2 border-l border-brand-border pl-6">
              <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Pelanggan:</span>
              <select 
                className="bg-transparent text-xs font-black text-brand-text-main outline-none cursor-pointer max-w-[150px]"
                value={filters.customerId}
                onChange={e => setFilters({...filters, customerId: e.target.value})}
              >
                <option value="All">Semua Pelanggan</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 border-l border-brand-border pl-6">
              <span className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">Kondisi:</span>
              <select 
                className="bg-transparent text-xs font-black text-brand-text-main outline-none cursor-pointer"
                value={filters.condition}
                onChange={e => setFilters({...filters, condition: e.target.value})}
              >
                <option value="All">Semua Kondisi</option>
                <option>New</option>
                <option>Refurbished</option>
                <option>Second</option>
              </select>
            </div>
          </div>
          <div className="text-[10px] font-bold text-brand-text-muted uppercase tracking-widest">
            Showing <span className="text-brand-primary font-black">{filteredEdcs.length}</span> of <span className="font-black">{edcs.length}</span> Unit
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#F8FAFC]">
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Serial Number</th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Model / Hardware</th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Pelanggan</th>
                <th className="px-6 py-3 text-[11px] font-bold text-brand-text-muted uppercase tracking-wider border-b border-brand-border">Posisi Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {filteredEdcs.map((edc) => {
                const pos = getPositionInfo(edc.status);
                return (
                  <tr key={edc.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-6 py-4 font-bold text-brand-text-main shrink-0 whitespace-nowrap">{edc.sn}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand-primary/10 rounded-lg text-brand-primary shrink-0"><Smartphone size={16} /></div>
                        <div className="flex flex-col">
                          <span className="font-bold text-brand-text-main leading-tight whitespace-nowrap">{edc.vendor} • {edc.model}</span>
                          <span className="text-[10px] text-brand-text-muted font-bold tracking-tighter whitespace-nowrap">TID: {edc.tid || '-'} | MID: {edc.mid || '-'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-brand-text-main">{edc.customerName || '(Gudang)'}</span>
                        <span className="text-[10px] text-brand-text-muted font-bold tracking-tighter uppercase whitespace-nowrap">{edc.locationName || 'Kantor Pusat'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter border w-fit shadow-sm whitespace-nowrap",
                          pos.color
                        )}>
                          {pos.label}
                        </span>
                        <span className="text-[9px] text-brand-text-muted font-bold uppercase">{edc.condition || 'New'}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredEdcs.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center opacity-30">
                      <Smartphone size={48} className="text-brand-text-muted mb-4" />
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-text-muted">Data EDC Monitoring Tidak Ditemukan</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

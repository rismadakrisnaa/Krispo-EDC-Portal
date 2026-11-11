import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Box, CheckCircle, History, Package, ShieldCheck, Smartphone, Truck, Wrench, Zap } from 'lucide-react';
import { db } from '../lib/firebase';
import { ASSET_TYPE_LABEL, CLOSED_STATUSES, IDLE_STOCK_DAYS, PROBLEM_STATUSES, STATUS, STOCK_STATUSES, TRANSIT_STATUSES, movementLabel, statusMeta, type AssetType } from '../lib/constants';
import { contractHealth } from '../lib/contract';
import { cn, daysBetween, formatDate, formatIDR } from '../lib/utils';
import type { Movement } from '../lib/types';
import { useData } from '../context/DataContext';
import { useNav } from '../context/NavContext';
import { PageHeader, StatusBadge } from '../components/ui';

const TABS: { id: AssetType; icon: React.ElementType }[] = [
  { id: 'perangkat', icon: Smartphone },
  { id: 'sim', icon: Zap },
  { id: 'peripheral', icon: Box },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function Dashboard() {
  const { assets, assetById } = useData();
  const { go } = useNav();
  const [tab, setTab] = useState<AssetType>('perangkat');
  const [recent, setRecent] = useState<Movement[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'movements'), orderBy('timestamp', 'desc'), limit(6));
    return onSnapshot(q, snap => setRecent(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Movement)), err => console.error(err));
  }, []);

  const stats = useMemo(() => {
    // Armada aktif: unit yang sudah hilang / dihapuskan / diretur tidak dihitung.
    const list = assets.filter(a => a.assetType === tab && !CLOSED_STATUSES.includes(a.status));
    const byStatus = new Map<string, number>();
    for (const a of list) byStatus.set(a.status, (byStatus.get(a.status) || 0) + 1);
    const count = (...statuses: string[]) => statuses.reduce((sum, s) => sum + (byStatus.get(s) || 0), 0);

    // Tren registrasi 6 bulan terakhir (createdAt; data lama memakai updatedAt).
    const now = new Date();
    const trends = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { name: MONTHS[d.getMonth()], key: `${d.getFullYear()}-${d.getMonth()}`, count: 0 };
    });
    for (const a of list) {
      const d = (a.createdAt || a.updatedAt)?.toDate?.();
      const bucket = d && trends.find(t => t.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (bucket) bucket.count++;
    }

    return {
      total: list.length,
      stock: count(...STOCK_STATUSES),
      installed: count(STATUS.INSTALLED),
      transit: count(...TRANSIT_STATUSES),
      problem: count(...PROBLEM_STATUSES),
      pie: Array.from(byStatus, ([status, value]) => ({ status, name: statusMeta(status).label, value, color: statusMeta(status).chart })).sort((a, b) => b.value - a.value),
      trends,
    };
  }, [assets, tab]);

  const attention = useMemo(() => {
    const devices = assets.filter(a => a.assetType === 'perangkat');
    const contracts = devices.filter(a => a.contractStatus).map(a => ({ a, ...contractHealth(a) }));
    return {
      ending: contracts.filter(c => c.health === 'ending').length,
      penalties: devices.reduce((sum, a) => sum + (a.penaltyAmount || 0) + (a.partPenaltyAmount || 0), 0),
      penaltyUnits: devices.filter(a => (a.penaltyAmount || 0) + (a.partPenaltyAmount || 0) > 0).length,
      incoming: devices.filter(a => a.status === STATUS.INCOMING).length,
      repair: devices.filter(a => a.status === STATUS.REPAIR).length,
      damaged: devices.filter(a => a.status === STATUS.DAMAGED).length,
      idle: devices.filter(a => STOCK_STATUSES.includes(a.status) && (daysBetween(a.statusSince || a.updatedAt) ?? 0) >= IDLE_STOCK_DAYS).length,
      warrantyEnding: devices.filter(a => {
        if (!a.warrantyUntil || CLOSED_STATUSES.includes(a.status)) return false;
        const days = (new Date(a.warrantyUntil).getTime() - Date.now()) / 86_400_000;
        return days >= 0 && days <= 30;
      }).length,
    };
  }, [assets]);

  const openInventory = (status: string) => go('inventory', { section: tab, status });

  const cards = [
    { title: `${ASSET_TYPE_LABEL[tab]} Aktif`, value: stats.total, color: 'bg-brand-primary', text: 'text-brand-text-main', icon: Package, status: 'active' },
    { title: 'Stok Gudang', value: stats.stock, color: 'bg-emerald-500', text: 'text-emerald-600', icon: CheckCircle, status: 'stock' },
    { title: 'Terpasang', value: stats.installed, color: 'bg-blue-500', text: 'text-blue-600', icon: Smartphone, status: STATUS.INSTALLED },
    { title: 'Alokasi / Kirim', value: stats.transit, color: 'bg-amber-500', text: 'text-amber-600', icon: Truck, status: 'transit' },
    { title: 'Perlu Tindakan', value: stats.problem, color: 'bg-red-500', text: 'text-red-600', icon: Wrench, status: 'problem' },
  ];

  const alerts = [
    { show: attention.ending > 0, text: `${attention.ending} kontrak berakhir dalam 30 hari`, onClick: () => go('contracts', { health: 'ending' }) },
    { show: attention.penaltyUnits > 0, text: `${attention.penaltyUnits} unit punya denda tercatat, total ${formatIDR(attention.penalties)}`, onClick: () => go('contracts', { health: 'terminated' }) },
    { show: attention.incoming > 0, text: `${attention.incoming} perangkat dari supplier menunggu QC`, onClick: () => go('inventory', { section: 'perangkat', status: STATUS.INCOMING }) },
    { show: attention.idle > 0, text: `${attention.idle} perangkat menganggur di gudang ≥ ${IDLE_STOCK_DAYS} hari`, onClick: () => go('inventory', { section: 'perangkat', status: 'stock', aging: String(IDLE_STOCK_DAYS) }) },
    { show: attention.warrantyEnding > 0, text: `${attention.warrantyEnding} perangkat garansinya habis dalam 30 hari`, onClick: () => go('inventory', { section: 'perangkat', warranty: 'expiring' }) },
    { show: attention.repair > 0, text: `${attention.repair} perangkat sedang diperbaiki`, onClick: () => go('inventory', { section: 'perangkat', status: STATUS.REPAIR }) },
    { show: attention.damaged > 0, text: `${attention.damaged} perangkat rusak menunggu keputusan (perbaikan, retur, atau penghapusan)`, onClick: () => go('inventory', { section: 'perangkat', status: STATUS.DAMAGED }) },
  ].filter(a => a.show);

  return (
    <div className="space-y-6">
      <PageHeader icon={ShieldCheck} title="Dashboard" subtitle="Ringkasan aset real-time" />

      {alerts.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 p-4 space-y-1.5">
          <p className="text-[10px] font-black text-amber-700 uppercase tracking-[0.2em] flex items-center gap-2 mb-1"><AlertTriangle size={14} /> Perlu Perhatian</p>
          {alerts.map(alert => (
            <button key={alert.text} onClick={alert.onClick} className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-amber-50 text-left text-sm font-medium text-brand-text-main">
              {alert.text}
              <ArrowRight size={14} className="text-amber-600 shrink-0" />
            </button>
          ))}
        </div>
      )}

      <div className="flex bg-white rounded-xl border border-brand-border p-1 gap-1 max-w-lg shadow-sm">
        {TABS.map(t => (
          <button
            key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
            className={cn('flex-1 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2', tab === t.id ? 'bg-brand-primary text-white shadow-lg shadow-blue-100' : 'text-brand-text-muted hover:bg-gray-50')}
          >
            <t.icon size={14} />
            {ASSET_TYPE_LABEL[t.id]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map(card => (
          <button
            key={card.title} onClick={() => openInventory(card.status)} title="Lihat daftar aset"
            className="bg-white p-4 rounded-2xl border border-brand-border shadow-sm flex items-center gap-3 hover:border-brand-primary transition-all text-left"
          >
            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0', card.color)}><card.icon size={20} /></div>
            <div className="min-w-0">
              <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest truncate">{card.title}</p>
              <p className={cn('text-xl font-black tracking-tight', card.text)}>{card.value.toLocaleString('id-ID')}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-brand-border bg-gray-50/50">
            <h2 className="text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em]">Registrasi {ASSET_TYPE_LABEL[tab]} · 6 Bulan Terakhir</h2>
          </div>
          <div className="p-6 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.trends}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94A3B8' }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94A3B8' }} />
                <Tooltip cursor={{ fill: '#F8FAFC' }} formatter={(value: number) => [value, 'Unit']} contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0', boxShadow: 'none' }} />
                <Bar dataKey="count" fill="#2563EB" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-brand-border bg-gray-50/50">
            <h2 className="text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em]">Distribusi Status</h2>
          </div>
          <div className="p-6">
            {stats.pie.length === 0 ? (
              <p className="text-center text-xs font-bold text-brand-text-muted py-16">Belum ada data.</p>
            ) : (
              <>
                <div className="h-[190px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={stats.pie} innerRadius={55} outerRadius={80} paddingAngle={stats.pie.length > 1 ? 3 : 0} dataKey="value">
                        {stats.pie.map(entry => <Cell key={entry.status} fill={entry.color} stroke="none" />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E2E8F0' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1 mt-3">
                  {stats.pie.map(item => (
                    <button key={item.status} onClick={() => openInventory(item.status)} className="w-full flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-gray-50">
                      <span className="flex items-center gap-2 font-bold text-brand-text-muted"><span className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />{item.name}</span>
                      <span className="font-black text-brand-text-main">{item.value.toLocaleString('id-ID')}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-brand-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-brand-border bg-gray-50/50 flex items-center justify-between">
          <h2 className="text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em] flex items-center gap-2"><History size={14} className="text-brand-primary" /> Pergerakan Terbaru</h2>
          <button onClick={() => go('movements')} className="text-[11px] font-bold text-brand-primary hover:underline">Lihat semua →</button>
        </div>
        {recent.length === 0 ? (
          <p className="text-center text-xs font-bold text-brand-text-muted py-10">Belum ada pergerakan.</p>
        ) : (
          <ul className="divide-y divide-brand-border">
            {recent.map(move => (
              <li key={move.id} className="px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-brand-text-main">{move.sn || assetById.get(move.edcId)?.sn || move.edcId}</span>
                <span className="font-bold text-brand-text-muted">{movementLabel(move.type)}{move.customerName ? ` · ${move.customerName}` : ''}</span>
                <StatusBadge status={move.toStatus} />
                <span className="text-[10px] font-bold text-brand-text-muted">{formatDate(move.timestamp, 'dd MMM HH:mm')} · {move.userName || 'System'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

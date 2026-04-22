import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { 
  Package, 
  CheckCircle, 
  Truck, 
  AlertCircle, 
  ArrowUpRight, 
  ArrowDownRight,
  ShieldCheck,
  Zap,
  Smartphone,
  Box
} from 'lucide-react';
import { motion } from 'motion/react';

export function Dashboard({ onNavigate }: { onNavigate: (page: any) => void }) {
  const [activeTab, setActiveTab] = useState<'perangkat' | 'sim' | 'peripheral'>('perangkat');
  const [categoryStats, setCategoryStats] = useState<any>({
    perangkat: { total: 0, available: 0, installed: 0, repair: 0, delivery: 0, trends: [] },
    sim: { total: 0, available: 0, installed: 0, repair: 0, delivery: 0, trends: [] },
    peripheral: { total: 0, available: 0, installed: 0, repair: 0, delivery: 0, trends: [] }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'edcs'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      
      const newStats: any = {
        perangkat: { total: 0, available: 0, installed: 0, repair: 0, delivery: 0, trends: [] },
        sim: { total: 0, available: 0, installed: 0, repair: 0, delivery: 0, trends: [] },
        peripheral: { total: 0, available: 0, installed: 0, repair: 0, delivery: 0, trends: [] }
      };

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const now = new Date();
      const createTrendsBase = () => {
        const base = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          base.push({
            name: months[d.getMonth()],
            count: 0,
            month: d.getMonth(),
            year: d.getFullYear()
          });
        }
        return base;
      };

      newStats.perangkat.trends = createTrendsBase();
      newStats.sim.trends = createTrendsBase();
      newStats.peripheral.trends = createTrendsBase();

      data.forEach(item => {
        const type = item.assetType === 'sim' ? 'sim' : item.assetType === 'peripheral' ? 'peripheral' : 'perangkat';
        const target = newStats[type];
        
        target.total++;
        if (item.status === 'Available in Warehouse') target.available++;
        if (item.status === 'Installed / Active') target.installed++;
        if (item.status === 'Under Repair') target.repair++;
        if (item.status === 'In Delivery') target.delivery++;

        if (item.updatedAt) {
          const d = item.updatedAt.toDate();
          const trend = target.trends.find((m: any) => m.month === d.getMonth() && m.year === d.getFullYear());
          if (trend) trend.count++;
        }
      });

      setCategoryStats(newStats);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const currentStats = categoryStats[activeTab];

  const pieData = [
    { name: 'Available', value: currentStats.available, color: '#10B981' },
    { name: 'Installed', value: currentStats.installed, color: '#3B82F6' },
    { name: 'Repair', value: currentStats.repair, color: '#EF4444' },
    { name: 'Delivery', value: currentStats.delivery, color: '#F59E0B' }
  ].filter(d => d.value > 0);

  const StatCard = ({ title, value, color, textColor, icon: Icon }: any) => (
    <div className="bg-white p-5 rounded-2xl border border-brand-border shadow-sm flex items-center gap-4 group hover:border-brand-primary transition-all">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg", color)}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-widest mb-0.5">{title}</p>
        <h3 className={cn("text-xl font-black tracking-tight", textColor)}>{value.toLocaleString()}</h3>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-brand-text-main tracking-tighter uppercase flex items-center gap-2">
            <ShieldCheck className="text-brand-primary" />
            Inventory Analytics
          </h1>
          <p className="text-[10px] text-brand-text-muted font-bold uppercase tracking-[0.2em] mt-1">Real-time Asset Monitoring Dashboard</p>
        </div>
      </header>

      {/* Tabs Switcher */}
      <div className="flex bg-white rounded-xl border border-brand-border p-1 gap-1 max-w-lg items-center shadow-sm">
        <button 
          onClick={() => setActiveTab('perangkat')}
          className={cn(
            "flex-1 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2",
            activeTab === 'perangkat' ? "bg-brand-primary text-white shadow-lg shadow-blue-100" : "text-brand-text-muted hover:bg-gray-50"
          )}
        >
          <Smartphone size={14} />
          Perangkat
        </button>
        <button 
          onClick={() => setActiveTab('sim')}
          className={cn(
            "flex-1 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2",
            activeTab === 'sim' ? "bg-brand-primary text-white shadow-lg shadow-blue-100" : "text-brand-text-muted hover:bg-gray-50"
          )}
        >
          <Zap size={14} />
          SIM Cards
        </button>
        <button 
          onClick={() => setActiveTab('peripheral')}
          className={cn(
            "flex-1 px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2",
            activeTab === 'peripheral' ? "bg-brand-primary text-white shadow-lg shadow-blue-100" : "text-brand-text-muted hover:bg-gray-50"
          )}
        >
          <Box size={14} />
          Peripherals
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard title={`Total ${activeTab}`} value={currentStats.total} color="bg-brand-primary" textColor="text-brand-text-main" icon={Package} />
        <StatCard title="Stok Tersedia" value={currentStats.available} color="bg-emerald-500" textColor="text-emerald-600" icon={CheckCircle} />
        <StatCard title="Terpasang" value={currentStats.installed} color="bg-blue-500" textColor="text-blue-600" icon={Smartphone} />
        <StatCard title="Perbaikan" value={currentStats.repair} color="bg-red-500" textColor="text-red-600" icon={AlertCircle} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-brand-border shadow-sm flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-brand-border bg-gray-50/50 flex items-center justify-between">
            <h2 className="text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
              <Zap size={14} className="text-brand-primary" />
              {activeTab} Registration Trends
            </h2>
          </div>
          <div className="p-8">
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currentStats.trends}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#94A3B8'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#94A3B8'}} />
                  <Tooltip 
                    cursor={{fill: '#F8FAFC'}} 
                    contentStyle={{borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: 'none', padding: '12px'}}
                    labelStyle={{fontWeight: 900, marginBottom: '4px', textTransform: 'uppercase', fontSize: '10px'}}
                  />
                  <Bar dataKey="count" fill="url(#colorGradient)" radius={[6, 6, 0, 0]} barSize={40}>
                    <defs>
                      <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" />
                        <stop offset="100%" stopColor="#60A5FA" />
                      </linearGradient>
                    </defs>
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-brand-border shadow-sm flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-brand-border bg-gray-50/50">
            <h2 className="text-[10px] font-black text-brand-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
              <Package size={14} className="text-brand-primary" />
              Inventory Distribution
            </h2>
          </div>
          <div className="p-8 flex-1 flex flex-col items-center justify-center">
            {pieData.length > 0 ? (
              <>
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        innerRadius={70}
                        outerRadius={95}
                        paddingAngle={10}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{borderRadius: '12px', border: '1px solid #E2E8F0', padding: '10px'}}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full mt-6">
                  {pieData.map((item) => (
                    <div key={item.name} className="flex flex-col gap-1 border-l-2 pl-3" style={{borderColor: item.color}}>
                      <span className="text-[9px] font-black text-brand-text-muted uppercase tracking-wider">{item.name}</span>
                      <span className="text-sm font-black text-brand-text-main">{item.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center space-y-2 py-10 opacity-50">
                <Box size={40} className="mx-auto text-brand-text-muted" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-text-muted">No data available for this category</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}

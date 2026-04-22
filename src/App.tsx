import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { EDCList } from './pages/EDCList';
import { CustomerList } from './pages/CustomerList';
import { ContractList } from './pages/ContractList';
import { MovementPage } from './pages/MovementPage';
import { LocationList } from './pages/LocationList';
import { MasterParts } from './pages/MasterParts';
import { Reports } from './pages/Reports';
import { UserManagement } from './pages/UserManagement';
import { Login } from './pages/Login';
import { Loader2 } from 'lucide-react';

export type Page = 'dashboard' | 'inventory' | 'customers' | 'locations' | 'parts' | 'contracts' | 'movements' | 'reports' | 'users';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [preSelectedAssetIds, setPreSelectedAssetIds] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            setRole(userDoc.data().role);
          } else {
            // Default role for first user or new users (Admin if matched email)
            const isDefaultAdmin = user.email === 'rismadakrisnaa@gmail.com';
            const newRole = isDefaultAdmin ? 'Admin' : 'Management';
            await setDoc(doc(db, 'users', user.uid), {
              email: user.email,
              role: newRole,
              displayName: user.displayName
            });
            setRole(newRole);
          }
        } catch (error) {
          console.error("Error fetching user role", error);
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const handleNavigate = (page: Page, options?: { preSelectedIds?: string[] }) => {
    setCustomerFilter(null);
    if (options?.preSelectedIds) {
      setPreSelectedAssetIds(options.preSelectedIds);
    } else {
      setPreSelectedAssetIds([]);
    }
    setCurrentPage(page);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard onNavigate={setCurrentPage} />;
      case 'inventory': return <EDCList initialFilter={customerFilter} onNavigate={(page, opts?: any) => handleNavigate(page, opts)} />;
      case 'customers': return (
        <CustomerList 
          onViewAssets={(customerId) => {
            setCustomerFilter(customerId);
            setCurrentPage('reports');
          }}
          onViewContract={(customerId) => {
            setCustomerFilter(customerId);
            setCurrentPage('contracts');
          }}
        />
      );
      case 'locations': return <LocationList />;
      case 'parts': return <MasterParts />;
      case 'contracts': return <ContractList initialFilter={customerFilter} />;
      case 'movements': return <MovementPage preSelectedIds={preSelectedAssetIds} />;
      case 'reports': return <Reports initialCustomerId={customerFilter} />;
      case 'users': return <UserManagement />;
      default: return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  return (
    <Layout user={user} role={role} currentPage={currentPage} onNavigate={handleNavigate}>
      {renderPage()}
    </Layout>
  );
}

import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LockScreen from './components/LockScreen';
import { get } from './lib/api';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Recurring from './pages/Recurring';
import Accounts from './pages/Accounts';
import Categories from './pages/Categories';
import Loans from './pages/Loans';
import Subscriptions from './pages/Subscriptions';
import Budgets from './pages/Budgets';
import Forecast from './pages/Forecast';
import Risk from './pages/Risk';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import StatementImport from './pages/StatementImport';
import People from './pages/People';
import Sync from './pages/Sync';
import { queryClient } from './lib/hooks';

export default function App() {
  const [locked, setLocked] = useState<boolean | null>(null);
  useEffect(() => {
    get<{ unlocked: boolean }>('/auth/status').then((s) => setLocked(!s.unlocked)).catch(() => setLocked(false));
    const f = () => setLocked(true); window.addEventListener('fa:locked', f); return () => window.removeEventListener('fa:locked', f);
  }, []);
  if (locked === null) return null;
  if (locked) return <LockScreen onUnlock={() => { setLocked(false); queryClient.invalidateQueries(); }} />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="recurring" element={<Recurring />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="categories" element={<Categories />} />
        <Route path="loans" element={<Loans />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="forecast" element={<Forecast />} />
        <Route path="risk" element={<Risk />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="reports" element={<Reports />} />
        <Route path="sync" element={<Sync />} />
        <Route path="import" element={<StatementImport />} />
        <Route path="people" element={<People />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}

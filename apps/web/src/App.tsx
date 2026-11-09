import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { LimitationsList } from './limitations/LimitationsList';
import { AuthForm } from './pages/AuthForm';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<AuthForm mode="login" />} />
        <Route path="register" element={<AuthForm mode="register" />} />
        <Route path="app" element={<Dashboard />} />
        <Route path="docs/limitations" element={<LimitationsList />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { LimitationsList } from './limitations/LimitationsList';
import { AuthForm } from './pages/AuthForm';
import { ClientPage } from './pages/ClientPage';
import { Dashboard } from './pages/Dashboard';
import { InvitePage } from './pages/InvitePage';
import { SharedPage } from './pages/SharedPage';
import { Team } from './pages/Team';
import { Landing } from './pages/Landing';
import { ProjectPage } from './pages/ProjectPage';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <Routes>
      <Route path="s/:token" element={<SharedPage />} />
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<AuthForm mode="login" />} />
        <Route path="register" element={<AuthForm mode="register" />} />
        <Route path="app" element={<Dashboard />} />
        <Route path="app/clients/:clientId/projects/:projectId" element={<ProjectPage />} />
        <Route path="app/w/:ws/clients/:clientId/projects/:projectId" element={<ProjectPage />} />
        <Route path="app/w/:ws/clients/:clientId" element={<ClientPage />} />
        <Route path="app/w/:ws/team" element={<Team />} />
        <Route path="invite/:token" element={<InvitePage />} />
        <Route path="docs/limitations" element={<LimitationsList />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

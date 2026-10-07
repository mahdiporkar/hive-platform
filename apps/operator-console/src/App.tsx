import {useEffect, useState} from 'react';
import {Alert, Button, ConfigProvider, Layout, Menu, Result, Space, Spin, Tag, Typography} from 'antd';
import {Navigate, Route, Routes, useLocation, useNavigate} from 'react-router-dom';
import type {HiveContext, PlatformRole} from '@hive-platform/contracts';
import {errorText, http, loadContext} from './api';
import {ApiLogsPage, AuditPage} from './pages/Logs';
import {ApplicationDetailPage, ApplicationsPage, ModuleDetailPage, ModulesPage} from './pages/Catalog';
import {DiagnosticsPage, FlagsPage, LegacyProfilesPage, RoutesPage, SupersetPage, TargetsPage} from './pages/Integration';
import {GrantsPage, GroupsPage, IdentityProvidersPage, PlatformRolesPage, RolesPage, UsersPage} from './pages/Security';

/** Menu entries with the platform roles that can use them (UI hint; the control plane enforces every call). */
const SECTIONS: {key: string; label: string; roles: PlatformRole[]}[] = [
  {key: '/diagnostics', label: 'Diagnostics', roles: ['OPERATOR', 'SECURITY_ADMIN', 'INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/applications', label: 'Applications', roles: ['OPERATOR', 'SECURITY_ADMIN', 'INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/modules', label: 'Micro apps & manifests', roles: ['OPERATOR', 'SECURITY_ADMIN', 'INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/users', label: 'Users', roles: ['SECURITY_ADMIN', 'OPERATOR', 'INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/groups', label: 'Groups', roles: ['SECURITY_ADMIN', 'OPERATOR', 'INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/roles', label: 'Roles', roles: ['SECURITY_ADMIN', 'OPERATOR', 'INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/grants', label: 'Grants', roles: ['SECURITY_ADMIN', 'OPERATOR', 'INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/platform-roles', label: 'Platform roles', roles: ['SUPER_ADMIN', 'SECURITY_ADMIN', 'AUDITOR']},
  {key: '/identity-providers', label: 'Identity providers', roles: ['SECURITY_ADMIN', 'AUDITOR']},
  {key: '/service-targets', label: 'Service targets', roles: ['INTEGRATION_ADMIN', 'OPERATOR', 'AUDITOR']},
  {key: '/legacy-auth', label: 'Legacy authentication', roles: ['INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/routes', label: 'Proxy routes', roles: ['INTEGRATION_ADMIN', 'OPERATOR', 'AUDITOR']},
  {key: '/superset', label: 'Superset (optional)', roles: ['INTEGRATION_ADMIN', 'AUDITOR']},
  {key: '/feature-flags', label: 'Feature flags', roles: ['OPERATOR', 'AUDITOR']},
  {key: '/audit', label: 'Audit log', roles: ['AUDITOR']},
  {key: '/api-logs', label: 'API logs', roles: ['AUDITOR']},
];

export function App() {
  const [context, setContext] = useState<HiveContext | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    loadContext().then(c => {
      if (!c) window.location.assign(`/auth/login?returnUrl=${encodeURIComponent('/console' + location.pathname)}`);
      setContext(c);
    }).catch(e => setError(errorText(e)));
  }, []);
  if (error) return <Result status="error" title="Console unavailable" subTitle={error} />;
  if (!context) return <Spin style={{margin: 48}} />;
  const roles = new Set<PlatformRole>(context.platformRoles);
  const isSuper = roles.has('SUPER_ADMIN');
  const sections = SECTIONS.filter(s => isSuper || s.roles.some(r => roles.has(r)));
  if (sections.length === 0) return <div data-testid="no-platform-role"><Result status="403" title="No platform role"
    subTitle="Operator Console requires a platform role (operator, security, integration administrator or auditor). Business roles do not grant console access." /></div>;
  return (
    <ConfigProvider theme={{token: {borderRadius: 6}}}>
      <Layout style={{minHeight: '100vh'}}>
        <Layout.Header style={{display: 'flex', alignItems: 'center', gap: 16}}>
          <Typography.Title level={4} style={{color: '#fff', margin: 0}}>Hive Operator Console</Typography.Title>
          <Space style={{marginLeft: 'auto'}}>
            {[...roles].map(r => <Tag key={r} color="purple" data-testid={`role-${r}`}>{r}</Tag>)}
            <Typography.Text style={{color: '#fff'}} data-testid="operator-name">{context.identity.displayName}</Typography.Text>
            <Button size="small" data-testid="logout" onClick={async () => { await http.post('/auth/logout'); window.location.assign('/'); }}>Sign out</Button>
          </Space>
        </Layout.Header>
        <Layout>
          <Layout.Sider width={230} theme="light">
            <Menu mode="inline" selectedKeys={['/' + location.pathname.split('/')[1]]} items={sections.map(s => ({key: s.key, label: <span data-testid={`nav-${s.key.slice(1)}`}>{s.label}</span>}))}
              onClick={({key}) => navigate(key)} />
          </Layout.Sider>
          <Layout.Content style={{padding: 24}}>
            <Alert type="info" showIcon style={{marginBottom: 16}} message="Platform administration only. Business administration belongs to solutions." />
            <Routes>
              <Route path="/" element={<Navigate to={sections[0]!.key} replace />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/:key" element={<ApplicationDetailPage />} />
              <Route path="/modules" element={<ModulesPage />} />
              <Route path="/modules/:key" element={<ModuleDetailPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/roles" element={<RolesPage />} />
              <Route path="/grants" element={<GrantsPage />} />
              <Route path="/platform-roles" element={<PlatformRolesPage />} />
              <Route path="/identity-providers" element={<IdentityProvidersPage />} />
              <Route path="/service-targets" element={<TargetsPage />} />
              <Route path="/legacy-auth" element={<LegacyProfilesPage />} />
              <Route path="/routes" element={<RoutesPage />} />
              <Route path="/superset" element={<SupersetPage />} />
              <Route path="/feature-flags" element={<FlagsPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/api-logs" element={<ApiLogsPage />} />
              <Route path="*" element={<Result status="404" title="Not found" />} />
            </Routes>
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

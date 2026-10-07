import {useState} from 'react';
import {Alert, Button, Card, Descriptions, Input, Select, Space, Table, Tag} from 'antd';
import {admin, errorText, useList} from '../api';
import {CreateButton, EntityPage} from '../EntityPage';

interface Target {key: string; displayName: string; baseUrl: string; connectTimeoutMs: number; responseTimeoutMs: number; maxRequestBytes: number; maxResponseBytes: number; revision: number}
interface Profile {key: string; targetKey: string; tokenEndpointPath: string; requestFormat: string; credentialReference: string; expirySkewSeconds: number; revision: number}
interface Route {key: string; applicationKey: string; moduleKey?: string; pathPrefix: string; targetKey: string; authentication: string; legacyProfileKey?: string; upstreamBasePath: string; revision: number}
interface Operation {key: string; method: string; pathPattern: string; access: string; resourceKey?: string; action?: string; archived: boolean; revision: number}
interface Flag {key: string; description: string; enabled: boolean; exposure: string; environments: string[]; revision: number}

export function TargetsPage() {
  return <EntityPage<Target> title="Service targets" path="/service-targets" testId="targets" rowKey="key"
    columns={[{title: 'Key', dataIndex: 'key'}, {title: 'Name', dataIndex: 'displayName'}, {title: 'Base URL', dataIndex: 'baseUrl'},
      {title: 'Timeouts (ms)', render: (_, t) => `${t.connectTimeoutMs} / ${t.responseTimeoutMs}`}, {title: 'Limits (bytes)', render: (_, t) => `${t.maxRequestBytes} / ${t.maxResponseBytes}`}]}
    create={{label: 'New service target', fields: [{name: 'key', label: 'Key', required: true}, {name: 'displayName', label: 'Display name', required: true},
      {name: 'baseUrl', label: 'Base URL', required: true}, {name: 'connectTimeoutMs', label: 'Connect timeout (ms)', type: 'number'}, {name: 'responseTimeoutMs', label: 'Response timeout (ms)', type: 'number'},
      {name: 'maxRequestBytes', label: 'Max request bytes', type: 'number'}, {name: 'maxResponseBytes', label: 'Max response bytes', type: 'number'}]}} />;
}

export function LegacyProfilesPage() {
  return <EntityPage<Profile> title="Legacy authentication" path="/legacy-auth-profiles" testId="legacy" rowKey="key"
    columns={[{title: 'Key', dataIndex: 'key'}, {title: 'Target', dataIndex: 'targetKey'}, {title: 'Token endpoint', dataIndex: 'tokenEndpointPath'},
      {title: 'Format', dataIndex: 'requestFormat'}, {title: 'Credential reference', dataIndex: 'credentialReference'}, {title: 'Skew (s)', dataIndex: 'expirySkewSeconds'}]}
    create={{label: 'New legacy profile', fields: [{name: 'key', label: 'Key', required: true}, {name: 'targetKey', label: 'Service target', required: true},
      {name: 'tokenEndpointPath', label: 'Token endpoint path', required: true}, {name: 'requestFormat', label: 'Request format', type: 'select', required: true, options: ['JSON', 'FORM_URLENCODED', 'HTTP_BASIC', 'OAUTH_CLIENT_CREDENTIALS']},
      {name: 'credentialReference', label: 'Credential reference (env:HIVE_SECRET_* or file:*)', required: true}, {name: 'tokenPointer', label: 'Token JSON pointer', required: true, initial: '/access_token'},
      {name: 'expiresInPointer', label: 'Expires-in JSON pointer', required: true, initial: '/expires_in'}, {name: 'expirySkewSeconds', label: 'Expiry skew (s)', type: 'number', initial: 30}]}} />;
}

function OperationsPanel({route}: {route: Route}) {
  const {data, reload} = useList<Operation>(`/proxy-routes/${route.key}/operations`);
  return (
    <Card size="small" title={`Operations of ${route.key} (${route.pathPrefix})`} data-testid={`operations-${route.key}`} extra={<CreateButton label="New operation" testId={`operation-create-${route.key}`}
      fields={[{name: 'key', label: 'Key', required: true}, {name: 'method', label: 'Method', type: 'select', required: true, options: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']},
        {name: 'pathPattern', label: 'Path pattern', required: true, placeholder: '/items/{id}'}, {name: 'access', label: 'Access', type: 'select', required: true, options: ['PUBLIC', 'HYBRID', 'AUTHENTICATED']},
        {name: 'resourceKey', label: 'Resource (AUTHENTICATED only)'}, {name: 'action', label: 'Action (AUTHENTICATED only)'}]}
      submit={body => admin.post(`/proxy-routes/${route.key}/operations`, body)} onDone={() => void reload()} />}>
      <Table<Operation> size="small" rowKey="key" dataSource={data} pagination={false} columns={[{title: 'Key', dataIndex: 'key'}, {title: 'Method', dataIndex: 'method'},
        {title: 'Pattern', dataIndex: 'pathPattern'}, {title: 'Access', dataIndex: 'access', render: a => <Tag>{a}</Tag>}, {title: 'Permission', render: (_, o) => o.resourceKey ? `${o.resourceKey}:${o.action}` : '—'}]} />
    </Card>
  );
}

export function RoutesPage() {
  const [selected, setSelected] = useState<Route | null>(null);
  const [preview, setPreview] = useState({method: 'GET', path: '', result: '' as string});
  return (
    <EntityPage<Route> title="Proxy routes" path="/proxy-routes" testId="routes" rowKey="key"
      columns={[{title: 'Key', dataIndex: 'key'}, {title: 'Prefix', render: (_, r) => `/api/routes${r.pathPrefix}`}, {title: 'Target', dataIndex: 'targetKey'},
        {title: 'Authentication', render: (_, r) => <Tag color={r.authentication === 'LEGACY' ? 'orange' : r.authentication === 'FORWARD_TOKEN' ? 'blue' : 'default'}>{r.authentication}</Tag>},
        {title: 'Application', dataIndex: 'applicationKey'}]}
      create={{label: 'New proxy route', fields: [{name: 'key', label: 'Key', required: true}, {name: 'applicationKey', label: 'Application', required: true}, {name: 'moduleKey', label: 'Module'},
        {name: 'pathPrefix', label: 'Path prefix', required: true, placeholder: '/records'}, {name: 'targetKey', label: 'Service target', required: true},
        {name: 'authentication', label: 'Authentication', type: 'select', required: true, options: ['FORWARD_TOKEN', 'LEGACY', 'NONE'], initial: 'FORWARD_TOKEN'},
        {name: 'legacyProfileKey', label: 'Legacy profile (LEGACY only)'}, {name: 'upstreamBasePath', label: 'Upstream base path', initial: '/'}]}}
      actions={[{label: 'Operations', testId: r => `route-operations-${r.key}`, run: async r => setSelected(r)}]}
      extra={<Space.Compact>
        <Select value={preview.method} style={{width: 90}} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(v => ({value: v}))} onChange={method => setPreview({...preview, method})} />
        <Input data-testid="preview-path" placeholder="/records/items/1" value={preview.path} onChange={e => setPreview({...preview, path: e.target.value})} />
        <Button data-testid="preview-run" onClick={async () => {
          try { setPreview({...preview, result: JSON.stringify(await admin.get(`/routing/preview?method=${preview.method}&path=${encodeURIComponent(preview.path)}`))}); }
          catch (e) { setPreview({...preview, result: errorText(e)}); }
        }}>Preview</Button></Space.Compact>}>
      {() => <>
        {preview.result && <Alert data-testid="preview-result" style={{marginTop: 12}} message={preview.result} />}
        {selected && <div style={{marginTop: 16}}><OperationsPanel route={selected} key={selected.key} /></div>}
      </>}
    </EntityPage>
  );
}

export function FlagsPage() {
  return <EntityPage<Flag> title="Feature flags" path="/feature-flags" testId="flags" rowKey="key"
    columns={[{title: 'Key', dataIndex: 'key'}, {title: 'Description', dataIndex: 'description'}, {title: 'Exposure', dataIndex: 'exposure'},
      {title: 'Environments', render: (_, f) => f.environments.join(', ') || 'all'}, {title: 'Enabled', render: (_, f) => f.enabled ? <Tag color="green">on</Tag> : <Tag>off</Tag>}]}
    create={{label: 'New flag', fields: [{name: 'key', label: 'Key', required: true}, {name: 'description', label: 'Description', required: true},
      {name: 'exposure', label: 'Exposure', type: 'select', required: true, options: ['PUBLIC', 'AUTHENTICATED', 'INTERNAL']}, {name: 'environments', label: 'Environments (comma separated)', type: 'tags'},
      {name: 'enabled', label: 'Enabled', type: 'switch', initial: false}]}}
    actions={[{label: 'Toggle', testId: f => `flag-toggle-${f.key}`, run: f => admin.put(`/feature-flags/${f.key}`, {...f, enabled: !f.enabled})}]} />;
}

export function DiagnosticsPage() {
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null);
  const [catalog, setCatalog] = useState<{revision: number; modules: {moduleKey: string; manifestVersion: string}[]} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try { setGraph(await admin.get('/diagnostics/graph')); setCatalog(await admin.get('/runtime/catalog')); setError(null); } catch (e) { setError(errorText(e)); }
  };
  if (!graph && !error) void load();
  return (
    <Card title="Runtime diagnostics" data-testid="diagnostics-page" extra={<Button onClick={() => void load()}>Refresh</Button>}>
      {error && <Alert type="error" message={error} />}
      {graph && <Descriptions bordered size="small" items={Object.entries(graph).map(([k, v]) => ({key: k, label: k, children: <span data-testid={`graph-${k}`}>{String(v)}</span>}))} />}
      {catalog && <Descriptions style={{marginTop: 16}} bordered size="small" items={[{label: 'Runtime catalog revision', children: catalog.revision},
        {label: 'Active modules', children: <span data-testid="active-modules">{catalog.modules.map(m => `${m.moduleKey}@${m.manifestVersion}`).join(', ') || 'none'}</span>}]} />}
    </Card>
  );
}

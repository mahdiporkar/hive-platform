import {useI18n} from '../i18n';
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
  const {t} = useI18n();
  return <EntityPage<Target> title={t("Service targets")} path="/service-targets" testId="targets" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Name"), dataIndex: 'displayName'}, {title: t("Base URL"), dataIndex: 'baseUrl'},
      {title: t("Timeouts (ms)"), render: (_, t) => `${t.connectTimeoutMs} / ${t.responseTimeoutMs}`}, {title: t("Limits (bytes)"), render: (_, t) => `${t.maxRequestBytes} / ${t.maxResponseBytes}`}]}
    create={{label: t("New service target"), fields: [{name: 'key', label: t("Key"), required: true}, {name: 'displayName', label: t("Display name"), required: true},
      {name: 'baseUrl', label: t("Base URL"), required: true}, {name: 'connectTimeoutMs', label: t("Connect timeout (ms)"), type: 'number'}, {name: 'responseTimeoutMs', label: t("Response timeout (ms)"), type: 'number'},
      {name: 'maxRequestBytes', label: t("Max request bytes"), type: 'number'}, {name: 'maxResponseBytes', label: t("Max response bytes"), type: 'number'}]}} />;
}

export function LegacyProfilesPage() {
  const {t} = useI18n();
  return <EntityPage<Profile> title={t("Legacy authentication")} path="/legacy-auth-profiles" testId="legacy" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Target"), dataIndex: 'targetKey'}, {title: t("Token endpoint"), dataIndex: 'tokenEndpointPath'},
      {title: t("Format"), dataIndex: 'requestFormat'}, {title: t("Credential reference"), dataIndex: 'credentialReference'}, {title: t("Skew (s)"), dataIndex: 'expirySkewSeconds'}]}
    create={{label: t("New legacy profile"), fields: [{name: 'key', label: t("Key"), required: true}, {name: 'targetKey', label: t("Service target"), required: true},
      {name: 'tokenEndpointPath', label: t("Token endpoint path"), required: true}, {name: 'requestFormat', label: t("Request format"), type: 'select', required: true, options: ['JSON', 'FORM_URLENCODED', 'HTTP_BASIC', 'OAUTH_CLIENT_CREDENTIALS']},
      {name: 'credentialReference', label: t("Credential reference (env:HIVE_SECRET_* or file:*)"), required: true}, {name: 'tokenPointer', label: t("Token JSON pointer"), required: true, initial: '/access_token'},
      {name: 'expiresInPointer', label: t("Expires-in JSON pointer"), required: true, initial: '/expires_in'}, {name: 'expirySkewSeconds', label: t("Expiry skew (s)"), type: 'number', initial: 30}]}} />;
}

function OperationsPanel({route}: {route: Route}) {
  const {t} = useI18n();
  const {data, reload} = useList<Operation>(`/proxy-routes/${route.key}/operations`);
  return (
    <Card size="small" title={t('Operations of {key} ({path})', {key: route.key, path: route.pathPrefix})} data-testid={`operations-${route.key}`} extra={<CreateButton label={t("New operation")} testId={`operation-create-${route.key}`}
      fields={[{name: 'key', label: t("Key"), required: true}, {name: 'method', label: t("Method"), type: 'select', required: true, options: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']},
        {name: 'pathPattern', label: t("Path pattern"), required: true, placeholder: '/items/{id}'}, {name: 'access', label: t("Access"), type: 'select', required: true, options: ['PUBLIC', 'HYBRID', 'AUTHENTICATED']},
        {name: 'resourceKey', label: t("Resource (AUTHENTICATED only)")}, {name: 'action', label: t("Action (AUTHENTICATED only)")}]}
      submit={body => admin.post(`/proxy-routes/${route.key}/operations`, body)} onDone={() => void reload()} />}>
      <Table<Operation> size="small" rowKey="key" dataSource={data} pagination={false} columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Method"), dataIndex: 'method'},
        {title: t("Pattern"), dataIndex: 'pathPattern'}, {title: t("Access"), dataIndex: 'access', render: a => <Tag>{t(a)}</Tag>}, {title: t("Permission"), render: (_, o) => o.resourceKey ? `${o.resourceKey}:${o.action}` : '—'}]} />
    </Card>
  );
}

export function RoutesPage() {
  const {t} = useI18n();
  const [selected, setSelected] = useState<Route | null>(null);
  const [preview, setPreview] = useState({method: 'GET', path: '', result: '' as string});
  return (
    <EntityPage<Route> title={t("Proxy routes")} path="/proxy-routes" testId="routes" rowKey="key"
      columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Prefix"), render: (_, r) => `/api/routes${r.pathPrefix}`}, {title: t("Target"), dataIndex: 'targetKey'},
        {title: t("Authentication"), render: (_, r) => <Tag color={r.authentication === 'LEGACY' ? 'orange' : r.authentication === 'FORWARD_TOKEN' ? 'blue' : 'default'}>{t(r.authentication)}</Tag>},
        {title: t("Application"), dataIndex: 'applicationKey'}]}
      create={{label: t("New proxy route"), fields: [{name: 'key', label: t("Key"), required: true}, {name: 'applicationKey', label: t("Application"), required: true}, {name: 'moduleKey', label: t("Module")},
        {name: 'pathPrefix', label: t("Path prefix"), required: true, placeholder: '/records'}, {name: 'targetKey', label: t("Service target"), required: true},
        {name: 'authentication', label: t("Authentication"), type: 'select', required: true, options: ['FORWARD_TOKEN', 'LEGACY', 'NONE'], initial: 'FORWARD_TOKEN'},
        {name: 'legacyProfileKey', label: t("Legacy profile (LEGACY only)")}, {name: 'upstreamBasePath', label: t("Upstream base path"), initial: '/'}]}}
      actions={[{label: t("Operations"), testId: r => `route-operations-${r.key}`, run: async r => setSelected(r)}]}
      extra={<Space.Compact>
        <Select value={preview.method} style={{width: 90}} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(v => ({value: v}))} onChange={method => setPreview({...preview, method})} />
        <Input data-testid="preview-path" placeholder="/records/items/1" value={preview.path} onChange={e => setPreview({...preview, path: e.target.value})} />
        <Button data-testid="preview-run" onClick={async () => {
          try { setPreview({...preview, result: JSON.stringify(await admin.get(`/routing/preview?method=${preview.method}&path=${encodeURIComponent(preview.path)}`))}); }
          catch (e) { setPreview({...preview, result: errorText(e)}); }
        }}>{t("Preview")}</Button></Space.Compact>}>
      {() => <>
        {preview.result && <Alert data-testid="preview-result" style={{marginTop: 12}} message={preview.result} />}
        {selected && <div style={{marginTop: 16}}><OperationsPanel route={selected} key={selected.key} /></div>}
      </>}
    </EntityPage>
  );
}

export function FlagsPage() {
  const {t} = useI18n();
  return <EntityPage<Flag> title={t("Feature flags")} path="/feature-flags" testId="flags" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Description"), dataIndex: 'description'}, {title: t("Exposure"), dataIndex: 'exposure'},
      {title: t("Environments"), render: (_, f) => f.environments.join(', ') || t('all')}, {title: t("Enabled"), render: (_, f) => f.enabled ? <Tag color="green">{t("on")}</Tag> : <Tag>{t("off")}</Tag>}]}
    create={{label: t("New flag"), fields: [{name: 'key', label: t("Key"), required: true}, {name: 'description', label: t("Description"), required: true},
      {name: 'exposure', label: t("Exposure"), type: 'select', required: true, options: ['PUBLIC', 'AUTHENTICATED', 'INTERNAL']}, {name: 'environments', label: t("Environments (comma separated)"), type: 'tags'},
      {name: 'enabled', label: t("Enabled"), type: 'switch', initial: false}]}}
    actions={[{label: t("Toggle"), testId: f => `flag-toggle-${f.key}`, run: f => admin.put(`/feature-flags/${f.key}`, {...f, enabled: !f.enabled})}]} />;
}

export function DiagnosticsPage() {
  const {t} = useI18n();
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null);
  const [catalog, setCatalog] = useState<{revision: number; modules: {moduleKey: string; manifestVersion: string}[]} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try { setGraph(await admin.get('/diagnostics/graph')); setCatalog(await admin.get('/runtime/catalog')); setError(null); } catch (e) { setError(errorText(e)); }
  };
  if (!graph && !error) void load();
  return (
    <Card title={t("Runtime diagnostics")} data-testid="diagnostics-page" extra={<Button onClick={() => void load()}>{t("Refresh")}</Button>}>
      {error && <Alert type="error" message={error} />}
      {graph && <Descriptions bordered size="small" items={Object.entries(graph).map(([k, v]) => ({key: k, label: k, children: <span data-testid={`graph-${k}`}>{String(v)}</span>}))} />}
      {catalog && <Descriptions style={{marginTop: 16}} bordered size="small" items={[{label: t("Runtime catalog revision"), children: catalog.revision},
        {label: t("Active modules"), children: <span data-testid="active-modules">{catalog.modules.map(m => `${m.moduleKey}@${m.manifestVersion}`).join(', ') || t('none')}</span>}]} />}
    </Card>
  );
}

interface SupersetIntegration {key: string; applicationKey: string; displayName: string; baseUrl: string; tlsRequired: boolean; credentialReference: string; resourceKey: string; enabled: boolean; healthStatus: string; revision: number}

export function SupersetPage() {
  const {t} = useI18n();
  return <EntityPage<SupersetIntegration> title={t("Superset integrations (optional)")} path="/integrations/superset" testId="superset" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Application"), dataIndex: 'applicationKey'}, {title: t("Base URL"), dataIndex: 'baseUrl'},
      {title: t("TLS"), render: (_, i) => i.tlsRequired ? <Tag color="green">{t("required")}</Tag> : <Tag color="orange">{t("not required")}</Tag>},
      {title: t("Resource"), dataIndex: 'resourceKey'}, {title: t("Health"), dataIndex: 'healthStatus', render: h => t(h)}, {title: t("Enabled"), render: (_, i) => i.enabled ? <Tag color="green">{t("on")}</Tag> : <Tag>{t("off")}</Tag>}]}
    create={{label: t("New Superset integration"), fields: [{name: 'key', label: t("Key"), required: true}, {name: 'applicationKey', label: t("Owning application"), required: true},
      {name: 'displayName', label: t("Display name"), required: true}, {name: 'baseUrl', label: t("Base URL"), required: true}, {name: 'tlsRequired', label: t("Require TLS"), type: 'switch', initial: true},
      {name: 'credentialReference', label: t("Service account reference (env:HIVE_SECRET_* or file:*)"), required: true}]}}
    actions={[{label: t("Register asset"), testId: i => `superset-asset-${i.key}`, run: async i => {
      const value = window.prompt(t("Asset as TYPE:id (DASHBOARD:12 or CHART:7)"));
      if (value) { const [assetType, assetId] = value.split(':'); await admin.post(`/integrations/superset/${i.key}/assets`, {assetType, assetId}); }
    }}, {label: t("Disable"), testId: i => `superset-disable-${i.key}`, visible: i => i.enabled, run: i => admin.put(`/integrations/superset/${i.key}`, {enabled: false, revision: i.revision})},
      {label: t("Enable"), testId: i => `superset-enable-${i.key}`, visible: i => !i.enabled, run: i => admin.put(`/integrations/superset/${i.key}`, {enabled: true, revision: i.revision})}]} />;
}

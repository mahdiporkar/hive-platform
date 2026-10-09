import {useI18n} from '../i18n';
import {useCallback, useEffect, useState} from 'react';
import {Alert, Button, Card, Checkbox, Descriptions, Input, List, Modal, Popconfirm, Radio, Select, Space, Table, Tabs, Tag, Tree, Typography} from 'antd';
import {Link, useParams} from 'react-router-dom';
import {admin, errorText, useList} from '../api';
import {EntityPage} from '../EntityPage';
import {ResourceManager, RoutesTable, useResourceTree, type RouteRef, type TreeNode} from './Resources';
import {RegisterMfeWizard, type ExistingModule, type RouteRow} from './Registration';

interface Application {key: string; displayName: string; archived: boolean; revision: number}
interface Module extends ExistingModule {archived: boolean}
interface Revision {manifestVersion: string; status: string; active: boolean; checksum: string; source: string; createdBy: string; document?: {resources?: {key: string; type: string; parentKey?: string; name: string}[]}}
interface Artifact {manifestVersion: string; contractVersion: string; runtimeVersion: string; artifactUrl: string; active: boolean; resourceManifestVersion?: string; createdAt: string;
  document: {routes?: {key: string; path: string; access: string; resource?: string; action?: string; navigation?: {label: string; order?: number}}[]; artifact?: {format?: string}; [key: string]: unknown}}
interface Change {kind: string; resourceKey: string; detail?: string}
interface Impact {resourceKey: string; action: string; subject: string; reason: string}
interface Diff {version: string; changes: Change[]; conflicts: boolean; impact: Impact[]; warnings: string[]}

const KIND_MARK: Record<string, string> = {ADDED: '+', ARCHIVED: '−', RESTORED: '+', RENAMED: '~', MOVED: '~', ACTION_ADDED: '~', ACTION_ARCHIVED: '~', CONFLICT: '!'};

export function ApplicationsPage() {
  const {t} = useI18n();
  return <EntityPage<Application> title={t("Applications")} path="/applications" testId="applications" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key', render: key => <Link to={`/applications/${key}`} data-testid={`application-link-${key}`}>{key}</Link>},
      {title: t("Name"), dataIndex: 'displayName'}, {title: t("State"), render: (_, a) => a.archived ? <Tag>{t("archived")}</Tag> : <Tag color="green">{t("active")}</Tag>}]}
    create={{label: t("New application"), fields: [{name: 'key', label: t("Key"), required: true, placeholder: 'campus'}, {name: 'displayName', label: t("Display name"), required: true}]}} />;
}

export function ApplicationDetailPage() {
  const {key = ''} = useParams();
  return <ResourceManager applicationKey={key} />;
}

export function ModulesPage() {
  const {t} = useI18n();
  const [wizard, setWizard] = useState(false);
  return <EntityPage<Module> title={t("Micro apps (modules)")} path="/modules" testId="modules" rowKey="moduleKey"
    extra={reload => <>
      <Button type="primary" data-testid="mfe-wizard-open" onClick={() => setWizard(true)}>{t('Register micro-frontend')}</Button>
      <RegisterMfeWizard open={wizard} onClose={() => setWizard(false)} onDone={() => void reload()} />
    </>}
    columns={[{title: t("Module"), dataIndex: 'moduleKey', render: key => <Link to={`/modules/${key}`} data-testid={`module-link-${key}`}>{key}</Link>},
      {title: t("Application"), dataIndex: 'applicationKey'}, {title: t("Mode"), dataIndex: 'definitionMode', render: m => t(m)},
      {title: t("Entry"), dataIndex: 'entryUrl', render: (url?: string) => url ? <Typography.Text code style={{fontSize: 12}}>{url}</Typography.Text> : '—'},
      {title: t("Active artifact"), dataIndex: 'activeArtifactVersion'}, {title: t("Active resources"), dataIndex: 'activeResourceVersion'}]}
    create={{label: t("Register module"), fields: [{name: 'applicationKey', label: t("Application"), required: true}, {name: 'moduleKey', label: t("Module key"), required: true},
      {name: 'displayName', label: t("Display name"), required: true}, {name: 'definitionMode', label: t("Definition mode"), type: 'select', options: ['MANIFEST', 'HYBRID', 'MANUAL'], initial: 'MANIFEST'},
      {name: 'mfManifestUrl', label: t("Micro-frontend manifest URL")}, {name: 'resourceManifestUrl', label: t("Resource manifest URL")}]}} />;
}

function ManifestImport({label, testId, path, onDone}: {label: string; testId: string; path: string; onDone: () => void}) {
  const {t} = useI18n();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try { await admin.post(path, JSON.parse(text)); setText(''); setError(null); onDone(); } catch (e) { setError(errorText(e)); }
  };
  return (
    <Space direction="vertical" style={{width: '100%', marginBottom: 16}}>
      <Input.TextArea data-testid={`${testId}-json`} rows={6} placeholder={t('Paste {label} JSON', {label: t(label)})} value={text} onChange={e => setText(e.target.value)} />
      <Space><Button type="primary" data-testid={`${testId}-submit`} onClick={() => void submit()} disabled={!text}>{t('Import {label}', {label: t(label)})}</Button>
        <Button data-testid={`${testId}-fetch`} onClick={async () => { try { await admin.post(`${path}/fetch`, {}); setError(null); onDone(); } catch (e) { setError(errorText(e)); } }}>{t("Fetch from registered URL")}</Button></Space>
      {error && <Alert type="error" message={error} data-testid={`${testId}-error`} />}
    </Space>
  );
}

/** Tree comparison of a resource revision with the materialized catalog, plus the grants and routes it would affect. */
function DiffView({diff, revision}: {diff: Diff; revision?: Revision}) {
  const {t} = useI18n();
  const byKey = new Map<string, Change[]>();
  diff.changes.forEach(c => byKey.set(c.resourceKey, [...(byKey.get(c.resourceKey) ?? []), c]));
  interface Item {key: string; title: string; children: Item[]}
  const resources = revision?.document?.resources ?? [];
  const keys = new Set(resources.map(r => r.key));
  const byParent = new Map<string, typeof resources>();
  resources.forEach(r => byParent.set(r.parentKey ?? '', [...(byParent.get(r.parentKey ?? '') ?? []), r]));
  const item = (r: typeof resources[number]): Item => ({key: r.key, children: (byParent.get(r.key) ?? []).map(item),
    title: `${(byKey.get(r.key) ?? []).map(c => KIND_MARK[c.kind] ?? '~').join('') || ' '} ${r.name} (${r.key})${(byKey.get(r.key) ?? []).map(c => ` · ${t(c.kind)}${c.detail ? ': ' + c.detail : ''}`).join('')}`});
  const roots = resources.filter(r => !r.parentKey || !keys.has(r.parentKey)).map(item);
  const removed = diff.changes.filter(c => c.kind === 'ARCHIVED');
  return (
    <Card size="small" title={`${t('Diff {version}', {version: diff.version})}${diff.conflicts ? ' — ' + t('conflicts') : ''}`} style={{marginTop: 12}} data-testid="diff">
      <List size="small" dataSource={diff.changes} renderItem={c => <List.Item data-testid="diff-change">{`${t(c.kind)} ${c.resourceKey}${c.detail ? ' (' + c.detail + ')' : ''}`}</List.Item>} />
      {roots.length > 0 && <><Typography.Title level={5}>{t('Resulting hierarchy')}</Typography.Title><Tree data-testid="diff-tree" defaultExpandAll treeData={roots} />
        {removed.length > 0 && <Typography.Paragraph>{removed.map(r => <Tag key={r.resourceKey} color="red">− {r.resourceKey}</Tag>)}</Typography.Paragraph>}</>}
      <Typography.Title level={5} style={{marginTop: 12}}>{t('Potential impact')}</Typography.Title>
      <Alert data-testid="diff-impact" type={diff.impact.length ? 'warning' : 'success'} showIcon
        message={diff.impact.length ? t('{count} existing grants require review', {count: String(diff.impact.length)}) : t('No existing grant is affected')}
        description={diff.impact.length ? <ul style={{margin: 0}}>{diff.impact.map((i, n) => <li key={n} data-testid="diff-impact-item">{i.subject} → {i.resourceKey} · {i.action} ({t(i.reason)})</li>)}</ul> : undefined} />
      {diff.warnings.map((w, n) => <Alert key={n} type="warning" showIcon style={{marginTop: 8}} data-testid="diff-warning" message={w} />)}
    </Card>
  );
}

/** Binds a route to a resource by registering a new artifact version: active artifact revisions are never changed in place. */
function BindRouteModal({module, route, artifact, nodes, onClose, onDone}: {module: Module; route: RouteRef; artifact: Artifact; nodes: TreeNode[]; onClose: () => void; onDone: () => Promise<void>}) {
  const {t} = useI18n();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [resource, setResource] = useState<string | undefined>(route.resourceKey);
  const [action, setAction] = useState<string>(route.action ?? 'view');
  const [access, setAccess] = useState(route.access === 'PUBLIC' ? 'AUTHENTICATED' : route.access);
  const [newKey, setNewKey] = useState(`${module.moduleKey}.${route.routeKey}`);
  const [newName, setNewName] = useState(route.navigationLabel ?? route.routeKey);
  const [version, setVersion] = useState(() => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(artifact.manifestVersion); return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : ''; });
  const [activate, setActivate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const node = nodes.find(n => n.key === resource);
  const save = async () => {
    try {
      let key = resource;
      if (mode === 'new') {
        const parent = nodes.find(n => n.key === module.moduleKey && !n.archived)?.key ?? module.applicationKey;
        await admin.post(`/applications/${module.applicationKey}/resources`, {key: newKey, type: 'PAGE', parentKey: parent, displayName: newName, actions: [{key: action}]});
        key = newKey;
      }
      const document = structuredClone(artifact.document);
      document.manifestVersion = version;
      document.routes = (document.routes ?? []).map(r => r.key === route.routeKey ? {...r, access, resource: key, action} : r);
      await admin.post(`/modules/${module.moduleKey}/artifacts`, document);
      if (activate) await admin.post(`/modules/${module.moduleKey}/artifacts/${version}/activate`);
      await onDone();
    } catch (e) { setError(errorText(e)); }
  };
  return (
    <Modal open title={t('Bind route {route} to a resource', {route: route.routeKey})} onCancel={onClose} onOk={() => void save()} okText={t('Save as new version')}
      okButtonProps={{'data-testid': 'bind-save'}}>
      <Space direction="vertical" style={{width: '100%'}}>
        <Radio.Group value={mode} onChange={e => setMode(e.target.value)} options={[{value: 'existing', label: t('Existing resource')}, {value: 'new', label: t('New manual resource'), disabled: module.definitionMode === 'MANIFEST'}]} />
        {mode === 'existing'
          ? <Select data-testid="bind-resource" showSearch style={{width: '100%'}} value={resource} onChange={setResource} optionFilterProp="label"
            options={nodes.filter(n => !n.archived && n.type !== 'APPLICATION').map(n => ({value: n.key, label: `${n.displayName} (${n.key})`}))} />
          : <Space wrap><Input data-testid="bind-new-key" value={newKey} onChange={e => setNewKey(e.target.value)} /><Input data-testid="bind-new-name" value={newName} onChange={e => setNewName(e.target.value)} /></Space>}
        <Space wrap>
          <Select data-testid="bind-action" style={{width: 160}} value={action} onChange={setAction}
            options={(mode === 'existing' && node ? ['manage', ...node.actions.filter(a => !a.archived).map(a => a.key)] : ['view', 'edit', 'export']).map(a => ({value: a, label: a}))} />
          <Select style={{width: 180}} value={access} onChange={setAccess} options={['HYBRID', 'AUTHENTICATED'].map(a => ({value: a, label: t(a)}))} />
          <Input data-testid="bind-version" style={{width: 120}} value={version} onChange={e => setVersion(e.target.value)} addonBefore={t('Version')} />
        </Space>
        <Checkbox checked={activate} onChange={e => setActivate(e.target.checked)}>{t('Activate the new version')}</Checkbox>
        {error && <Alert type="error" message={error} data-testid="bind-error" />}
      </Space>
    </Modal>
  );
}

export function ModuleDetailPage() {
  const {t} = useI18n();
  const {key = ''} = useParams();
  const [module, setModule] = useState<Module | null>(null);
  const revisions = useList<Revision>(`/modules/${key}/resource-manifests`);
  const artifacts = useList<Artifact>(`/modules/${key}/artifacts`);
  const releases = useList<{action: string; resourceVersion?: string; artifactVersion?: string; actor: string; occurredAt: string}>(`/modules/${key}/releases`);
  const routes = useList<RouteRef>(`/modules/${key}/routes`);
  const {tree, reload: reloadTree} = useResourceTree(module?.applicationKey ?? null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [binding, setBinding] = useState<RouteRef | null>(null);
  const loadModule = useCallback(async () => { try { setModule(await admin.get<Module>(`/modules/${key}`)); } catch (e) { setError(errorText(e)); } }, [key]);
  useEffect(() => { void loadModule(); }, [loadModule]);
  const act = async (work: () => Promise<unknown>) => {
    try { await work(); setError(null); await Promise.all([revisions.reload(), artifacts.reload(), releases.reload(), routes.reload(), loadModule(), reloadTree()]); } catch (e) { setError(errorText(e)); }
  };
  const active = artifacts.data.find(a => a.active);
  const initialRoutes: RouteRow[] = (active?.document.routes ?? []).map(r => ({key: r.key, path: r.path, access: r.access, resource: r.resource, action: r.action, label: r.navigation?.label}));
  return (
    <Card title={t('Module {key}', {key})} data-testid="module-detail" extra={module && <Space wrap>
      <Button data-testid="module-new-version" onClick={() => setWizard(true)}>{t('Change address / new version')}</Button>
      <Select data-testid="module-mode" value={module.definitionMode} style={{width: 140}} onChange={mode => void act(() => admin.put(`/modules/${key}`, {revision: module.revision, definitionMode: mode,
        mfManifestUrl: module.mfManifestUrl, resourceManifestUrl: module.resourceManifestUrl}))} options={['MANIFEST', 'HYBRID', 'MANUAL'].map(m => ({value: m, label: t(m)}))} />
      {module.activeArtifactVersion && <Popconfirm title={t('Deactivate this module? It disappears from runtime contexts and can no longer be mounted.')}
        onConfirm={() => void act(() => admin.post(`/modules/${key}/deactivate`))} okButtonProps={{'data-testid': 'module-deactivate-confirm'}}>
        <Button danger data-testid="module-deactivate">{t('Deactivate')}</Button></Popconfirm>}
    </Space>}>
      {error && <Alert type="error" message={error} data-testid="module-error" style={{marginBottom: 12}} closable onClose={() => setError(null)} />}
      {module && <Descriptions size="small" bordered column={{xs: 1, md: 3}} style={{marginBottom: 16}} data-testid="module-summary" items={[
        {key: 'app', label: t('Application'), children: <Link to={`/applications/${module.applicationKey}`}>{module.applicationKey}</Link>},
        {key: 'name', label: t('Display name'), children: module.displayName},
        {key: 'mode', label: t('Definition mode'), children: t(module.definitionMode)},
        {key: 'entry', label: t('Entry'), children: module.entryUrl ? <Typography.Text code data-testid="module-entry">{module.entryUrl}</Typography.Text> : '—'},
        {key: 'artifact', label: t('Active artifact'), children: module.activeArtifactVersion ? <Tag color="green" data-testid="module-active-artifact">{module.activeArtifactVersion}</Tag> : <Tag>{t('inactive')}</Tag>},
        {key: 'resources', label: t('Active resources'), children: module.activeResourceVersion ?? '—'},
        {key: 'environment', label: t('Environment'), children: module.environment ? t(module.environment) : '—'},
        {key: 'icon', label: t('Icon'), children: module.icon ?? '—'},
        {key: 'description', label: t('Description'), children: module.description ?? '—'},
      ]} />}
      <Tabs items={[
        {key: 'resources', label: t("Resource manifests"), children: <>
          {module?.definitionMode === 'MANUAL' && <Alert type="info" showIcon style={{marginBottom: 12}} message={t('This module is MANUAL: resources are managed in the resource tree, not by manifests.')} />}
          <ManifestImport label={t("resource manifest")} testId="resource-manifest" path={`/modules/${key}/resource-manifests`} onDone={() => void revisions.reload()} />
          <Table<Revision> data-testid="revisions-table" size="small" rowKey="manifestVersion" dataSource={revisions.data} pagination={false} columns={[
            {title: t("Version"), dataIndex: 'manifestVersion'}, {title: t("Status"), render: (_, r) => <Space><Tag color={r.status === 'PUBLISHED' ? 'blue' : 'gold'}>{t(r.status)}</Tag>{r.active && <Tag color="green">{t("active")}</Tag>}</Space>},
            {title: t("Source"), dataIndex: 'source', render: source => t(source)}, {title: t("Checksum"), render: (_, r) => r.checksum.slice(0, 12)},
            {title: t("Actions"), render: (_, r) => <Space>
              <Button size="small" data-testid={`diff-${r.manifestVersion}`} onClick={() => void act(async () => setDiff({version: r.manifestVersion, ...(await admin.get<Omit<Diff, 'version'>>(`/modules/${key}/resource-manifests/${r.manifestVersion}/diff`))}))}>{t("Diff")}</Button>
              {r.status === 'DRAFT' && <Button size="small" type="primary" data-testid={`publish-${r.manifestVersion}`} onClick={() => void act(() => admin.post(`/modules/${key}/resource-manifests/${r.manifestVersion}/publish`))}>{t("Publish")}</Button>}
              {r.status === 'DRAFT' && <Button size="small" data-testid={`discard-${r.manifestVersion}`} onClick={() => void act(() => admin.delete(`/modules/${key}/resource-manifests/${r.manifestVersion}`))}>{t("Discard")}</Button>}
              {r.status === 'PUBLISHED' && !r.active && <Button size="small" data-testid={`activate-${r.manifestVersion}`} onClick={() => void act(() => admin.post(`/modules/${key}/resource-manifests/${r.manifestVersion}/activate`))}>{t("Activate (rollback)")}</Button>}
            </Space>}]} />
          {diff && <DiffView diff={diff} revision={revisions.data.find(r => r.manifestVersion === diff.version)} />}
        </>},
        {key: 'artifacts', label: t("Artifacts"), children: <>
          <ManifestImport label={t("micro-frontend manifest")} testId="mf-manifest" path={`/modules/${key}/artifacts`} onDone={() => void artifacts.reload()} />
          <Table<Artifact> data-testid="artifacts-table" size="small" rowKey="manifestVersion" dataSource={artifacts.data} pagination={false} columns={[
            {title: t("Version"), dataIndex: 'manifestVersion'}, {title: t("Format"), render: (_, a) => t(String(a.document.artifact?.format ?? 'ES_MODULE'))},
            {title: t("Contract"), dataIndex: 'contractVersion'}, {title: t("Runtime"), dataIndex: 'runtimeVersion'},
            {title: t("Resources"), dataIndex: 'resourceManifestVersion'}, {title: t("URL"), dataIndex: 'artifactUrl'},
            {title: t("Actions"), render: (_, a) => a.active ? <Tag color="green">{t("active")}</Tag> : <Button size="small" type="primary" data-testid={`activate-artifact-${a.manifestVersion}`}
              onClick={() => void act(() => admin.post(`/modules/${key}/artifacts/${a.manifestVersion}/activate`))}>{active && a.createdAt < active.createdAt ? t("Roll back") : t("Activate")}</Button>}]} />
        </>},
        {key: 'tree', label: <span data-testid="module-tree-tab">{t('Resource tree')}</span>, children: module ? <ResourceManager applicationKey={module.applicationKey} moduleKey={key} testId="module-resource-tree" title={t('Resource tree')} /> : null},
        {key: 'routes', label: <span data-testid="module-routes-tab">{t('Routes')}</span>, children: <>
          <Alert type="info" showIcon style={{marginBottom: 12}} message={t('Navigation routes of the active artifact and the resources they require. Backend API routes are configured separately under Proxy routes.')} />
          {routes.error && <Alert type="error" message={routes.error} />}
          <RoutesTable routes={routes.data} extra={r => active && tree ? <Button size="small" data-testid={`bind-${r.routeKey}`} onClick={() => setBinding(r)}>{t('Bind resource')}</Button> : null} />
        </>},
        {key: 'releases', label: t("Release history"), children: <Table data-testid="releases-table" size="small" rowKey={(_, i) => String(i)} dataSource={releases.data} pagination={false}
          columns={[{title: t("Action"), dataIndex: 'action', render: a => t(a)}, {title: t("Resources"), dataIndex: 'resourceVersion'}, {title: t("Artifact"), dataIndex: 'artifactVersion'}, {title: t("Actor"), dataIndex: 'actor'}, {title: t("When"), dataIndex: 'occurredAt'}]} />},
      ]} />
      <Descriptions size="small" style={{marginTop: 12}} items={[{label: t("Tip"), children: t("Publishing materializes the resource tree; activating an artifact also activates the resource revision it names.")}]} />
      {module && <RegisterMfeWizard open={wizard} existing={module} initialRoutes={initialRoutes} onClose={() => setWizard(false)} onDone={() => void act(async () => undefined)} />}
      {binding && module && active && tree && <BindRouteModal module={module} route={binding} artifact={active} nodes={tree.resources} onClose={() => setBinding(null)}
        onDone={async () => { setBinding(null); await act(async () => undefined); }} />}
    </Card>
  );
}

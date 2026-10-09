import {useI18n} from '../i18n';
import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {Alert, Badge, Button, Card, Checkbox, Col, Descriptions, Drawer, Empty, Form, Input, Popconfirm, Row, Select, Space, Switch, Table, Tabs, Tag, Tree, Typography, message} from 'antd';
import {Link} from 'react-router-dom';
import {admin, errorText, useList} from '../api';

export interface ActionView {key: string; description?: string; archived: boolean}
export interface RouteRef {moduleKey: string; artifactVersion: string; routeKey: string; path: string; access: string; resourceKey?: string; action?: string; navigation: boolean; navigationLabel?: string; status: string}
export interface TreeNode {id: string; key: string; type: string; parentKey?: string; displayName: string; origin: string; ownerModuleKey?: string; ownerDefinitionMode?: string;
  manifestVersion?: string; archived: boolean; revision: number; actions: ActionView[]; grantCount: number; editability: string; allowedChildTypes: string[]; routes: RouteRef[]}
interface ModuleSummary {moduleKey: string; displayName: string; definitionMode: string; activeArtifactVersion?: string; activeResourceVersion?: string; archived: boolean; entryUrl?: string}
export interface ResourceTreeView {applicationKey: string; modules: ModuleSummary[]; resources: TreeNode[]; routes: RouteRef[]; unreferencedPages: string[]}
interface ResourceGrant {grantId: string; subject: string; subjectType: string; subjectName: string; resourceKey: string; action: string; inherited: boolean; createdAt: string}
interface ResourceAccess {actions: string[]; ancestry: string[]; direct: ResourceGrant[]; inheritedManage: ResourceGrant[]}
interface Decision {action: string; allowed: boolean; reason: string}
interface AccessPath {action: string; kind: string; via?: string; grantSubject: string; grantResourceKey: string}
interface Inspection {userName: string; active: boolean; groups: string[]; roles: string[]; decisions: Decision[]; paths: AccessPath[]}

const TYPE_ICON: Record<string, string> = {APPLICATION: '◆', MODULE: '▦', PAGE: '▤', UI_COMPONENT: '◫', FIELD: '▥', BUSINESS_RESOURCE: '●', EXTERNAL_RESOURCE: '↗',
  API_RESOURCE: '⌁', DATA_RESOURCE: '▱', DATA_GOVERNANCE_RESOURCE: '◇'};
const TYPE_COLOR: Record<string, string> = {APPLICATION: 'purple', MODULE: 'geekblue', PAGE: 'blue', UI_COMPONENT: 'cyan', FIELD: 'red', BUSINESS_RESOURCE: 'gold',
  EXTERNAL_RESOURCE: 'magenta', API_RESOURCE: 'volcano', DATA_RESOURCE: 'lime', DATA_GOVERNANCE_RESOURCE: 'orange'};
const ORIGIN_COLOR: Record<string, string> = {SYSTEM: 'default', MANIFEST: 'blue', MANUAL: 'purple'};
export const RESOURCE_TYPES = Object.keys(TYPE_ICON).filter(t => t !== 'APPLICATION');

export function useResourceTree(applicationKey: string | null) {
  const [tree, setTree] = useState<ResourceTreeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!applicationKey) return;
    try { setTree(await admin.get<ResourceTreeView>(`/applications/${applicationKey}/resource-tree?includeArchived=true`)); setError(null); } catch (e) { setError(errorText(e)); }
  }, [applicationKey]);
  useEffect(() => { setTree(null); void reload(); }, [reload]);
  return {tree, error, reload};
}

/** Keys of a module's resources: nodes it owns, manual nodes below them, and the ancestors that connect them to the root. */
function moduleScope(nodes: TreeNode[], moduleKey: string): Set<string> {
  const byParent = new Map<string, TreeNode[]>();
  nodes.forEach(n => n.parentKey && byParent.set(n.parentKey, [...(byParent.get(n.parentKey) ?? []), n]));
  const scope = new Set<string>();
  const visit = (n: TreeNode) => { if (scope.has(n.key)) return; scope.add(n.key); (byParent.get(n.key) ?? []).forEach(visit); };
  nodes.filter(n => n.ownerModuleKey === moduleKey || (n.type === 'MODULE' && n.key === moduleKey)).forEach(visit);
  return withAncestors(nodes, scope);
}

function withAncestors(nodes: TreeNode[], keys: Set<string>): Set<string> {
  const byKey = new Map(nodes.map(n => [n.key, n]));
  const result = new Set(keys);
  for (const key of keys) for (let p = byKey.get(key)?.parentKey; p && !result.has(p); p = byKey.get(p)?.parentKey) result.add(p);
  return result;
}

/**
 * Visual resource hierarchy of one application (optionally scoped to one module), backed by the persisted catalog:
 * search and filters, details with routes, governance-aware editing, per-resource grants and access inspection.
 */
export function ResourceManager({applicationKey, moduleKey, testId = 'resources-page', title}: {applicationKey: string; moduleKey?: string; testId?: string; title?: ReactNode}) {
  const {t} = useI18n();
  const {tree, error, reload} = useResourceTree(applicationKey);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [originFilter, setOriginFilter] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const [editor, setEditor] = useState<{mode: 'create' | 'edit'; parent?: TreeNode; node?: TreeNode} | null>(null);
  const nodes = useMemo(() => tree?.resources ?? [], [tree]);
  const byKey = useMemo(() => new Map(nodes.map(n => [n.key, n])), [nodes]);
  const visible = useMemo(() => {
    let candidates = nodes.filter(n => showArchived || !n.archived);
    if (moduleKey) { const scope = moduleScope(nodes, moduleKey); candidates = candidates.filter(n => scope.has(n.key)); }
    const q = query.trim().toLowerCase();
    const filtered = q || typeFilter.length || originFilter.length;
    if (!filtered) return new Set(candidates.map(n => n.key));
    const matches = candidates.filter(n => (!q || `${n.key} ${n.displayName}`.toLowerCase().includes(q))
      && (!typeFilter.length || typeFilter.includes(n.type)) && (!originFilter.length || originFilter.includes(n.origin)));
    return withAncestors(nodes, new Set(matches.map(n => n.key)));
  }, [nodes, moduleKey, query, typeFilter, originFilter, showArchived]);
  interface Item {key: string; title: ReactNode; children: Item[]}
  const treeData = useMemo(() => {
    const byParent = new Map<string | null, TreeNode[]>();
    nodes.filter(n => visible.has(n.key)).forEach(n => byParent.set(n.parentKey ?? null, [...(byParent.get(n.parentKey ?? null) ?? []), n]));
    const item = (n: TreeNode): Item => ({key: n.key, children: (byParent.get(n.key) ?? []).map(item), title: <Space size={6} data-testid={`resource-node-${n.key}`}>
      <span style={{color: 'var(--ant-color-text-secondary)'}}>{TYPE_ICON[n.type] ?? '•'}</span>
      <span>{n.displayName}</span>
      <Typography.Text type="secondary" style={{fontSize: 12}}>({n.key} · {t(n.type)}{n.ownerModuleKey ? ' · ' + n.ownerModuleKey : ''})</Typography.Text>
      {n.origin !== 'SYSTEM' && <Tag color={ORIGIN_COLOR[n.origin]} style={{marginInlineEnd: 0}}>{t(n.origin)}</Tag>}
      {n.manifestVersion && <Tag style={{marginInlineEnd: 0}}>v{n.manifestVersion}</Tag>}
      {n.archived && <Tag>{t('archived')}</Tag>}
      {n.grantCount > 0 && <Badge count={n.grantCount} color="green" title={t('Active grants')} />}
      {n.routes.length > 0 && <Tag color="cyan" style={{marginInlineEnd: 0}}>⇢ {n.routes.length}</Tag>}
    </Space>});
    return (byParent.get(null) ?? []).map(item);
  }, [nodes, visible, t]);
  const defaultExpanded = useMemo(() => {
    const depth = (key: string): number => { let d = 0; for (let p = byKey.get(key)?.parentKey; p; p = byKey.get(p)?.parentKey) d++; return d; };
    return nodes.filter(n => visible.has(n.key) && (depth(n.key) < 2 || query || typeFilter.length || originFilter.length)).map(n => n.key);
  }, [nodes, visible, byKey, query, typeFilter, originFilter]);
  const selected = selectedKey ? byKey.get(selectedKey) ?? null : null;
  const module = moduleKey ? tree?.modules.find(m => m.moduleKey === moduleKey) : undefined;
  const rootKey = nodes.find(n => n.type === 'APPLICATION')?.key;
  const canAddRoot = !moduleKey || module?.definitionMode !== 'MANIFEST';
  return (
    <Card title={title ?? t('Resource catalog: {key}', {key: applicationKey})} data-testid={testId}
      extra={<Space>
        {canAddRoot && rootKey && <Button type="primary" data-testid="resource-create" onClick={() => setEditor({mode: 'create', parent: moduleKey ? byKey.get(moduleKey) ?? byKey.get(rootKey) : byKey.get(rootKey)})}>{t('New resource')}</Button>}
        <Button data-testid="resource-tree-refresh" onClick={() => void reload()}>{t('Refresh')}</Button>
      </Space>}>
      {error && <Alert type="error" message={error} style={{marginBottom: 12}} />}
      {moduleKey && module && <Alert style={{marginBottom: 12}} type={module.definitionMode === 'MANIFEST' ? 'info' : 'success'} showIcon
        message={t('Definition mode: {mode}', {mode: t(module.definitionMode)})}
        description={t(module.definitionMode === 'MANIFEST' ? 'Resources come only from the published resource manifest; change them by importing and publishing a new revision.'
          : module.definitionMode === 'HYBRID' ? 'Manifest resources come from the published revision; manual resources can extend the tree and survive manifest updates.'
          : 'All resources are defined manually in this tree.')} />}
      <Row gutter={16}>
        <Col xs={24} lg={11}>
          <Space direction="vertical" style={{width: '100%'}} size={8}>
            <Input.Search allowClear data-testid="resource-search" placeholder={t('Search name or key')} onChange={e => setQuery(e.target.value)} />
            <Space wrap>
              <Select mode="multiple" allowClear data-testid="resource-type-filter" style={{minWidth: 200}} placeholder={t('Type')} value={typeFilter} onChange={setTypeFilter}
                options={Object.keys(TYPE_ICON).map(v => ({value: v, label: `${TYPE_ICON[v]} ${t(v)}`}))} />
              <Select mode="multiple" allowClear data-testid="resource-origin-filter" style={{minWidth: 160}} placeholder={t('Origin')} value={originFilter} onChange={setOriginFilter}
                options={['SYSTEM', 'MANIFEST', 'MANUAL'].map(v => ({value: v, label: t(v)}))} />
              <Space><Switch size="small" checked={showArchived} onChange={setShowArchived} data-testid="resource-show-archived" />{t('Show archived')}</Space>
            </Space>
            {tree && treeData.length === 0 ? <Empty description={t('No resources match')} /> :
              <Tree data-testid="resource-tree" showLine blockNode treeData={treeData} selectedKeys={selectedKey ? [selectedKey] : []}
                expandedKeys={expanded ?? defaultExpanded} onExpand={keys => setExpanded(keys.map(String))}
                onSelect={keys => keys.length && setSelectedKey(String(keys[0]))} key={`${query}|${typeFilter}|${originFilter}|${showArchived}`} />}
            {tree && !moduleKey && tree.unreferencedPages.length > 0 && <Alert type="warning" showIcon data-testid="unreferenced-pages"
              message={t('Pages not referenced by any active route')} description={tree.unreferencedPages.join(', ')} />}
          </Space>
        </Col>
        <Col xs={24} lg={13}>
          {selected ? <ResourceDetails applicationKey={applicationKey} node={selected} byKey={byKey} nodes={nodes} onChanged={reload}
            onSelect={setSelectedKey} onEdit={() => setEditor({mode: 'edit', node: selected})} onAddChild={() => setEditor({mode: 'create', parent: selected})} />
            : <Empty data-testid="resource-empty" description={t('Select a resource to see its details, routes and access')} />}
        </Col>
      </Row>
      {editor && <ResourceEditor applicationKey={applicationKey} mode={editor.mode} parent={editor.parent} node={editor.node} nodes={nodes}
        onClose={() => setEditor(null)} onSaved={async key => { setEditor(null); await reload(); setSelectedKey(key); }} />}
    </Card>
  );
}

function ResourceDetails({applicationKey, node, byKey, nodes, onChanged, onSelect, onEdit, onAddChild}: {applicationKey: string; node: TreeNode; byKey: Map<string, TreeNode>; nodes: TreeNode[];
  onChanged: () => Promise<void>; onSelect: (key: string) => void; onEdit: () => void; onAddChild: () => void}) {
  const {t} = useI18n();
  const [error, setError] = useState<string | null>(null);
  const ancestry: TreeNode[] = [];
  for (let p = node.parentKey ? byKey.get(node.parentKey) : undefined; p && ancestry.length < 50; p = p.parentKey ? byKey.get(p.parentKey) : undefined) ancestry.unshift(p);
  const descendants = useMemo(() => {
    const result: TreeNode[] = [];
    const visit = (key: string) => nodes.filter(n => n.parentKey === key).forEach(n => { result.push(n); visit(n.key); });
    visit(node.key);
    return result;
  }, [nodes, node.key]);
  const archive = async (archived: boolean) => {
    try { await admin.post(`/applications/${applicationKey}/resources/${node.key}/archive`, {archived, revision: node.revision}); setError(null); await onChanged(); void message.success(t('Done')); }
    catch (e) { setError(errorText(e)); }
  };
  const manual = node.editability === 'MANUAL';
  const canAddChild = !node.archived && node.editability !== 'MANIFEST_LOCKED' && node.allowedChildTypes.length > 0;
  return (
    <Card size="small" data-testid="resource-details" title={<Space><Tag color={TYPE_COLOR[node.type]}>{TYPE_ICON[node.type]} {t(node.type)}</Tag><span data-testid="resource-details-name">{node.displayName}</span>
      <Tag color={ORIGIN_COLOR[node.origin]}>{t(node.origin)}</Tag>{node.archived && <Tag>{t('archived')}</Tag>}</Space>}
      extra={<Space wrap>
        {canAddChild && <Button size="small" data-testid="resource-add-child" onClick={onAddChild}>{t('Add child')}</Button>}
        {manual && !node.archived && <Button size="small" data-testid="resource-edit" onClick={onEdit}>{t('Edit')}</Button>}
        {manual && (node.archived
          ? <Button size="small" data-testid="resource-restore" onClick={() => void archive(false)}>{t('Restore')}</Button>
          : <Popconfirm title={node.grantCount > 0 ? t('{count} active grants on this resource will stop being effective. Archive?', {count: String(node.grantCount)}) : t('Archive this resource?')}
              onConfirm={() => void archive(true)} okButtonProps={{'data-testid': 'resource-archive-confirm'}}>
              <Button size="small" danger data-testid="resource-archive">{t('Archive')}</Button></Popconfirm>)}
      </Space>}>
      {error && <Alert type="error" message={error} data-testid="resource-error" style={{marginBottom: 12}} closable onClose={() => setError(null)} />}
      {node.editability === 'MANIFEST_LOCKED' && <Alert type="info" showIcon style={{marginBottom: 12}} message={t('Owned by the published resource manifest of module {module}. Change it by importing and publishing a new manifest revision.', {module: node.ownerModuleKey ?? ''})}
        action={node.ownerModuleKey && <Link to={`/modules/${node.ownerModuleKey}`}>{t('Open module')}</Link>} />}
      {node.editability === 'MANIFEST_EXTENSIBLE' && <Alert type="info" showIcon style={{marginBottom: 12}} message={t('Manifest-owned (HYBRID module): its fields change through a new manifest revision; manual children can be added.')} />}
      <Tabs size="small" items={[
        {key: 'details', label: t('Details'), children: <>
          <Descriptions size="small" column={1} bordered items={[
            {key: 'key', label: t('Key'), children: <Typography.Text copyable code data-testid="resource-details-key">{node.key}</Typography.Text>},
            {key: 'parent', label: t('Ancestry'), children: <Space wrap size={4}>{ancestry.length ? ancestry.map(a => <Tag key={a.key} style={{cursor: 'pointer'}} onClick={() => onSelect(a.key)}>{a.displayName}</Tag>) : '—'}</Space>},
            {key: 'owner', label: t('Owner module'), children: node.ownerModuleKey ? <Link to={`/modules/${node.ownerModuleKey}`}>{node.ownerModuleKey}</Link> : '—'},
            {key: 'mode', label: t('Definition mode'), children: node.ownerDefinitionMode ? t(node.ownerDefinitionMode) : '—'},
            {key: 'revision', label: t('Manifest revision'), children: node.manifestVersion ?? '—'},
            {key: 'status', label: t('Status'), children: node.archived ? t('archived') : t('active')},
            {key: 'descendants', label: t('Descendants'), children: descendants.length ? <Space wrap size={4}>{descendants.slice(0, 20).map(d => <Tag key={d.key} style={{cursor: 'pointer'}} onClick={() => onSelect(d.key)}>{d.displayName}</Tag>)}{descendants.length > 20 && `+${descendants.length - 20}`}</Space> : '0'},
            {key: 'children', label: t('Allowed child types'), children: node.allowedChildTypes.map(c => t(c)).join(', ') || '—'},
            {key: 'grants', label: t('Active grants'), children: String(node.grantCount)},
          ]} />
          <Typography.Title level={5} style={{marginTop: 16}}>{t('Available actions')}</Typography.Title>
          <Space wrap data-testid="resource-actions"><Tag color="purple" title={t('Implicit on every resource; inherited by descendants')}>manage</Tag>
            {node.actions.map(a => <Tag key={a.key} color={a.archived ? undefined : 'blue'} data-testid={`resource-action-${a.key}`} title={a.description}>{a.key}{a.archived ? ` (${t('archived')})` : ''}</Tag>)}</Space>
          <Typography.Title level={5} style={{marginTop: 16}}>{t('Routes')}</Typography.Title>
          {node.routes.length ? <RoutesTable routes={node.routes} /> : <Typography.Text type="secondary">{t('No active route references this resource.')}</Typography.Text>}
        </>},
        {key: 'access', label: <span data-testid="resource-access-tab">{t('Access')}</span>, children: <ResourceAccessPanel applicationKey={applicationKey} node={node} onChanged={onChanged} />},
        {key: 'inspect', label: <span data-testid="resource-inspect-tab">{t('Effective permissions')}</span>, children: <AccessInspector applicationKey={applicationKey} resourceKey={node.key} />},
      ]} />
    </Card>
  );
}

export function RoutesTable({routes, extra}: {routes: RouteRef[]; extra?: (route: RouteRef) => ReactNode}) {
  const {t} = useI18n();
  const color = (status: string) => status === 'OK' ? 'green' : status === 'NO_RESOURCE' ? 'gold' : 'red';
  return <Table<RouteRef> size="small" data-testid="routes-table" rowKey={r => `${r.moduleKey}:${r.routeKey}`} dataSource={routes} pagination={false} columns={[
    {title: t('Route'), render: (_, r) => <Space direction="vertical" size={0}><strong>{r.routeKey}</strong><Typography.Text code>{r.path}</Typography.Text></Space>},
    {title: t('Module'), dataIndex: 'moduleKey'}, {title: t('Access'), dataIndex: 'access', render: a => t(a)},
    {title: t('Resource'), render: (_, r) => r.resourceKey ? `${r.resourceKey} · ${r.action}` : '—'},
    {title: t('Navigation'), render: (_, r) => r.navigation ? <Tag color="blue">{r.navigationLabel}</Tag> : <Tag>{t('hidden')}</Tag>},
    {title: t('Status'), dataIndex: 'status', render: (s: string, r) => <Tag color={color(s)} data-testid={`route-status-${r.routeKey}`}>{t(s)}</Tag>},
    ...(extra ? [{title: t('Actions'), render: (_: unknown, r: RouteRef) => extra(r)}] : []),
  ]} />;
}

function ResourceEditor({applicationKey, mode, parent, node, nodes, onClose, onSaved}: {applicationKey: string; mode: 'create' | 'edit'; parent?: TreeNode; node?: TreeNode; nodes: TreeNode[];
  onClose: () => void; onSaved: (key: string) => Promise<void>}) {
  const {t} = useI18n();
  const [form] = Form.useForm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parentKey = Form.useWatch('parentKey', form) as string | undefined;
  const parentNode = nodes.find(n => n.key === (parentKey ?? parent?.key ?? node?.parentKey));
  const types = mode === 'edit' ? [node!.type] : parentNode?.allowedChildTypes ?? RESOURCE_TYPES;
  const parents = nodes.filter(n => !n.archived && n.editability !== 'MANIFEST_LOCKED' && n.key !== node?.key && (mode === 'create' || n.allowedChildTypes.includes(node!.type)));
  const save = async (values: {key: string; type: string; parentKey: string; displayName: string; actions?: string[]}) => {
    const actions = (values.actions ?? []).map(key => ({key, description: node?.actions.find(a => a.key === key)?.description}));
    const removed = node?.actions.filter(a => !a.archived && !(values.actions ?? []).includes(a.key)).map(a => a.key) ?? [];
    if (removed.length && node && node.grantCount > 0 && !window.confirm(t('Removing actions {actions} archives them; grants on them stop being effective. Continue?', {actions: removed.join(', ')}))) return;
    setBusy(true);
    try {
      if (mode === 'create') await admin.post(`/applications/${applicationKey}/resources`, {key: values.key, type: values.type, parentKey: values.parentKey, displayName: values.displayName, actions});
      else await admin.put(`/applications/${applicationKey}/resources/${node!.key}`, {type: node!.type, parentKey: values.parentKey, displayName: values.displayName, actions, revision: node!.revision});
      await onSaved(mode === 'create' ? values.key : node!.key);
      void message.success(t('Done'));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Drawer open width={520} title={t(mode === 'create' ? 'New resource' : 'Edit resource')} onClose={onClose} destroyOnHidden
      extra={<Button type="primary" loading={busy} data-testid="resource-editor-save" onClick={() => form.submit()}>{t('Save')}</Button>}>
      <Form form={form} layout="vertical" onFinish={save} initialValues={mode === 'edit'
        ? {key: node!.key, type: node!.type, parentKey: node!.parentKey, displayName: node!.displayName, actions: node!.actions.filter(a => !a.archived).map(a => a.key)}
        : {parentKey: parent?.key, type: parent?.allowedChildTypes.includes('PAGE') ? 'PAGE' : parent?.allowedChildTypes[0], actions: ['view']}}>
        <Form.Item name="key" label={t('Key')} rules={[{required: true, message: t('Required field')}, {pattern: /^[a-z][a-z0-9._-]{0,159}$/, message: t('Lowercase letters, digits, dot, dash or underscore')}]}
          extra={mode === 'create' ? t('Keys are stable identifiers and cannot be changed later.') : undefined}>
          <Input data-testid="resource-editor-key" disabled={mode === 'edit'} placeholder={parent ? `${parent.key}.` : ''} />
        </Form.Item>
        <Form.Item name="type" label={t('Type')} rules={[{required: true, message: t('Required field')}]}>
          <Select data-testid="resource-editor-type" disabled={mode === 'edit'} options={types.map(v => ({value: v, label: `${TYPE_ICON[v] ?? ''} ${t(v)}`}))} />
        </Form.Item>
        <Form.Item name="parentKey" label={t('Parent')} rules={[{required: true, message: t('Required field')}]}>
          <Select data-testid="resource-editor-parent" showSearch optionFilterProp="label" options={parents.map(p => ({value: p.key, label: `${p.displayName} (${p.key})`}))} />
        </Form.Item>
        <Form.Item name="displayName" label={t('Display name')} rules={[{required: true, message: t('Required field')}]}>
          <Input data-testid="resource-editor-displayName" />
        </Form.Item>
        <Form.Item name="actions" label={t('Actions')} extra={t("'manage' is implicit on every resource and is inherited by descendants.")}>
          <Select data-testid="resource-editor-actions" mode="tags" tokenSeparators={[',', ' ']} options={['view', 'create', 'edit', 'delete', 'export', 'print', 'download', 'approve'].map(v => ({value: v, label: v}))} />
        </Form.Item>
        {error && <Alert type="error" message={error} data-testid="resource-editor-error" />}
      </Form>
    </Drawer>
  );
}

type SubjectKind = 'user' | 'group' | 'role';

function ResourceAccessPanel({applicationKey, node, onChanged}: {applicationKey: string; node: TreeNode; onChanged: () => Promise<void>}) {
  const {t} = useI18n();
  const [access, setAccess] = useState<ResourceAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<SubjectKind>('role');
  const [subject, setSubject] = useState<string | undefined>();
  const [actions, setActions] = useState<string[]>([]);
  const subjects = useSubjects(kind);
  const load = useCallback(async () => {
    try { setAccess(await admin.get<ResourceAccess>(`/applications/${applicationKey}/resources/${node.key}/access`)); setError(null); } catch (e) { setError(errorText(e)); }
  }, [applicationKey, node.key]);
  useEffect(() => { setAccess(null); setActions([]); void load(); }, [load]);
  const grant = async () => {
    if (!subject || !actions.length) return;
    try {
      for (const action of actions) await admin.post('/grants', {subject: `${kind}:${subject}`, applicationKey, resourceKey: node.key, action});
      setActions([]); setError(null); await load(); await onChanged(); void message.success(t('Done'));
    } catch (e) { setError(errorText(e)); await load(); }
  };
  const revoke = async (id: string) => { try { await admin.delete(`/grants/${id}`); await load(); await onChanged(); } catch (e) { setError(errorText(e)); } };
  const holders = useMemo(() => {
    const map = new Map<string, {subject: string; name: string; type: string; grants: ResourceGrant[]}>();
    access?.direct.forEach(g => { const row = map.get(g.subject) ?? {subject: g.subject, name: g.subjectName, type: g.subjectType, grants: []}; row.grants.push(g); map.set(g.subject, row); });
    return [...map.values()];
  }, [access]);
  if (node.archived) return <Alert type="warning" message={t('Archived resources cannot receive grants.')} />;
  return (
    <Space direction="vertical" style={{width: '100%'}} size={12} data-testid="resource-access">
      {error && <Alert type="error" message={error} data-testid="resource-access-error" closable onClose={() => setError(null)} />}
      <Card size="small" title={t('Grant access')}>
        <Space wrap>
          <Select data-testid="grant-subject-kind" value={kind} style={{width: 120}} onChange={v => { setKind(v); setSubject(undefined); }}
            options={[{value: 'user', label: t('User')}, {value: 'group', label: t('Group')}, {value: 'role', label: t('Role')}]} />
          <Select data-testid="grant-subject" showSearch optionFilterProp="label" style={{minWidth: 240}} placeholder={t('Choose a subject')} value={subject} onChange={setSubject}
            options={subjects.map(s => ({value: s.value, label: s.label}))} />
        </Space>
        <div style={{marginTop: 12}}>
          <Checkbox.Group data-testid="grant-actions" value={actions} onChange={v => setActions(v as string[])}
            options={(access?.actions ?? []).map(a => ({value: a, label: <span data-testid={`grant-action-${a}`}>{a}</span>}))} />
        </div>
        <Button type="primary" style={{marginTop: 12}} disabled={!subject || !actions.length} data-testid="grant-submit" onClick={() => void grant()}>{t('Grant')}</Button>
      </Card>
      <Card size="small" title={t('Direct assignments')}>
        <Table size="small" data-testid="resource-grants" rowKey="subject" pagination={false} dataSource={holders} locale={{emptyText: t('No direct grants')}} columns={[
          {title: t('Subject'), render: (_, h) => <Space><Tag>{t(h.type)}</Tag><span>{h.name}</span><Typography.Text type="secondary">{h.subject}</Typography.Text></Space>},
          {title: t('Actions'), render: (_, h) => <Space wrap>{h.grants.map(g => <Tag key={g.grantId} color="green" closable onClose={e => { e.preventDefault(); void revoke(g.grantId); }}
            data-testid={`grant-${h.subject}-${g.action}`}>{g.action}</Tag>)}</Space>},
        ]} />
      </Card>
      {access && access.inheritedManage.length > 0 && <Card size="small" title={t("Inherited 'manage' (from ancestors)")}>
        <Space wrap>{access.inheritedManage.map(g => <Tag key={g.grantId} color="purple">{g.subjectName} ← {g.resourceKey}</Tag>)}</Space>
      </Card>}
      <Typography.Text type="secondary">{t('Action grants apply to this resource only. Only manage is inherited by descendants (authorization model).')}</Typography.Text>
    </Space>
  );
}

function useSubjects(kind: SubjectKind) {
  const users = useList<{id: string; displayName: string; active: boolean}>(kind === 'user' ? '/users?limit=500' : null);
  const groups = useList<{key: string; displayName: string; archived: boolean}>(kind === 'group' ? '/groups' : null);
  const roles = useList<{key: string; displayName: string; archived: boolean}>(kind === 'role' ? '/roles' : null);
  if (kind === 'user') return users.data.filter(u => u.active).map(u => ({value: u.id, label: `${u.displayName} (${u.id.slice(0, 8)})`}));
  if (kind === 'group') return groups.data.filter(g => !g.archived).map(g => ({value: g.key, label: `${g.displayName} (${g.key})`}));
  return roles.data.filter(r => !r.archived).map(r => ({value: r.key, label: `${r.displayName} (${r.key})`}));
}

/** Server-side inspection: decisions from the authorization engine, paths from the relational source of truth. */
export function AccessInspector({applicationKey, resourceKey}: {applicationKey: string; resourceKey: string}) {
  const {t} = useI18n();
  const users = useSubjects('user');
  const [user, setUser] = useState<string | undefined>();
  const [result, setResult] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (id = user) => {
    if (!id) return;
    try { setResult(await admin.post<Inspection>('/access/inspect', {userId: id, applicationKey, resourceKey})); setError(null); } catch (e) { setError(errorText(e)); setResult(null); }
  };
  useEffect(() => { setResult(null); }, [resourceKey]);
  return (
    <Space direction="vertical" style={{width: '100%'}} data-testid="access-inspector">
      <Space wrap>
        <Select data-testid="inspect-user" showSearch optionFilterProp="label" style={{minWidth: 260}} placeholder={t('Choose a user')} value={user}
          onChange={v => { setUser(v); void run(v); }} options={users} />
        <Button data-testid="inspect-run" disabled={!user} onClick={() => void run()}>{t('Inspect')}</Button>
      </Space>
      {error && <Alert type="error" message={error} />}
      {result && <>
        <Descriptions size="small" column={1} items={[
          {key: 'user', label: t('User'), children: <Space>{result.userName}{!result.active && <Tag color="red">{t('inactive')}</Tag>}</Space>},
          {key: 'groups', label: t('Groups'), children: result.groups.length ? result.groups.map(g => <Tag key={g}>{g}</Tag>) : '—'},
          {key: 'roles', label: t('Roles'), children: result.roles.length ? result.roles.map(r => <Tag key={r}>{r}</Tag>) : '—'},
        ]} />
        <Table<Decision> size="small" data-testid="inspect-decisions" rowKey="action" pagination={false} dataSource={result.decisions} columns={[
          {title: t('Action'), dataIndex: 'action'},
          {title: t('Decision'), render: (_, d) => <Tag color={d.allowed ? 'green' : 'red'} data-testid={`decision-${d.action}`}>{d.allowed ? t('ALLOWED') : t('DENIED')}</Tag>},
          {title: t('Reason'), dataIndex: 'reason', render: r => t(r)},
          {title: t('Explanation'), render: (_, d) => {
            const paths = result.paths.filter(p => p.action === d.action);
            return paths.length ? <Space direction="vertical" size={0}>{paths.map((p, i) => <span key={i}>{t(p.kind)}: {p.grantSubject}{p.via && p.via !== 'user' ? ` (${t('via')} ${p.via})` : ''}{p.grantResourceKey !== resourceKey ? ` @ ${p.grantResourceKey}` : ''}</span>)}</Space>
              : <Typography.Text type="secondary">{t('No grant applies')}</Typography.Text>;
          }},
        ]} />
      </>}
    </Space>
  );
}

/** Operator Console → Resource management: application and module selection around the resource manager. */
export function ResourceManagementPage() {
  const {t} = useI18n();
  const applications = useList<{key: string; displayName: string; archived: boolean}>('/applications');
  const [application, setApplication] = useState<string | undefined>();
  const [module, setModule] = useState<string | undefined>();
  const modules = useList<{moduleKey: string; displayName: string}>(application ? `/modules?applicationKey=${application}` : null);
  useEffect(() => { if (!application && applications.data.length) setApplication(applications.data.find(a => !a.archived)?.key); }, [applications.data, application]);
  return (
    <Space direction="vertical" style={{width: '100%'}} size={16} data-testid="resource-management">
      <Card size="small">
        <Space wrap>
          <span>{t('Application')}</span>
          <Select data-testid="rm-application" style={{minWidth: 220}} value={application} onChange={v => { setApplication(v); setModule(undefined); }}
            options={applications.data.map(a => ({value: a.key, label: `${a.displayName} (${a.key})`}))} />
          <span>{t('Micro-frontend')}</span>
          <Select data-testid="rm-module" allowClear style={{minWidth: 220}} placeholder={t('All modules')} value={module} onChange={setModule}
            options={modules.data.map(m => ({value: m.moduleKey, label: `${m.displayName} (${m.moduleKey})`}))} />
        </Space>
      </Card>
      {application ? <ResourceManager key={`${application}|${module ?? ''}`} applicationKey={application} moduleKey={module} testId="rm-tree-card"
        title={t('Resource tree')} /> : <Empty description={t('Create an application first')} />}
    </Space>
  );
}

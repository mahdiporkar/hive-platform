import {useI18n} from '../i18n';
import {useState} from 'react';
import {Alert, Button, Card, Descriptions, Input, List, Space, Table, Tabs, Tag, Tree} from 'antd';
import {Link, useParams} from 'react-router-dom';
import {admin, errorText, useList} from '../api';
import {CreateButton, EntityPage} from '../EntityPage';

interface Application {key: string; displayName: string; archived: boolean; revision: number}
interface ResourceView {key: string; type: string; parentKey: string | null; displayName: string; origin: string; ownerModuleKey?: string; archived: boolean; revision: number; actions: {key: string; archived: boolean}[]}
interface Module {applicationKey: string; moduleKey: string; displayName: string; definitionMode: string; activeArtifactVersion?: string; activeResourceVersion?: string; archived: boolean; revision: number}
interface Revision {manifestVersion: string; status: string; active: boolean; checksum: string; source: string; createdBy: string}
interface Artifact {manifestVersion: string; contractVersion: string; runtimeVersion: string; artifactUrl: string; active: boolean; resourceManifestVersion?: string}
interface Change {kind: string; resourceKey: string; detail?: string}

export function ApplicationsPage() {
  const {t} = useI18n();
  return <EntityPage<Application> title={t("Applications")} path="/applications" testId="applications" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key', render: key => <Link to={`/applications/${key}`} data-testid={`application-link-${key}`}>{key}</Link>},
      {title: t("Name"), dataIndex: 'displayName'}, {title: t("State"), render: (_, a) => a.archived ? <Tag>{t("archived")}</Tag> : <Tag color="green">{t("active")}</Tag>}]}
    create={{label: t("New application"), fields: [{name: 'key', label: t("Key"), required: true, placeholder: 'campus'}, {name: 'displayName', label: t("Display name"), required: true}]}} />;
}

export function ApplicationDetailPage() {
  const {t} = useI18n();
  const {key = ''} = useParams();
  const {data, reload} = useList<ResourceView>(`/applications/${key}/resources?includeArchived=true`);
  const byParent = new Map<string | null, ResourceView[]>();
  // The API omits null fields, so a root arrives without parentKey.
  data.forEach(r => byParent.set(r.parentKey ?? null, [...(byParent.get(r.parentKey ?? null) ?? []), r]));
  interface TreeNode {key: string; title: string; children: TreeNode[]}
  const node = (r: ResourceView): TreeNode => ({
    key: r.key, title: `${r.displayName} (${r.key} · ${t(r.type)}${r.ownerModuleKey ? ' · ' + r.ownerModuleKey : ''})${r.archived ? ` [${t('archived')}]` : ''} — ${['manage', ...r.actions.filter(a => !a.archived).map(a => a.key)].join(', ')}`,
    children: (byParent.get(r.key) ?? []).map(node)});
  return (
    <Card title={t('Resource catalog: {key}', {key})} data-testid="resources-page" extra={<CreateButton label={t("New resource")} testId="resource-create"
      fields={[{name: 'key', label: t("Key"), required: true}, {name: 'type', label: t("Type"), type: 'select', required: true,
        options: ['MODULE', 'PAGE', 'UI_COMPONENT', 'FIELD', 'BUSINESS_RESOURCE', 'EXTERNAL_RESOURCE', 'API_RESOURCE', 'DATA_RESOURCE', 'DATA_GOVERNANCE_RESOURCE']},
        {name: 'parentKey', label: t("Parent key"), required: true}, {name: 'displayName', label: t("Display name"), required: true}, {name: 'actions', label: t("Actions (comma separated)"), type: 'tags'}]}
      submit={body => admin.post(`/applications/${key}/resources`, {...body, actions: ((body.actions as string[] | undefined) ?? []).map(a => ({key: a}))})} onDone={() => void reload()} />}>
      <Tree data-testid="resource-tree" defaultExpandAll treeData={(byParent.get(null) ?? []).map(node)} key={data.length} />
    </Card>
  );
}

export function ModulesPage() {
  const {t} = useI18n();
  return <EntityPage<Module> title={t("Micro apps (modules)")} path="/modules" testId="modules" rowKey="moduleKey"
    columns={[{title: t("Module"), dataIndex: 'moduleKey', render: key => <Link to={`/modules/${key}`} data-testid={`module-link-${key}`}>{key}</Link>},
      {title: t("Application"), dataIndex: 'applicationKey'}, {title: t("Mode"), dataIndex: 'definitionMode'},
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

export function ModuleDetailPage() {
  const {t} = useI18n();
  const {key = ''} = useParams();
  const revisions = useList<Revision>(`/modules/${key}/resource-manifests`);
  const artifacts = useList<Artifact>(`/modules/${key}/artifacts`);
  const releases = useList<{action: string; resourceVersion?: string; artifactVersion?: string; actor: string; occurredAt: string}>(`/modules/${key}/releases`);
  const [diff, setDiff] = useState<{version: string; changes: Change[]; conflicts: boolean} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>) => {
    try { await work(); setError(null); await Promise.all([revisions.reload(), artifacts.reload(), releases.reload()]); } catch (e) { setError(errorText(e)); }
  };
  return (
    <Card title={t('Module {key}', {key})} data-testid="module-detail">
      {error && <Alert type="error" message={error} data-testid="module-error" style={{marginBottom: 12}} closable onClose={() => setError(null)} />}
      <Tabs items={[
        {key: 'resources', label: t("Resource manifests"), children: <>
          <ManifestImport label={t("resource manifest")} testId="resource-manifest" path={`/modules/${key}/resource-manifests`} onDone={() => void revisions.reload()} />
          <Table<Revision> data-testid="revisions-table" size="small" rowKey="manifestVersion" dataSource={revisions.data} pagination={false} columns={[
            {title: t("Version"), dataIndex: 'manifestVersion'}, {title: t("Status"), render: (_, r) => <Space><Tag color={r.status === 'PUBLISHED' ? 'blue' : 'gold'}>{t(r.status)}</Tag>{r.active && <Tag color="green">{t("active")}</Tag>}</Space>},
            {title: t("Source"), dataIndex: 'source', render: source => t(source)}, {title: t("Checksum"), render: (_, r) => r.checksum.slice(0, 12)},
            {title: t("Actions"), render: (_, r) => <Space>
              <Button size="small" data-testid={`diff-${r.manifestVersion}`} onClick={() => void act(async () => setDiff({version: r.manifestVersion, ...(await admin.get<{changes: Change[]; conflicts: boolean}>(`/modules/${key}/resource-manifests/${r.manifestVersion}/diff`))}))}>{t("Diff")}</Button>
              {r.status === 'DRAFT' && <Button size="small" type="primary" data-testid={`publish-${r.manifestVersion}`} onClick={() => void act(() => admin.post(`/modules/${key}/resource-manifests/${r.manifestVersion}/publish`))}>{t("Publish")}</Button>}
              {r.status === 'PUBLISHED' && !r.active && <Button size="small" data-testid={`activate-${r.manifestVersion}`} onClick={() => void act(() => admin.post(`/modules/${key}/resource-manifests/${r.manifestVersion}/activate`))}>{t("Activate (rollback)")}</Button>}
            </Space>}]} />
          {diff && <Card size="small" title={`${t('Diff {version}', {version: diff.version})}${diff.conflicts ? ' — ' + t('conflicts') : ''}`} style={{marginTop: 12}} data-testid="diff">
            <List size="small" dataSource={diff.changes} renderItem={c => <List.Item data-testid="diff-change">{`${t(c.kind)} ${c.resourceKey}${c.detail ? ' (' + c.detail + ')' : ''}`}</List.Item>} /></Card>}
        </>},
        {key: 'artifacts', label: t("Artifacts"), children: <>
          <ManifestImport label={t("micro-frontend manifest")} testId="mf-manifest" path={`/modules/${key}/artifacts`} onDone={() => void artifacts.reload()} />
          <Table<Artifact> data-testid="artifacts-table" size="small" rowKey="manifestVersion" dataSource={artifacts.data} pagination={false} columns={[
            {title: t("Version"), dataIndex: 'manifestVersion'}, {title: t("Contract"), dataIndex: 'contractVersion'}, {title: t("Runtime"), dataIndex: 'runtimeVersion'},
            {title: t("Resources"), dataIndex: 'resourceManifestVersion'}, {title: t("URL"), dataIndex: 'artifactUrl'},
            {title: t("Actions"), render: (_, a) => a.active ? <Tag color="green">{t("active")}</Tag> : <Button size="small" type="primary" data-testid={`activate-artifact-${a.manifestVersion}`}
              onClick={() => void act(() => admin.post(`/modules/${key}/artifacts/${a.manifestVersion}/activate`))}>{t("Activate")}</Button>}]} />
        </>},
        {key: 'releases', label: t("Release history"), children: <Table data-testid="releases-table" size="small" rowKey={(_, i) => String(i)} dataSource={releases.data} pagination={false}
          columns={[{title: t("Action"), dataIndex: 'action'}, {title: t("Resources"), dataIndex: 'resourceVersion'}, {title: t("Artifact"), dataIndex: 'artifactVersion'}, {title: t("Actor"), dataIndex: 'actor'}, {title: t("When"), dataIndex: 'occurredAt'}]} />},
      ]} />
      <Descriptions size="small" style={{marginTop: 12}} items={[{label: t("Tip"), children: t("Publishing materializes the resource tree; activating an artifact also activates the resource revision it names.")}]} />
    </Card>
  );
}

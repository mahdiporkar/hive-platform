import {useI18n} from '../i18n';
import {useMemo, useState} from 'react';
import {Alert, AutoComplete, Button, Checkbox, Col, Collapse, Divider, Form, Input, InputNumber, List, Modal, Radio, Result, Row, Select, Space, Steps, Tag, Tree, Typography} from 'antd';
import {Link} from 'react-router-dom';
import {admin, errorText, useList} from '../api';

export interface ProbeCheck {key: string; status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'; code?: string; message: string}
export interface ProbeResult {ok: boolean; url?: string; origin?: string; baseUrl?: string; checks: ProbeCheck[]; detectedFormat?: string; remoteName?: string; exposedModules: string[];
  integrity?: string; size?: number; contentType?: string; mfManifestUrl?: string; mfManifest?: Record<string, unknown>; resourceManifestUrl?: string; resourceManifest?: ResourceDocument}
interface ResourceDocument {manifestVersion: string; applicationKey: string; moduleKey: string; resources: {key: string; type: string; parentKey?: string; name: string; actions?: (string | {key: string})[]}[]}
export interface ExistingModule {applicationKey: string; moduleKey: string; displayName: string; definitionMode: string; revision: number; mfManifestUrl?: string; resourceManifestUrl?: string;
  activeArtifactVersion?: string; activeResourceVersion?: string; description?: string; icon?: string; environment?: string; entryUrl?: string}
export interface RouteRow {key: string; path: string; label?: string; access: string; resource?: string; action?: string}
interface LogEntry {step: string; status: 'ok' | 'error' | 'skipped'; detail?: string}
type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const STATUS_COLOR: Record<string, string> = {PASS: 'green', FAIL: 'red', WARN: 'gold', SKIP: 'default'};
const bump = (version?: string) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? ''); return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0'; };
const actionKeys = (actions?: (string | {key: string})[]) => (actions ?? []).map(a => typeof a === 'string' ? a : a.key);

export function ProbeChecks({result}: {result: ProbeResult | null}) {
  const {t} = useI18n();
  if (!result) return null;
  return <List size="small" data-testid="probe-checks" bordered dataSource={result.checks} renderItem={c =>
    <List.Item data-testid={`probe-check-${c.key}`} data-status={c.status}><Space align="start"><Tag color={STATUS_COLOR[c.status]}>{t(c.status)}</Tag>
      <span><strong>{t(c.key)}</strong>{c.code ? <Typography.Text code style={{marginInlineStart: 6}}>{c.code}</Typography.Text> : null}<br />{c.message}</span></Space></List.Item>} />;
}

/**
 * Register a micro-frontend from its network address: general information, address (host/IP, port, protocol or full
 * URL) with connection, policy and compatibility checks, runtime format, manifests (fetched, pasted, generated or none)
 * and a validated save-draft / publish-and-activate. With `existing`, registers a new artifact version (e.g. a changed address).
 */
export function RegisterMfeWizard({open, onClose, onDone, existing, initialRoutes = []}: {open: boolean; onClose: () => void; onDone: () => void; existing?: ExistingModule; initialRoutes?: RouteRow[]}) {
  const {t} = useI18n();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [validation, setValidation] = useState<ProbeCheck[] | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{moduleKey: string; activated: boolean} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applications = useList<{key: string; displayName: string; archived: boolean}>(open ? '/applications' : null);
  const values = Form.useWatch([], form) as Values | undefined;
  const v: Values = {...form.getFieldsValue(true), ...(values ?? {})};

  const initial: Values = existing ? {
    applicationKey: existing.applicationKey, moduleKey: existing.moduleKey, displayName: existing.displayName, description: existing.description, icon: existing.icon,
    environment: existing.environment, status: 'ACTIVE', addressMode: existing.entryUrl ? 'url' : 'parts', url: existing.entryUrl, protocol: 'http', entryPath: '/remoteEntry.js',
    definitionMode: existing.definitionMode, manifestVersion: bump(existing.activeArtifactVersion), mfSource: 'generate', resSource: existing.activeResourceVersion ? 'existing' : 'none',
    existingResourceVersion: existing.activeResourceVersion, useRegisteredAddress: true, createMissing: existing.definitionMode !== 'MANIFEST', styleIsolation: 'SCOPED', routes: initialRoutes,
  } : {status: 'ACTIVE', environment: 'production', addressMode: 'parts', protocol: 'http', entryPath: '/remoteEntry.js', definitionMode: 'HYBRID', manifestVersion: '1.0.0',
    mfSource: 'generate', resSource: 'none', useRegisteredAddress: true, createMissing: true, styleIsolation: 'SCOPED', routes: []};

  const probeBody = (extra: Values) => {
    const f = form.getFieldsValue(true);
    return f.addressMode === 'url' ? {url: f.url, ...extra}
      : {protocol: f.protocol, host: f.host, port: f.port, basePath: f.basePath, entryPath: f.entryPath, ...extra};
  };
  const runProbe = async (kind: string, extra: Values) => {
    setProbing(kind); setError(null);
    try {
      const result = await admin.post<ProbeResult>('/modules/probe', probeBody(extra));
      setProbe(result);
      if (result.detectedFormat) {
        const mfValid = result.checks.some(c => c.key === 'mfManifest' && c.status === 'PASS');
        const fetchedRoutes = (result.mfManifest?.routes as {key: string; path: string; access: string; resource?: string; action?: string; navigation?: {label: string}}[] | undefined) ?? [];
        form.setFieldsValue({format: result.detectedFormat, remoteName: result.remoteName ?? form.getFieldValue('remoteName'),
          exposedModule: result.exposedModules[0] ?? form.getFieldValue('exposedModule') ?? './plugin',
          ...(mfValid ? {mfSource: 'fetched', manifestVersion: existing ? form.getFieldValue('manifestVersion') : String(result.mfManifest?.manifestVersion ?? '1.0.0'),
            routes: fetchedRoutes.map(r => ({key: r.key, path: r.path, access: r.access, resource: r.resource, action: r.action, label: r.navigation?.label}))} : {}),
          ...(result.resourceManifest && !existing ? {resSource: 'fetched', definitionMode: 'HYBRID'} : {}),
          ...(!result.resourceManifest && !existing && form.getFieldValue('resSource') === 'none' ? {definitionMode: 'MANUAL'} : {})});
      }
    } catch (e) { setError(errorText(e)); } finally { setProbing(null); }
  };

  const resourceDocument = (): ResourceDocument | null => {
    const f = form.getFieldsValue(true);
    if (f.resSource === 'fetched') return probe?.resourceManifest ?? null;
    if (f.resSource === 'paste' && f.resJson) return JSON.parse(f.resJson);
    return null;
  };
  const artifactDescriptor = (f: Values) => ({url: probe?.url, integrity: probe?.integrity, format: f.format,
    ...(f.format === 'ES_MODULE' ? {} : {exposedModule: f.exposedModule, ...(f.remoteName ? {remoteName: f.remoteName} : {})})});
  const manifestDocument = (): Record<string, unknown> => {
    const f = form.getFieldsValue(true);
    const resources = resourceDocument();
    const resourceVersion = f.resSource === 'existing' ? f.existingResourceVersion : resources?.manifestVersion;
    if (f.mfSource === 'fetched' || f.mfSource === 'paste') {
      const doc = structuredClone(f.mfSource === 'fetched' ? probe?.mfManifest ?? {} : JSON.parse(f.mfJson || '{}')) as Record<string, unknown>;
      if (f.useRegisteredAddress) doc.artifact = artifactDescriptor(f);
      if (existing) doc.manifestVersion = f.manifestVersion;
      return doc;
    }
    return {schemaVersion: '1.0.0', manifestVersion: f.manifestVersion, contractVersion: '1.1.0', runtimeVersion: '1.0.0', applicationKey: f.applicationKey, moduleKey: f.moduleKey,
      displayName: f.displayName, ...(resourceVersion ? {resourceManifestVersion: resourceVersion} : {}), artifact: artifactDescriptor(f), styleIsolation: f.styleIsolation,
      routes: (f.routes as RouteRow[]).filter(r => r?.key && r?.path).map((r, i) => ({key: r.key, path: r.path, access: r.access ?? 'AUTHENTICATED',
        ...(r.resource ? {resource: r.resource, action: r.action || 'view'} : {}), ...(r.label ? {navigation: {label: r.label, order: i + 1}} : {})}))};
  };
  /** Route resources that neither the resource manifest nor the existing catalog declare (resource discovery). */
  const missingResources = async (doc: Record<string, unknown>) => {
    const f = form.getFieldsValue(true);
    const declared = new Map<string, string[]>((resourceDocument()?.resources ?? []).map(r => [r.key, actionKeys(r.actions)]));
    try { (await admin.get<{key: string; archived: boolean; actions: {key: string; archived: boolean}[]}[]>(`/applications/${f.applicationKey}/resources`))
      .filter(r => !r.archived).forEach(r => declared.set(r.key, [...(declared.get(r.key) ?? []), ...r.actions.filter(a => !a.archived).map(a => a.key)])); } catch { /* new application */ }
    const missing = new Map<string, Set<string>>();
    for (const route of (doc.routes as {resource?: string; action?: string}[] | undefined) ?? []) {
      if (!route.resource) continue;
      const actions = declared.get(route.resource);
      if (!actions || (route.action !== 'manage' && !actions.includes(route.action!))) missing.set(route.resource, new Set([...(missing.get(route.resource) ?? []), route.action!]));
    }
    return {missing, declared};
  };

  const validate = async () => {
    const f = form.getFieldsValue(true);
    const checks: ProbeCheck[] = [];
    let doc: Record<string, unknown> = {};
    try { doc = manifestDocument(); } catch (e) { checks.push({key: 'manifest', status: 'FAIL', code: 'MANIFEST_NOT_JSON', message: errorText(e)}); }
    try {
      const result = await admin.post<{routes: number}>('/manifests/validate', {kind: 'FRONTEND', document: doc});
      checks.push({key: 'manifest', status: 'PASS', message: t('Micro-frontend manifest is valid ({routes} routes)', {routes: String(result.routes)})});
    } catch (e) { checks.push({key: 'manifest', status: 'FAIL', message: errorText(e)}); }
    const resources = (() => { try { return resourceDocument(); } catch (e) { checks.push({key: 'resourceManifest', status: 'FAIL', message: errorText(e)}); return null; } })();
    if (resources) {
      try { await admin.post('/manifests/validate', {kind: 'RESOURCE', document: resources}); checks.push({key: 'resourceManifest', status: 'PASS', message: t('Resource manifest is valid')}); }
      catch (e) { checks.push({key: 'resourceManifest', status: 'FAIL', message: errorText(e)}); }
    }
    const identityOk = doc.applicationKey === f.applicationKey && doc.moduleKey === f.moduleKey && (!resources || (resources.applicationKey === f.applicationKey && resources.moduleKey === f.moduleKey));
    checks.push(identityOk ? {key: 'identity', status: 'PASS', message: t('Manifests declare {app}/{module}', {app: f.applicationKey, module: f.moduleKey})}
      : {key: 'identity', status: 'FAIL', code: 'MANIFEST_IDENTITY_MISMATCH', message: t('Manifests must declare applicationKey {app} and moduleKey {module}', {app: f.applicationKey, module: f.moduleKey})});
    try {
      const catalog = await admin.get<{modules: {moduleKey: string; routes: {path: string}[]}[]}>('/runtime/catalog');
      const paths = new Set(((doc.routes as {path: string}[] | undefined) ?? []).map(r => r.path));
      const conflicts = catalog.modules.filter(m => m.moduleKey !== f.moduleKey).flatMap(m => m.routes.filter(r => paths.has(r.path)).map(r => `${r.path} (${m.moduleKey})`));
      checks.push(conflicts.length ? {key: 'routes', status: 'FAIL', code: 'ROUTE_CONFLICT', message: t('Already served by another active module: {paths}', {paths: conflicts.join(', ')})}
        : {key: 'routes', status: 'PASS', message: t('No route conflicts with active modules')});
    } catch (e) { checks.push({key: 'routes', status: 'WARN', message: errorText(e)}); }
    const {missing} = await missingResources(doc);
    checks.push(missing.size === 0 ? {key: 'resources', status: 'PASS', message: t('Every route references a declared resource and action')}
      : {key: 'resources', status: f.createMissing && f.definitionMode !== 'MANIFEST' ? 'WARN' : 'FAIL', code: 'ROUTE_RESOURCE_UNDECLARED',
        message: t('Not declared yet: {items}', {items: [...missing].map(([k, a]) => `${k} (${[...a].join(', ')})`).join('; ')})
          + (f.createMissing && f.definitionMode !== 'MANIFEST' ? ' — ' + t('they will be created as manual resources') : '')});
    if (probe?.url) {
      try {
        const again = await admin.post<ProbeResult>('/modules/probe', {url: probe.url, fetchManifests: false});
        checks.push(again.ok && again.integrity === probe.integrity ? {key: 'artifact', status: 'PASS', message: t('Artifact is available and unchanged since inspection')}
          : {key: 'artifact', status: 'FAIL', code: again.ok ? 'ARTIFACT_CHANGED' : again.checks.find(c => c.status === 'FAIL')?.code, message: again.ok ? t('The served artifact changed since inspection; run Test connection again') : again.checks.filter(c => c.status === 'FAIL').map(c => c.message).join('; ')});
        checks.push(again.detectedFormat === f.format ? {key: 'format', status: 'PASS', message: t('Runtime format {format} matches the entry', {format: f.format})}
          : {key: 'format', status: 'FAIL', code: 'FORMAT_MISMATCH', message: t('Selected {selected} but the entry looks like {detected}', {selected: f.format, detected: String(again.detectedFormat)})});
      } catch (e) { checks.push({key: 'artifact', status: 'FAIL', message: errorText(e)}); }
    } else checks.push({key: 'artifact', status: 'FAIL', code: 'NOT_INSPECTED', message: t('Run Test connection first')});
    setValidation(checks);
    return checks;
  };

  const apply = async (activate: boolean) => {
    const f = form.getFieldsValue(true);
    const entries: LogEntry[] = [];
    const record = (entry: LogEntry) => { entries.push(entry); setLog([...entries]); };
    setBusy(true); setError(null); setLog([]);
    const step = async (name: string, work: () => Promise<string | void>) => {
      try { record({step: name, status: 'ok', detail: (await work()) ?? undefined}); }
      catch (e) { record({step: name, status: 'error', detail: errorText(e)}); throw e; }
    };
    try {
      const doc = manifestDocument();
      const resources = resourceDocument();
      if (existing) await step(t('Update registered address'), async () => {
        await admin.put(`/modules/${existing.moduleKey}`, {revision: existing.revision, entryUrl: probe?.url ?? '', mfManifestUrl: existing.mfManifestUrl, resourceManifestUrl: existing.resourceManifestUrl,
          definitionMode: f.definitionMode, description: f.description ?? '', icon: f.icon ?? '', environment: f.environment ?? ''});
      });
      else await step(t('Register module'), async () => {
        await admin.post('/modules', {applicationKey: f.applicationKey, moduleKey: f.moduleKey, displayName: f.displayName, definitionMode: f.definitionMode,
          description: f.description, icon: f.icon, environment: f.environment, entryUrl: probe?.url,
          mfManifestUrl: f.mfSource === 'fetched' ? probe?.mfManifestUrl : undefined, resourceManifestUrl: f.resSource === 'fetched' ? probe?.resourceManifestUrl : undefined});
      });
      if (resources) {
        let status = 'DRAFT';
        await step(t('Import resource manifest'), async () => {
          const imported = await admin.post<{revision: {manifestVersion: string; status: string}; created: boolean}>(`/modules/${f.moduleKey}/resource-manifests`, resources);
          status = imported.revision.status;
          return `${imported.revision.manifestVersion} ${imported.revision.status}${imported.created ? '' : ' (' + t('already imported') + ')'}`;
        });
        if (activate && status === 'DRAFT') await step(t('Publish resource manifest'), async () => { await admin.post(`/modules/${f.moduleKey}/resource-manifests/${resources.manifestVersion}/publish`); });
      }
      const {missing} = await missingResources(doc);
      if (missing.size && f.createMissing && f.definitionMode !== 'MANIFEST' && activate) await step(t('Create missing resources'), async () => {
        const existingKeys = new Set((await admin.get<{key: string}[]>(`/applications/${f.applicationKey}/resources?includeArchived=true`)).map(r => r.key));
        if (!existingKeys.has(f.moduleKey)) await admin.post(`/applications/${f.applicationKey}/resources`, {key: f.moduleKey, type: 'MODULE', parentKey: f.applicationKey, displayName: f.displayName, actions: [{key: 'view'}]});
        const created: string[] = [];
        for (const [key, actions] of missing) {
          if (existingKeys.has(key)) continue;
          await admin.post(`/applications/${f.applicationKey}/resources`, {key, type: 'PAGE', parentKey: f.moduleKey, displayName: key, actions: [...actions].filter(a => a !== 'manage').map(a => ({key: a}))});
          created.push(key);
        }
        return created.join(', ') || t('nothing to create');
      });
      await step(t('Register artifact version'), async () => {
        const result = await admin.post<{revision: {manifestVersion: string}; created: boolean}>(`/modules/${f.moduleKey}/artifacts?pinIntegrity=true`, doc);
        return result.revision.manifestVersion + (result.created ? '' : ' (' + t('already registered') + ')');
      });
      if (activate) await step(t('Activate'), async () => { await admin.post(`/modules/${f.moduleKey}/artifacts/${doc.manifestVersion}/activate`); });
      else record({step: t('Activate'), status: 'skipped', detail: t('Saved as draft; activate from the module page')});
      setDone({moduleKey: f.moduleKey, activated: activate});
      onDone();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const resourcePreview = useMemo(() => {
    let doc: ResourceDocument | null = null;
    try { doc = v.resSource === 'fetched' ? probe?.resourceManifest ?? null : v.resSource === 'paste' && v.resJson ? JSON.parse(v.resJson) : null; } catch { return null; }
    if (!doc) return null;
    interface Item {key: string; title: string; children: Item[]}
    const byParent = new Map<string, ResourceDocument['resources']>();
    doc.resources.forEach(r => byParent.set(r.parentKey ?? '', [...(byParent.get(r.parentKey ?? '') ?? []), r]));
    const keys = new Set(doc.resources.map(r => r.key));
    const item = (r: ResourceDocument['resources'][number]): Item => ({key: r.key, title: `${r.name} (${r.key} · ${t(r.type)}) — ${actionKeys(r.actions).join(', ')}`, children: (byParent.get(r.key) ?? []).map(item)});
    return doc.resources.filter(r => !r.parentKey || !keys.has(r.parentKey)).map(item);
  }, [v.resSource, v.resJson, probe, t]);

  const next = async () => {
    const fields: Record<number, string[]> = {0: ['applicationKey', 'moduleKey', 'displayName'], 1: v.addressMode === 'url' ? ['url'] : ['host', 'port']};
    try { await form.validateFields(fields[step] ?? []); } catch { return; }
    if (step === 1 && !probe?.integrity) { setError(t('Run Test connection first; the entry must be reachable and recognized.')); return; }
    setError(null); setStep(step + 1);
  };
  const close = () => { setStep(0); setProbe(null); setValidation(null); setLog([]); setDone(null); setError(null); form.resetFields(); onClose(); };

  const steps = [t('General'), t('Network'), t('Runtime'), t('Manifests'), t('Validate & activate')];
  return (
    <Modal open={open} width={1000} title={existing ? t('Register a new version of {module}', {module: existing.moduleKey}) : t('Register micro-frontend')}
      onCancel={close} destroyOnHidden data-testid="mfe-wizard" footer={done ? <Button data-testid="wizard-close" onClick={close}>{t('Close')}</Button> : <Space>
        {step > 0 && <Button data-testid="wizard-back" onClick={() => setStep(step - 1)}>{t('Back')}</Button>}
        {step < 4 && <Button type="primary" data-testid="wizard-next" onClick={() => void next()}>{t('Next')}</Button>}
        {step === 4 && <>
          <Button data-testid="wizard-validate" onClick={() => void validate()}>{t('Validate')}</Button>
          <Button data-testid="wizard-save-draft" loading={busy} onClick={() => void apply(false)}>{t('Save draft')}</Button>
          <Button type="primary" data-testid="wizard-activate" loading={busy} onClick={() => void apply(true)}>{t('Publish & activate')}</Button>
        </>}
      </Space>}>
      <Steps current={step} size="small" items={steps.map(title => ({title}))} style={{marginBottom: 20}} />
      {done ? <div data-testid="wizard-done"><Result status="success" title={done.activated ? t('Micro-frontend registered and active') : t('Micro-frontend saved as draft')}
        subTitle={<Link to={`/modules/${done.moduleKey}`} onClick={close}>{t('Open module {module}', {module: done.moduleKey})}</Link>} extra={<WizardLog log={log} />} /></div> : <>
      {error && <Alert type="error" message={error} data-testid="wizard-error" style={{marginBottom: 12}} closable onClose={() => setError(null)} />}
      <Form form={form} layout="vertical" initialValues={initial} preserve>
        <div style={{display: step === 0 ? 'block' : 'none'}}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="applicationKey" label={t('Application')} rules={[{required: true, message: t('Required field')}]}>
              <Select data-testid="wizard-applicationKey" disabled={!!existing} showSearch options={applications.data.filter(a => !a.archived).map(a => ({value: a.key, label: `${a.displayName} (${a.key})`}))} />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="moduleKey" label={t('Module key')} rules={[{required: true, message: t('Required field')}, {pattern: /^[a-z][a-z0-9-]{1,79}$/, message: t('Lowercase letters, digits and dashes')}]}>
              <Input data-testid="wizard-moduleKey" disabled={!!existing} placeholder="reports" />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="displayName" label={t('Display name')} rules={[{required: true, message: t('Required field')}]}>
              <Input data-testid="wizard-displayName" disabled={!!existing} placeholder="Reports Management" />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="icon" label={t('Icon')} rules={[{pattern: /^[A-Za-z0-9_-]{1,80}$/, message: t('Letters, digits, dash or underscore')}]}>
              <Select data-testid="wizard-icon" allowClear showSearch options={['dashboard', 'report', 'chart', 'table', 'settings', 'users', 'folder', 'calendar', 'finance', 'document'].map(i => ({value: i, label: i}))} />
            </Form.Item></Col>
            <Col span={24}><Form.Item name="description" label={t('Description')}><Input.TextArea data-testid="wizard-description" rows={2} maxLength={1000} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label={t('Status')}>
              <Select data-testid="wizard-status" options={[{value: 'ACTIVE', label: t('Active after registration')}, {value: 'DRAFT', label: t('Draft (activate later)')}]} />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="environment" label={t('Environment')}>
              <Select data-testid="wizard-environment" options={['production', 'staging', 'test', 'development'].map(e => ({value: e, label: t(e)}))} />
            </Form.Item></Col>
          </Row>
        </div>
        <div style={{display: step === 1 ? 'block' : 'none'}}>
          <Form.Item name="addressMode"><Radio.Group data-testid="wizard-address-mode" optionType="button"
            options={[{value: 'parts', label: t('Host and port')}, {value: 'url', label: t('Full URL')}]} /></Form.Item>
          {v.addressMode === 'url'
            ? <Form.Item name="url" label={t('Entry URL')} rules={[{required: true, message: t('Required field')}]}><Input data-testid="wizard-url" placeholder="http://10.0.0.15:3004/remoteEntry.js" /></Form.Item>
            : <Row gutter={12}>
              <Col span={4}><Form.Item name="protocol" label={t('Protocol')}><Select data-testid="wizard-protocol" options={[{value: 'http', label: 'HTTP'}, {value: 'https', label: 'HTTPS'}]} /></Form.Item></Col>
              <Col span={8}><Form.Item name="host" label={t('Hostname or IP address')} rules={[{required: true, message: t('Required field')}]}><Input data-testid="wizard-host" placeholder="10.0.0.15" /></Form.Item></Col>
              <Col span={4}><Form.Item name="port" label={t('Port')}><InputNumber data-testid="wizard-port" min={1} max={65535} style={{width: '100%'}} placeholder="3004" /></Form.Item></Col>
              <Col span={4}><Form.Item name="basePath" label={t('Base path')}><Input data-testid="wizard-basePath" placeholder="/" /></Form.Item></Col>
              <Col span={4}><Form.Item name="entryPath" label={t('Entry file')}><Input data-testid="wizard-entryPath" /></Form.Item></Col>
            </Row>}
          <Space wrap style={{marginBottom: 12}}>
            <Button data-testid="probe-validate" loading={probing === 'validate'} onClick={() => void runProbe('validate', {validateOnly: true})}>{t('Validate address')}</Button>
            <Button type="primary" data-testid="probe-run" loading={probing === 'connect'} onClick={() => void runProbe('connect', {fetchManifests: false})}>{t('Test connection')}</Button>
            <Button data-testid="probe-compat" loading={probing === 'compat'} onClick={() => void runProbe('compat', {fetchManifests: false})}>{t('Check runtime compatibility')}</Button>
            <Button data-testid="probe-manifests" loading={probing === 'manifests'} onClick={() => void runProbe('manifests', {fetchManifests: true})}>{t('Fetch manifest')}</Button>
          </Space>
          {probe && <Alert style={{marginBottom: 12}} type={probe.ok ? 'success' : 'error'} showIcon data-testid="probe-summary"
            message={probe.ok ? t('Reachable: {format}, {size} bytes', {format: String(probe.detectedFormat ?? t('address valid')), size: String(probe.size ?? 0)}) : t('The address cannot be registered yet; see the failed check below.')}
            description={probe.url} />}
          <ProbeChecks result={probe} />
          <Typography.Paragraph type="secondary" style={{marginTop: 12}}>{t('Browsers never contact this address: Hive serves the registered files from its own origin (/api/mfe/…), so no proxy rule or rebuild is needed.')}</Typography.Paragraph>
        </div>
        <div style={{display: step === 2 ? 'block' : 'none'}}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="format" label={t('Runtime format')} extra={probe?.detectedFormat ? t('Detected: {format}', {format: probe.detectedFormat}) : undefined}>
              <Select data-testid="wizard-format" options={[{value: 'ES_MODULE', label: t('Hive ES module')}, {value: 'WEBPACK_FEDERATION', label: t('Webpack Module Federation')}, {value: 'VITE_FEDERATION', label: t('Vite Module Federation')}]} />
            </Form.Item></Col>
            <Col span={12}><Form.Item name="styleIsolation" label={t('Style isolation')}><Select data-testid="wizard-styleIsolation" options={['SCOPED', 'SHADOW_DOM'].map(s => ({value: s, label: t(s)}))} /></Form.Item></Col>
            {v.format === 'WEBPACK_FEDERATION' && <Col span={12}><Form.Item name="remoteName" label={t('Container name (webpack remote name)')} rules={[{required: true, message: t('Required field')}]}>
              <Input data-testid="wizard-remoteName" /></Form.Item></Col>}
            {v.format && v.format !== 'ES_MODULE' && <Col span={12}><Form.Item name="exposedModule" label={t('Exposed module')} rules={[{required: true, message: t('Required field')}]}>
              <AutoComplete data-testid="wizard-exposedModule" options={(probe?.exposedModules.length ? probe.exposedModules : ['./plugin']).map(m => ({value: m}))} /></Form.Item></Col>}
          </Row>
          <Alert type="info" showIcon message={t('Every format must provide the Hive micro-app contract')}
            description={t('ES module: export default {contractVersion, create()}. Module Federation: the exposed module default-exports the same object. Integrity is computed from the served bytes and verified on every load.')} />
          {probe?.integrity && <Typography.Paragraph style={{marginTop: 12}}>{t('Integrity')}: <Typography.Text code data-testid="wizard-integrity">{probe.integrity}</Typography.Text></Typography.Paragraph>}
        </div>
        <div style={{display: step === 3 ? 'block' : 'none'}}>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="definitionMode" label={t('Definition mode')}>
              <Select data-testid="wizard-definitionMode" options={['MANIFEST', 'HYBRID', 'MANUAL'].map(m => ({value: m, label: t(m)}))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="manifestVersion" label={t('Artifact version')} rules={[{required: true, pattern: /^\d+\.\d+\.\d+$/, message: t('major.minor.patch')}]}>
              <Input data-testid="wizard-manifestVersion" /></Form.Item></Col>
          </Row>
          <Divider orientation="left">{t('Routes (micro-frontend manifest)')}</Divider>
          <Form.Item name="mfSource"><Radio.Group data-testid="wizard-mf-source" options={[
            {value: 'fetched', label: t('Fetched from the micro-frontend'), disabled: !probe?.mfManifest}, {value: 'generate', label: t('Define routes here')}, {value: 'paste', label: t('Paste JSON')}]} /></Form.Item>
          {(v.mfSource === 'fetched' || v.mfSource === 'paste') && <Form.Item name="useRegisteredAddress" valuePropName="checked">
            <Checkbox data-testid="wizard-use-address">{t('Use the inspected address, format and integrity for the artifact')}</Checkbox></Form.Item>}
          {v.mfSource === 'paste' && <Form.Item name="mfJson"><Input.TextArea data-testid="wizard-mf-json" rows={8} /></Form.Item>}
          {v.mfSource === 'generate' && <Form.List name="routes">{(fields, {add, remove}) => <>
            {fields.map(field => <Row key={field.key} gutter={8} data-testid="wizard-route-row">
              <Col span={3}><Form.Item name={[field.name, 'key']} rules={[{required: true, message: t('Required field')}]}><Input placeholder={t('key')} data-testid={`wizard-route-${field.name}-key`} /></Form.Item></Col>
              <Col span={5}><Form.Item name={[field.name, 'path']} rules={[{required: true, message: t('Required field')}]}><Input placeholder="/reports" data-testid={`wizard-route-${field.name}-path`} /></Form.Item></Col>
              <Col span={4}><Form.Item name={[field.name, 'label']}><Input placeholder={t('Menu label')} data-testid={`wizard-route-${field.name}-label`} /></Form.Item></Col>
              <Col span={3}><Form.Item name={[field.name, 'access']} initialValue="AUTHENTICATED"><Select data-testid={`wizard-route-${field.name}-access`} options={['PUBLIC', 'HYBRID', 'AUTHENTICATED'].map(a => ({value: a, label: t(a)}))} /></Form.Item></Col>
              <Col span={5}><Form.Item name={[field.name, 'resource']}><Input placeholder={t('resource key')} data-testid={`wizard-route-${field.name}-resource`} /></Form.Item></Col>
              <Col span={3}><Form.Item name={[field.name, 'action']}><Input placeholder="view" data-testid={`wizard-route-${field.name}-action`} /></Form.Item></Col>
              <Col span={1}><Button onClick={() => remove(field.name)}>×</Button></Col>
            </Row>)}
            <Button data-testid="wizard-route-add" onClick={() => add({access: 'AUTHENTICATED', action: 'view'})}>{t('Add route')}</Button>
          </>}</Form.List>}
          <Divider orientation="left">{t('Resources (resource manifest)')}</Divider>
          <Form.Item name="resSource"><Radio.Group data-testid="wizard-res-source" options={[
            {value: 'fetched', label: t('Fetched from the micro-frontend'), disabled: !probe?.resourceManifest}, {value: 'paste', label: t('Paste JSON')},
            ...(existing?.activeResourceVersion ? [{value: 'existing', label: t('Keep published revision {version}', {version: existing.activeResourceVersion})}] : []),
            {value: 'none', label: t('None — define resources manually')}]} /></Form.Item>
          {v.resSource === 'paste' && <Form.Item name="resJson"><Input.TextArea data-testid="wizard-res-json" rows={8} /></Form.Item>}
          {resourcePreview && <Collapse defaultActiveKey={['preview']} items={[{key: 'preview', label: t('Resource hierarchy preview'), children: <Tree data-testid="wizard-resource-preview" defaultExpandAll treeData={resourcePreview} />}]} />}
          <Form.Item name="createMissing" valuePropName="checked" style={{marginTop: 12}}>
            <Checkbox data-testid="wizard-create-missing" disabled={v.definitionMode === 'MANIFEST'}>{t('Create resources referenced by routes but not declared (as manual resources)')}</Checkbox>
          </Form.Item>
        </div>
        <div style={{display: step === 4 ? 'block' : 'none'}}>
          <Collapse items={[{key: 'preview', label: t('Preview registration'), children: <pre data-testid="wizard-preview" style={{maxHeight: 280, overflow: 'auto', fontSize: 12}}>{(() => { try { return JSON.stringify(manifestDocument(), null, 2); } catch (e) { return errorText(e); } })()}</pre>}]} />
          {validation && <div data-testid="wizard-validation"><Divider orientation="left">{t('Validation')}</Divider><ProbeChecks result={{ok: true, checks: validation, exposedModules: []}} /></div>}
          {log.length > 0 && <><Divider orientation="left">{t('Progress')}</Divider><WizardLog log={log} /></>}
        </div>
      </Form></>}
    </Modal>
  );
}

function WizardLog({log}: {log: LogEntry[]}) {
  const {t} = useI18n();
  return <List size="small" data-testid="wizard-log" dataSource={log} renderItem={e => <List.Item data-testid="wizard-log-entry" data-status={e.status}>
    <Space><Tag color={e.status === 'ok' ? 'green' : e.status === 'error' ? 'red' : 'default'}>{t(e.status)}</Tag><strong>{e.step}</strong>{e.detail && <span>{e.detail}</span>}</Space></List.Item>} />;
}

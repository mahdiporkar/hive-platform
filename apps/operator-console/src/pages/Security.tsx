import {useI18n} from '../i18n';
import {Tag} from 'antd';
import {admin} from '../api';
import {EntityPage} from '../EntityPage';

interface User {id: string; tenantId: string; displayName: string; active: boolean; identities: {issuer: string; subject: string}[]}
interface Group {id: string; key: string; displayName: string; members: string[]; archived: boolean}
interface Role {id: string; key: string; displayName: string; description?: string; archived: boolean; revision: number}
interface Grant {id: string; subject: string; applicationKey: string; resourceKey: string; action: string; createdBy: string; revokedAt?: string}
interface PlatformAssignment {id: string; role: string; subject: string}
interface Provider {code: string; name: string; issuer: string; tenantId: string; domains: string[]; clientId: string; secretReference: string; enabled: boolean; revision: number; authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string}

export function UsersPage() {
  const {t} = useI18n();
  return <EntityPage<User> title={t("Users")} path="/users" testId="users" rowKey="id"
    columns={[{title: t("Name"), dataIndex: 'displayName'}, {title: t("Id"), dataIndex: 'id'}, {title: t("Tenant"), dataIndex: 'tenantId'},
      {title: t("Identities"), render: (_, u) => u.identities.map(i => <Tag key={i.issuer + i.subject}>{i.subject}</Tag>)},
      {title: t("Active"), render: (_, u) => u.active ? <Tag color="green">{t("active")}</Tag> : <Tag>{t("inactive")}</Tag>}]}
    create={{label: t("New user"), fields: [{name: 'displayName', label: t("Display name"), required: true}, {name: 'tenantId', label: t("Tenant"), placeholder: 'default'},
      {name: 'issuer', label: t("External identity issuer")}, {name: 'subject', label: t("External identity subject")}],
      transform: b => ({displayName: b.displayName, tenantId: b.tenantId, identities: b.issuer && b.subject ? [{issuer: b.issuer, subject: b.subject}] : []})}}
    actions={[{label: t("Deactivate"), testId: u => `user-deactivate-${u.id}`, visible: u => u.active, run: u => admin.put(`/users/${u.id}`, {active: false})},
      {label: t("Activate"), testId: u => `user-activate-${u.id}`, visible: u => !u.active, run: u => admin.put(`/users/${u.id}`, {active: true})}]} />;
}

export function GroupsPage() {
  const {t} = useI18n();
  return <EntityPage<Group> title={t("Groups (access groups)")} path="/groups" testId="groups" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Name"), dataIndex: 'displayName'}, {title: t("Members"), render: (_, g) => g.members.length}]}
    create={{label: t("New group"), fields: [{name: 'key', label: t("Key"), required: true}, {name: 'displayName', label: t("Display name"), required: true}]}}
    actions={[{label: t("Add member"), testId: g => `group-add-${g.key}`, run: async g => {
      const userId = window.prompt(t("User id"));
      if (userId) await admin.post(`/groups/${g.key}/members`, {userId});
    }}]} />;
}

export function RolesPage() {
  const {t} = useI18n();
  return <EntityPage<Role> title={t("Business roles")} path="/roles" testId="roles" rowKey="key"
    columns={[{title: t("Key"), dataIndex: 'key'}, {title: t("Name"), dataIndex: 'displayName'}, {title: t("Description"), dataIndex: 'description'},
      {title: t("State"), render: (_, r) => r.archived ? <Tag>{t("archived")}</Tag> : <Tag color="green">{t("active")}</Tag>}]}
    create={{label: t("New role"), fields: [{name: 'key', label: t("Key"), required: true}, {name: 'displayName', label: t("Display name"), required: true}, {name: 'description', label: t("Description"), type: 'textarea'}]}}
    actions={[{label: t("Assign"), testId: r => `role-assign-${r.key}`, visible: r => !r.archived, run: async r => {
      const subject = window.prompt(t("Subject (user:<id> or group:<key>)"));
      if (subject) await admin.post(`/roles/${r.key}/assignments`, {subject});
    }}, {label: t("Archive"), testId: r => `role-archive-${r.key}`, visible: r => !r.archived, confirm: t("Archive this role and revoke its assignments and grants?"),
      run: r => admin.post(`/roles/${r.key}/archive`, {revision: r.revision})}]} />;
}

export function GrantsPage() {
  const {t} = useI18n();
  return <EntityPage<Grant> title={t("Permission grants")} path="/grants" testId="grants" rowKey="id"
    columns={[{title: t("Subject"), dataIndex: 'subject'}, {title: t("Application"), dataIndex: 'applicationKey'}, {title: t("Resource"), dataIndex: 'resourceKey'},
      {title: t("Action"), dataIndex: 'action'}, {title: t("By"), dataIndex: 'createdBy'}]}
    create={{label: t("Grant permission"), fields: [{name: 'subject', label: t("Subject (user:<id>, role:<key>, group:<key>)"), required: true},
      {name: 'applicationKey', label: t("Application"), required: true}, {name: 'resourceKey', label: t("Resource"), required: true}, {name: 'action', label: t("Action"), required: true}]}}
    actions={[{label: t("Revoke"), testId: g => `grant-revoke-${g.resourceKey}-${g.action}`, confirm: t("Revoke this grant?"), run: g => admin.delete(`/grants/${g.id}`)}]} />;
}

export function PlatformRolesPage() {
  const {t} = useI18n();
  return <EntityPage<PlatformAssignment> title={t("Platform roles")} path="/platform-roles" testId="platform-roles" rowKey="id"
    columns={[{title: t("Role"), dataIndex: 'role', render: role => <Tag color="purple">{t(role)}</Tag>}, {title: t("Subject"), dataIndex: 'subject'}]}
    create={{label: t("Assign platform role"), fields: [{name: 'role', label: t("Role"), type: 'select', required: true, options: ['SUPER_ADMIN', 'OPERATOR', 'SECURITY_ADMIN', 'INTEGRATION_ADMIN', 'AUDITOR']},
      {name: 'subject', label: t("Subject"), required: true}]}}
    actions={[{label: t("Revoke"), testId: a => `platform-role-revoke-${a.role}`, confirm: t("Revoke this platform role?"), run: a => admin.delete(`/platform-roles/${a.id}`)}]} />;
}

export function IdentityProvidersPage() {
  const {t} = useI18n();
  return <EntityPage<Provider> title={t("Identity providers")} path="/identity/providers" testId="providers" rowKey="code"
    columns={[{title: t("Code"), dataIndex: 'code'}, {title: t("Name"), dataIndex: 'name'}, {title: t("Issuer"), dataIndex: 'issuer'}, {title: t("Tenant"), dataIndex: 'tenantId'},
      {title: t("Domains"), render: (_, p) => p.domains.join(', ')}, {title: t("Enabled"), render: (_, p) => p.enabled ? <Tag color="green">{t("enabled")}</Tag> : <Tag>{t("disabled")}</Tag>}]}
    create={{label: t("New identity provider"), fields: [{name: 'code', label: t("Code"), required: true}, {name: 'name', label: t("Name"), required: true},
      {name: 'issuer', label: t("Issuer"), required: true}, {name: 'tenantId', label: t("Tenant"), required: true, initial: 'default'}, {name: 'domains', label: t("Domains (comma separated)"), type: 'tags'},
      {name: 'clientId', label: t("Client id"), required: true}, {name: 'secretReference', label: t("Secret reference (env:HIVE_IDP_*)"), required: true},
      {name: 'authorizationEndpoint', label: t("Authorization endpoint"), required: true}, {name: 'tokenEndpoint', label: t("Token endpoint"), required: true}, {name: 'jwksUri', label: t("JWKS URI"), required: true}],
      transform: b => ({...b, domains: b.domains ?? [], enabled: true, revision: 0})}}
    actions={[{label: t("Disable"), testId: p => `provider-disable-${p.code}`, visible: p => p.enabled, run: p => admin.put(`/identity/providers/${p.code}`, {...p, enabled: false})},
      {label: t("Enable"), testId: p => `provider-enable-${p.code}`, visible: p => !p.enabled, run: p => admin.put(`/identity/providers/${p.code}`, {...p, enabled: true})}]} />;
}

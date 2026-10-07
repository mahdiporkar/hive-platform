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
  return <EntityPage<User> title="Users" path="/users" testId="users" rowKey="id"
    columns={[{title: 'Name', dataIndex: 'displayName'}, {title: 'Id', dataIndex: 'id'}, {title: 'Tenant', dataIndex: 'tenantId'},
      {title: 'Identities', render: (_, u) => u.identities.map(i => <Tag key={i.issuer + i.subject}>{i.subject}</Tag>)},
      {title: 'Active', render: (_, u) => u.active ? <Tag color="green">active</Tag> : <Tag>inactive</Tag>}]}
    create={{label: 'New user', fields: [{name: 'displayName', label: 'Display name', required: true}, {name: 'tenantId', label: 'Tenant', placeholder: 'default'},
      {name: 'issuer', label: 'External identity issuer'}, {name: 'subject', label: 'External identity subject'}],
      transform: b => ({displayName: b.displayName, tenantId: b.tenantId, identities: b.issuer && b.subject ? [{issuer: b.issuer, subject: b.subject}] : []})}}
    actions={[{label: 'Deactivate', testId: u => `user-deactivate-${u.id}`, visible: u => u.active, run: u => admin.put(`/users/${u.id}`, {active: false})},
      {label: 'Activate', testId: u => `user-activate-${u.id}`, visible: u => !u.active, run: u => admin.put(`/users/${u.id}`, {active: true})}]} />;
}

export function GroupsPage() {
  return <EntityPage<Group> title="Groups (access groups)" path="/groups" testId="groups" rowKey="key"
    columns={[{title: 'Key', dataIndex: 'key'}, {title: 'Name', dataIndex: 'displayName'}, {title: 'Members', render: (_, g) => g.members.length}]}
    create={{label: 'New group', fields: [{name: 'key', label: 'Key', required: true}, {name: 'displayName', label: 'Display name', required: true}]}}
    actions={[{label: 'Add member', testId: g => `group-add-${g.key}`, run: async g => {
      const userId = window.prompt('User id');
      if (userId) await admin.post(`/groups/${g.key}/members`, {userId});
    }}]} />;
}

export function RolesPage() {
  return <EntityPage<Role> title="Business roles" path="/roles" testId="roles" rowKey="key"
    columns={[{title: 'Key', dataIndex: 'key'}, {title: 'Name', dataIndex: 'displayName'}, {title: 'Description', dataIndex: 'description'},
      {title: 'State', render: (_, r) => r.archived ? <Tag>archived</Tag> : <Tag color="green">active</Tag>}]}
    create={{label: 'New role', fields: [{name: 'key', label: 'Key', required: true}, {name: 'displayName', label: 'Display name', required: true}, {name: 'description', label: 'Description', type: 'textarea'}]}}
    actions={[{label: 'Assign', testId: r => `role-assign-${r.key}`, visible: r => !r.archived, run: async r => {
      const subject = window.prompt('Subject (user:<id> or group:<key>)');
      if (subject) await admin.post(`/roles/${r.key}/assignments`, {subject});
    }}, {label: 'Archive', testId: r => `role-archive-${r.key}`, visible: r => !r.archived, confirm: 'Archive this role and revoke its assignments and grants?',
      run: r => admin.post(`/roles/${r.key}/archive`, {revision: r.revision})}]} />;
}

export function GrantsPage() {
  return <EntityPage<Grant> title="Permission grants" path="/grants" testId="grants" rowKey="id"
    columns={[{title: 'Subject', dataIndex: 'subject'}, {title: 'Application', dataIndex: 'applicationKey'}, {title: 'Resource', dataIndex: 'resourceKey'},
      {title: 'Action', dataIndex: 'action'}, {title: 'By', dataIndex: 'createdBy'}]}
    create={{label: 'Grant permission', fields: [{name: 'subject', label: 'Subject (user:<id>, role:<key>, group:<key>)', required: true},
      {name: 'applicationKey', label: 'Application', required: true}, {name: 'resourceKey', label: 'Resource', required: true}, {name: 'action', label: 'Action', required: true}]}}
    actions={[{label: 'Revoke', testId: g => `grant-revoke-${g.resourceKey}-${g.action}`, confirm: 'Revoke this grant?', run: g => admin.delete(`/grants/${g.id}`)}]} />;
}

export function PlatformRolesPage() {
  return <EntityPage<PlatformAssignment> title="Platform roles" path="/platform-roles" testId="platform-roles" rowKey="id"
    columns={[{title: 'Role', dataIndex: 'role', render: role => <Tag color="purple">{role}</Tag>}, {title: 'Subject', dataIndex: 'subject'}]}
    create={{label: 'Assign platform role', fields: [{name: 'role', label: 'Role', type: 'select', required: true, options: ['SUPER_ADMIN', 'OPERATOR', 'SECURITY_ADMIN', 'INTEGRATION_ADMIN', 'AUDITOR']},
      {name: 'subject', label: 'Subject', required: true}]}}
    actions={[{label: 'Revoke', testId: a => `platform-role-revoke-${a.role}`, confirm: 'Revoke this platform role?', run: a => admin.delete(`/platform-roles/${a.id}`)}]} />;
}

export function IdentityProvidersPage() {
  return <EntityPage<Provider> title="Identity providers" path="/identity/providers" testId="providers" rowKey="code"
    columns={[{title: 'Code', dataIndex: 'code'}, {title: 'Name', dataIndex: 'name'}, {title: 'Issuer', dataIndex: 'issuer'}, {title: 'Tenant', dataIndex: 'tenantId'},
      {title: 'Domains', render: (_, p) => p.domains.join(', ')}, {title: 'Enabled', render: (_, p) => p.enabled ? <Tag color="green">enabled</Tag> : <Tag>disabled</Tag>}]}
    create={{label: 'New identity provider', fields: [{name: 'code', label: 'Code', required: true}, {name: 'name', label: 'Name', required: true},
      {name: 'issuer', label: 'Issuer', required: true}, {name: 'tenantId', label: 'Tenant', required: true, initial: 'default'}, {name: 'domains', label: 'Domains (comma separated)', type: 'tags'},
      {name: 'clientId', label: 'Client id', required: true}, {name: 'secretReference', label: 'Secret reference (env:HIVE_IDP_*)', required: true},
      {name: 'authorizationEndpoint', label: 'Authorization endpoint', required: true}, {name: 'tokenEndpoint', label: 'Token endpoint', required: true}, {name: 'jwksUri', label: 'JWKS URI', required: true}],
      transform: b => ({...b, domains: b.domains ?? [], enabled: true, revision: 0})}}
    actions={[{label: 'Disable', testId: p => `provider-disable-${p.code}`, visible: p => p.enabled, run: p => admin.put(`/identity/providers/${p.code}`, {...p, enabled: false})},
      {label: 'Enable', testId: p => `provider-enable-${p.code}`, visible: p => !p.enabled, run: p => admin.put(`/identity/providers/${p.code}`, {...p, enabled: true})}]} />;
}

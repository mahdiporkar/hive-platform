import {useI18n} from '../i18n';
import {useState} from 'react';
import {Card, Input, Table, Tag} from 'antd';
import {useList} from '../api';

interface AuditEvent {id: string; occurredAt: string; actorId: string; eventType: string; outcome: string; correlationId: string; details: string}
interface ApiLogRow {id: number; occurredAt: string; actorId?: string; method: string; routeKey?: string; operationKey?: string; pathTemplate?: string; status: number; durationMs: number; outcome: string; reason?: string; correlationId: string}

const outcomeColor = (o: string) => ({SUCCESS: 'green', DENIED: 'red', UNAUTHENTICATED: 'orange', FAILURE: 'red'} as Record<string, string>)[o] ?? 'default';

export function AuditPage() {
  const {t} = useI18n();
  const [filter, setFilter] = useState('');
  const {data, loading} = useList<AuditEvent>(`/audit?limit=200${filter ? `&eventType=${encodeURIComponent(filter)}` : ''}`);
  return (
    <Card title={t("Audit log")} data-testid="audit-page" extra={<Input.Search data-testid="audit-filter" placeholder={t("event type prefix")} allowClear onSearch={setFilter} />}>
      <Table<AuditEvent> data-testid="audit-table" size="small" rowKey="id" loading={loading} dataSource={data} pagination={{pageSize: 50}} columns={[
        {title: t("When"), dataIndex: 'occurredAt'}, {title: t("Event"), dataIndex: 'eventType'}, {title: t("Actor"), dataIndex: 'actorId'},
        {title: t("Outcome"), dataIndex: 'outcome', render: o => <Tag color={outcomeColor(o)}>{t(o)}</Tag>}, {title: t("Details"), dataIndex: 'details', ellipsis: true}, {title: t("Correlation"), dataIndex: 'correlationId', ellipsis: true}]} />
    </Card>
  );
}

export function ApiLogsPage() {
  const {t} = useI18n();
  const [route, setRoute] = useState('');
  const {data, loading} = useList<ApiLogRow>(`/api-logs?limit=200${route ? `&routeKey=${encodeURIComponent(route)}` : ''}`);
  return (
    <Card title={t("API logs")} data-testid="api-logs-page" extra={<Input.Search data-testid="api-logs-filter" placeholder={t("route key")} allowClear onSearch={setRoute} />}>
      <Table<ApiLogRow> data-testid="api-logs-table" size="small" rowKey="id" loading={loading} dataSource={data} pagination={{pageSize: 50}} columns={[
        {title: t("When"), dataIndex: 'occurredAt'}, {title: t("Method"), dataIndex: 'method'}, {title: t("Route"), dataIndex: 'routeKey'}, {title: t("Operation"), dataIndex: 'operationKey'},
        {title: t("Template"), dataIndex: 'pathTemplate'}, {title: t("Status"), dataIndex: 'status'}, {title: t("ms"), dataIndex: 'durationMs'},
        {title: t("Outcome"), dataIndex: 'outcome', render: o => <Tag color={outcomeColor(o)}>{t(o)}</Tag>}, {title: t("Actor"), dataIndex: 'actorId'}]} />
    </Card>
  );
}

import {useState} from 'react';
import {Card, Input, Table, Tag} from 'antd';
import {useList} from '../api';

interface AuditEvent {id: string; occurredAt: string; actorId: string; eventType: string; outcome: string; correlationId: string; details: string}
interface ApiLogRow {id: number; occurredAt: string; actorId?: string; method: string; routeKey?: string; operationKey?: string; pathTemplate?: string; status: number; durationMs: number; outcome: string; reason?: string; correlationId: string}

const outcomeColor = (o: string) => ({SUCCESS: 'green', DENIED: 'red', UNAUTHENTICATED: 'orange', FAILURE: 'red'} as Record<string, string>)[o] ?? 'default';

export function AuditPage() {
  const [filter, setFilter] = useState('');
  const {data, loading} = useList<AuditEvent>(`/audit?limit=200${filter ? `&eventType=${encodeURIComponent(filter)}` : ''}`);
  return (
    <Card title="Audit log" data-testid="audit-page" extra={<Input.Search data-testid="audit-filter" placeholder="event type prefix" allowClear onSearch={setFilter} />}>
      <Table<AuditEvent> data-testid="audit-table" size="small" rowKey="id" loading={loading} dataSource={data} pagination={{pageSize: 50}} columns={[
        {title: 'When', dataIndex: 'occurredAt'}, {title: 'Event', dataIndex: 'eventType'}, {title: 'Actor', dataIndex: 'actorId'},
        {title: 'Outcome', dataIndex: 'outcome', render: o => <Tag color={outcomeColor(o)}>{o}</Tag>}, {title: 'Details', dataIndex: 'details', ellipsis: true}, {title: 'Correlation', dataIndex: 'correlationId', ellipsis: true}]} />
    </Card>
  );
}

export function ApiLogsPage() {
  const [route, setRoute] = useState('');
  const {data, loading} = useList<ApiLogRow>(`/api-logs?limit=200${route ? `&routeKey=${encodeURIComponent(route)}` : ''}`);
  return (
    <Card title="API logs" data-testid="api-logs-page" extra={<Input.Search data-testid="api-logs-filter" placeholder="route key" allowClear onSearch={setRoute} />}>
      <Table<ApiLogRow> data-testid="api-logs-table" size="small" rowKey="id" loading={loading} dataSource={data} pagination={{pageSize: 50}} columns={[
        {title: 'When', dataIndex: 'occurredAt'}, {title: 'Method', dataIndex: 'method'}, {title: 'Route', dataIndex: 'routeKey'}, {title: 'Operation', dataIndex: 'operationKey'},
        {title: 'Template', dataIndex: 'pathTemplate'}, {title: 'Status', dataIndex: 'status'}, {title: 'ms', dataIndex: 'durationMs'},
        {title: 'Outcome', dataIndex: 'outcome', render: o => <Tag color={outcomeColor(o)}>{o}</Tag>}, {title: 'Actor', dataIndex: 'actorId'}]} />
    </Card>
  );
}

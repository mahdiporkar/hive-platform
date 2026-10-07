import {useState, type ReactNode} from 'react';
import {Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, message} from 'antd';
import type {ColumnsType} from 'antd/es/table';
import {admin, errorText, useList} from './api';

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'textarea' | 'json' | 'switch' | 'tags';
  options?: string[];
  required?: boolean;
  initial?: unknown;
  placeholder?: string;
}

export interface RowAction<T> {
  label: string;
  testId: (row: T) => string;
  run: (row: T) => Promise<unknown>;
  confirm?: string;
  visible?: (row: T) => boolean;
}

/** Converts form values: JSON fields are parsed, empty strings removed, tags split. */
export function toBody(fields: Field[], values: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined || value === '') continue;
    if (field.type === 'json') body[field.name] = JSON.parse(String(value));
    else if (field.type === 'tags') body[field.name] = String(value).split(',').map(v => v.trim()).filter(Boolean);
    else body[field.name] = value;
  }
  return body;
}

export function FieldInputs({fields, testPrefix}: {fields: Field[]; testPrefix: string}) {
  return (
    <>
      {fields.map(field => (
        <Form.Item key={field.name} name={field.name} label={field.label} initialValue={field.initial}
          valuePropName={field.type === 'switch' ? 'checked' : 'value'}
          rules={field.required ? [{required: true, message: `${field.label} is required`}] : []}>
          {field.type === 'number' ? <InputNumber data-testid={`${testPrefix}-${field.name}`} style={{width: '100%'}} />
            : field.type === 'select' ? <Select data-testid={`${testPrefix}-${field.name}`} options={(field.options ?? []).map(o => ({value: o, label: o}))} />
            : field.type === 'switch' ? <Switch data-testid={`${testPrefix}-${field.name}`} />
            : field.type === 'textarea' || field.type === 'json' ? <Input.TextArea data-testid={`${testPrefix}-${field.name}`} rows={field.type === 'json' ? 10 : 3} placeholder={field.placeholder} />
            : <Input data-testid={`${testPrefix}-${field.name}`} placeholder={field.placeholder} />}
        </Form.Item>
      ))}
    </>
  );
}

/** Modal form that posts to the admin API and reports PlatformErrors inline. */
export function CreateButton({label, testId, fields, submit, onDone}: {label: string; testId: string; fields: Field[]; submit: (body: Record<string, unknown>) => Promise<unknown>; onDone: () => void}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const finish = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      await submit(toBody(fields, values));
      setOpen(false); setError(null); form.resetFields(); onDone();
      void message.success(`${label}: done`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button type="primary" data-testid={testId} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} title={label} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={finish}>
          <FieldInputs fields={fields} testPrefix={testId} />
          {error && <Alert type="error" message={error} data-testid={`${testId}-error`} style={{marginBottom: 12}} />}
          <Button htmlType="submit" type="primary" loading={busy} data-testid={`${testId}-submit`}>Save</Button>
        </Form>
      </Modal>
    </>
  );
}

export function EntityPage<T extends object>({title, path, testId, columns, rowKey, create, actions, extra, children}: {
  title: string; path: string | null; testId: string; columns: ColumnsType<T>; rowKey: keyof T | ((row: T) => string);
  create?: {label: string; fields: Field[]; path?: string; transform?: (body: Record<string, unknown>) => unknown};
  actions?: RowAction<T>[]; extra?: ReactNode; children?: (reload: () => Promise<void>) => ReactNode;
}) {
  const {data, loading, error, reload} = useList<T>(path);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = async (action: RowAction<T>, row: T) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    try { await action.run(row); setActionError(null); await reload(); } catch (e) { setActionError(errorText(e)); }
  };
  const allColumns: ColumnsType<T> = actions?.length ? [...columns, {
    title: 'Actions', key: '__actions',
    render: (_: unknown, row: T) => (
      <Space wrap>{actions.filter(a => a.visible?.(row) ?? true).map(a => <Button key={a.label} size="small" data-testid={a.testId(row)} onClick={() => void run(a, row)}>{a.label}</Button>)}</Space>
    ),
  }] : columns;
  return (
    <Card title={title} data-testid={`${testId}-page`} extra={<Space>{extra}{create && path &&
      <CreateButton label={create.label} testId={`${testId}-create`} fields={create.fields}
        submit={body => admin.post(create.path ?? path, create.transform ? create.transform(body) : body)} onDone={() => void reload()} />}</Space>}>
      {error && <Alert type="error" message={error} style={{marginBottom: 12}} />}
      {actionError && <Alert type="error" message={actionError} data-testid={`${testId}-action-error`} style={{marginBottom: 12}} closable onClose={() => setActionError(null)} />}
      <Table<T> data-testid={`${testId}-table`} size="small" loading={loading} dataSource={data} columns={allColumns}
        rowKey={typeof rowKey === 'function' ? rowKey : (row => String(row[rowKey]))} pagination={{pageSize: 25, hideOnSinglePage: true}} />
      {children?.(reload)}
    </Card>
  );
}

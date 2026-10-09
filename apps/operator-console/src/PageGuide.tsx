import {Collapse} from 'antd';
import {useLocation} from 'react-router-dom';
import {useI18n} from './i18n';
import guides from './guides.json';

export function PageGuide() {
  const {pathname} = useLocation();
  const {language, t} = useI18n();
  const parts = pathname.split('/').filter(Boolean);
  const key = parts[0] === 'applications' && parts[1] ? 'application-detail'
    : parts[0] === 'modules' && parts[1] ? 'module-detail' : parts[0] || 'diagnostics';
  const guide = (guides as Record<string, Record<string, string[]>>)[key];
  if (!guide) return null;
  return <Collapse data-testid="page-guide" style={{marginBottom: 16}} items={[{key: 'guide', label: t('Page guide'),
    children: <ol style={{margin: 0, paddingInlineStart: 24, lineHeight: 2}}>{guide[language].map((step, index) => <li key={index}>{step}</li>)}</ol>}]} />;
}

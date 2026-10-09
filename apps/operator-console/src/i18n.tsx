import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import {ConfigProvider, Select} from 'antd';
import enUS from 'antd/es/locale/en_US';
import faIR from 'antd/es/locale/fa_IR';
import arEG from 'antd/es/locale/ar_EG';
import messages from './messages.json';

export type Language = 'en' | 'fa' | 'ar';
type Translate = (text: string, values?: Record<string, string>) => string;
const dictionary: Record<string, {fa: string; ar: string}> = messages;
const valid = (value: unknown): value is Language => value === 'en' || value === 'fa' || value === 'ar';
const storageKey = 'hive.console.language';
const Context = createContext<{language: Language; setLanguage: (language: Language) => void; t: Translate} | null>(null);

export function translate(text: string, language: Language, values: Record<string, string> = {}): string {
  const translated = language === 'en' ? text : dictionary[text]?.[language] ?? text;
  return translated.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function LocaleProvider({children}: {children: ReactNode}) {
  const [language, setLanguage] = useState<Language>(() => {
    try { const stored = localStorage.getItem(storageKey); if (valid(stored)) return stored; } catch { /* storage may be disabled */ }
    const browser = navigator.language.split('-')[0];
    return valid(browser) ? browser : 'en';
  });
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
    document.title = translate('Hive Operator Console', language);
    try { localStorage.setItem(storageKey, language); } catch { /* preference remains usable in memory */ }
  }, [language]);
  const value = useMemo(() => ({language, setLanguage, t: (text: string, values?: Record<string, string>) => translate(text, language, values)}), [language]);
  return <Context.Provider value={value}>
    <ConfigProvider direction={language === 'en' ? 'ltr' : 'rtl'} locale={language === 'fa' ? faIR : language === 'ar' ? arEG : enUS}
      theme={{token: {borderRadius: 6}}}>{children}</ConfigProvider>
  </Context.Provider>;
}

export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error('Console locale provider is missing');
  return value;
}

export function LanguagePicker() {
  const {language, setLanguage, t} = useI18n();
  return <Select data-testid="console-language" aria-label={t('Language')} value={language} onChange={setLanguage} style={{width: 125}}
    options={[{value: 'en', label: 'English'}, {value: 'fa', label: 'فارسی'}, {value: 'ar', label: 'العربية'}]} />;
}

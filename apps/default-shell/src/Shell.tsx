/**
 * Hive default shell — an optional, replaceable reference host. It is built only from public SDK packages:
 * auth (contexts, login), workspace (engine), mfe-runtime (loading), react (rendering helpers) and core (extensions).
 * Navigation and route access are UI hints; the BFF and authorization service enforce every operation.
 */
import {useEffect, useMemo, useState} from 'react';
import type {AnyHiveContext, ExtensionRegistration, RuntimeModule, RuntimeRoute, WorkspaceLayout, WorkspaceSlot} from '@hive-platform/contracts';
import {createAuth} from '@hive-platform/auth';
import {routeAccess} from '@hive-platform/authorization';
import {ExtensionRegistry} from '@hive-platform/core';
import {createHttpClient} from '@hive-platform/http-client';
import {MfeRuntime} from '@hive-platform/mfe-runtime';
import {ExtensionSlot, HiveProvider, useWorkspace, WorkspaceView} from '@hive-platform/react';
import {sessionPersistence, WorkspaceEngine} from '@hive-platform/workspace';

const auth = createAuth(createHttpClient());
const LAYOUTS: WorkspaceLayout[] = ['SINGLE', 'TABS', 'SPLIT', 'DASHBOARD'];
const diagnostics: unknown[] = [];

interface NavItem {module: RuntimeModule; route: RuntimeRoute}

/** Optional consumer configuration: an ES module at /shell-extensions.js default-exporting ExtensionRegistration[]. */
async function loadExtensions(registry: ExtensionRegistry): Promise<void> {
  try {
    const response = await fetch('/shell-extensions.js', {method: 'HEAD', cache: 'no-cache'});
    if (!response.ok || !(response.headers.get('Content-Type') ?? '').includes('javascript')) return;
    const module = await import(/* @vite-ignore */ `${location.origin}/shell-extensions.js`) as {default?: ExtensionRegistration[]};
    for (const extension of module.default ?? []) {
      try { registry.register(extension); } catch (error) { diagnostics.push(error); }
    }
  } catch (error) {
    diagnostics.push(error);
  }
}

function navigation(context: AnyHiveContext): NavItem[] {
  return context.modules.flatMap(module => module.routes.filter(route => route.navigation && routeAccess(route, module, context) === 'ALLOWED').map(route => ({module, route})))
    .sort((a, b) => (a.route.navigation?.order ?? 0) - (b.route.navigation?.order ?? 0));
}

function SlotChrome({slot, host, engine}: {slot: WorkspaceSlot; host: React.ReactNode; engine: WorkspaceEngine}) {
  const states: Partial<Record<WorkspaceSlot['status'], React.ReactNode>> = {
    LOADING: 'Loading…',
    ERROR: <span data-hive-error={slot.error?.code}>{slot.error?.code}: {slot.error?.message}</span>,
    DENIED: 'You are not permitted to open this page.',
    LOGIN_REQUIRED: <>Sign in to open this page. <button data-testid="slot-sign-in" onClick={() => auth.login(slot.route)}>Sign in</button></>,
  };
  return (
    <div className="slot-frame" data-testid={`slot-${slot.slotId}`}>
      <div className="slot-bar">
        <span>{slot.moduleKey} · {slot.route}</span>
        <button title="Close" data-testid={`close-${slot.slotId}`} onClick={() => void engine.close(slot.slotId)}>×</button>
      </div>
      {states[slot.status] && <div className="slot-state" data-kind={slot.status} data-testid="slot-state">{states[slot.status]}</div>}
      <div className="slot-body">{host}</div>
    </div>
  );
}

function Workspace({engine, context, registry}: {engine: WorkspaceEngine; context: AnyHiveContext; registry: ExtensionRegistry}) {
  const workspace = useWorkspace(engine);
  const active = workspace.slots.find(slot => slot.slotId === workspace.activeSlotId);
  const items = useMemo(() => navigation(context), [context]);

  // The URL mirrors the active slot's route only (never workspace state or sensitive data).
  useEffect(() => {
    if (active && active.route !== location.pathname) history.pushState(null, '', active.route);
  }, [active?.route, active?.slotId]);
  useEffect(() => {
    const onPop = () => {
      if (engine.workspace.activeSlotId) void engine.navigate(engine.workspace.activeSlotId, location.pathname);
      else engine.open(location.pathname);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [engine]);

  const go = (path: string) => {
    if (workspace.activeSlotId && workspace.layout !== 'DASHBOARD') void engine.navigate(workspace.activeSlotId, path);
    else engine.open(path);
  };
  return (
    <>
      <header className="shell-header">
        <span className="shell-brand" data-testid="brand">{context.branding.name}</span>
        <nav className="shell-nav" data-testid="navigation">
          {items.map(({module, route}) => (
            <span key={`${module.moduleKey}:${route.key}`}>
              <a href={route.path} data-route={`${module.moduleKey}:${route.key}`} aria-current={active?.route === route.path ? 'page' : undefined}
                onClick={event => { event.preventDefault(); go(route.path); }}>{route.navigation!.label}</a>
              {workspace.layout !== 'SINGLE' && <button className="open-new" title="Open in a new pane" data-open-new={`${module.moduleKey}:${route.key}`} onClick={() => engine.open(route.path)}>+</button>}
            </span>
          ))}
          <ExtensionSlot registry={registry} point="NAVIGATION" />
        </nav>
        <span className="shell-layouts" role="group" aria-label="Layout">
          {LAYOUTS.map(layout => <button key={layout} aria-pressed={workspace.layout === layout} data-layout-button={layout} onClick={() => void engine.setLayout(layout)}>{layout}</button>)}
        </span>
        <ExtensionSlot registry={registry} point="HEADER" />
        {context.authenticated
          ? <span><span data-testid="user">{context.identity.displayName}</span> <button data-testid="sign-out" onClick={async () => {
              await auth.logout();
              const next = await auth.currentContext();
              window.dispatchEvent(new CustomEvent('hive:context', {detail: next}));
            }}>Sign out</button></span>
          : <button data-testid="sign-in" onClick={() => auth.login(location.pathname)}>Sign in</button>}
      </header>
      <main className="shell-main">
        {workspace.layout === 'DASHBOARD' && <ExtensionSlot registry={registry} point="DASHBOARD" />}
        {workspace.layout === 'TABS' && (
          <div className="shell-tabs" role="tablist">
            {workspace.slots.map(slot => <button key={slot.slotId} role="tab" aria-selected={slot.slotId === workspace.activeSlotId} data-slot-tab={slot.slotId}
              onClick={() => engine.focus(slot.slotId)}>{slot.moduleKey}</button>)}
          </div>
        )}
        <WorkspaceView engine={engine} className="shell-workspace" frame={(slot, host) => <SlotChrome slot={slot} host={host} engine={engine} />} />
        {workspace.slots.length === 0 && <p data-testid="empty-workspace">Choose a page from the navigation.</p>}
      </main>
    </>
  );
}

export function Shell() {
  const [state, setState] = useState<{engine: WorkspaceEngine; context: AnyHiveContext; registry: ExtensionRegistry} | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const context = await auth.currentContext();
      const registry = new ExtensionRegistry(d => diagnostics.push(d));
      await loadExtensions(registry);
      const engine = new WorkspaceEngine({runtime: new MfeRuntime({onDiagnostic: d => diagnostics.push(d)}), context, id: 'shell',
        persistence: sessionPersistence('hive.shell.workspace'), onDiagnostic: d => diagnostics.push(d)});
      if (!engine.restore()) {
        const first = navigation(context)[0]?.route.path;
        const start = location.pathname !== '/' ? location.pathname : first;
        if (start) engine.open(start);
      } else if (location.pathname !== '/' && !engine.workspace.slots.some(s => s.route === location.pathname)) {
        engine.open(location.pathname);
      }
      let current = context;
      setState({engine, context, registry});
      Object.assign(window, {hiveShell: {engine, registry, diagnostics, get context() { return current; }}});
      window.addEventListener('hive:context', event => {
        current = (event as CustomEvent<AnyHiveContext>).detail;
        void engine.setContext(current);
        setState(previous => previous && {...previous, context: current});
      });
      document.body.setAttribute('data-hive-ready', 'true');
    })().catch(e => setError(String(e)));
  }, []);
  if (error) return <p data-testid="shell-error">Hive is unavailable: {error}</p>;
  if (!state) return <p>Loading…</p>;
  return <HiveProvider context={state.context}><Workspace engine={state.engine} context={state.context} registry={state.registry} /></HiveProvider>;
}

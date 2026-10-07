/**
 * @hive-platform/react — optional convenience for React consumers. Everything here is built on the framework-neutral
 * packages; no Hive package depends on this one. Other frameworks implement the same contracts directly.
 */
import {createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentType, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import type {AnyHiveContext, ExtensionPoint, HiveMicroApp, HiveMountContext, Workspace, WorkspaceSlot} from '@hive-platform/contracts';
import {permissionsOf} from '@hive-platform/authorization';
import type {ExtensionRegistry} from '@hive-platform/core';
import type {WorkspaceEngine} from '@hive-platform/workspace';

// ---- micro-app adapter ---------------------------------------------------------------------------------------

export interface ReactMicroAppProps {context:HiveMountContext}

/**
 * Wraps a React component as a HiveMicroApp. Each create() gets its own root; update() re-renders with the new
 * mount context; unmount() unmounts the root. The component receives the full mount context as a prop.
 */
export function createReactMicroApp(Component:ComponentType<ReactMicroAppProps>, options:{contractVersion?:HiveMicroApp['contractVersion']}={}):HiveMicroApp {
 return {
  contractVersion:options.contractVersion??'1.1.0',
  create(){
   let root:Root|null=null;
   return {
    mount(element,context){root=createRoot(element);root.render(<Component context={context} />);},
    update(context){root?.render(<Component context={context} />);},
    unmount(){root?.unmount();root=null;},
   };
  },
 };
}

// ---- context -------------------------------------------------------------------------------------------------

const HiveReactContext=createContext<AnyHiveContext|null>(null);

export function HiveProvider({context, children}:{context:AnyHiveContext; children:ReactNode}) {
 return <HiveReactContext.Provider value={context}>{children}</HiveReactContext.Provider>;
}

export function useHiveContext():AnyHiveContext {
 const context=useContext(HiveReactContext);
 if(!context)throw new Error('useHiveContext must be used inside <HiveProvider>');
 return context;
}

/** UI hint: whether the current context holds a permission (servers always re-check). */
export function usePermission(applicationKey:string, resourceKey:string, action:string):boolean {
 const context=useHiveContext();
 return useMemo(()=>permissionsOf(context).can(applicationKey,resourceKey,action),[context,applicationKey,resourceKey,action]);
}

// ---- workspace -----------------------------------------------------------------------------------------------

export function useWorkspace(engine:WorkspaceEngine):Workspace {
 return useSyncExternalStore(listener=>engine.state.subscribe(listener),()=>engine.state.get(),()=>engine.state.get());
}

/** Hands a stable element to the engine for one slot; the engine mounts whatever the slot's route resolves to. */
export function WorkspaceSlotHost({engine, slotId, className}:{engine:WorkspaceEngine; slotId:string; className?:string}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const element=ref.current;
  if(element)void engine.attach(slotId,element);
  return ()=>{void engine.detach(slotId);};
 },[engine,slotId]);
 return <div ref={ref} className={className} data-hive-slot-host={slotId} />;
}

/**
 * React renderer for a WorkspaceEngine. `frame` customizes the chrome around each slot (title, close button, status);
 * the slot host element itself is owned by the engine.
 */
export function WorkspaceView({engine, frame, className}:{engine:WorkspaceEngine; className?:string;
 frame?:(slot:WorkspaceSlot, host:ReactNode, workspace:Workspace)=>ReactNode}) {
 const workspace=useWorkspace(engine);
 return (
  <div className={className} data-layout={workspace.layout} data-hive-workspace={workspace.id}>
   {workspace.slots.map(slot=>{
    const host=<WorkspaceSlotHost key={slot.slotId} engine={engine} slotId={slot.slotId} />;
    const hidden=(workspace.layout==='SINGLE'||workspace.layout==='TABS')&&slot.slotId!==workspace.activeSlotId;
    return <section key={slot.slotId} hidden={hidden} data-slot-id={slot.slotId} data-status={slot.status} data-module={slot.moduleKey}>
     {frame?frame(slot,host,workspace):host}
    </section>;
   })}
  </div>
 );
}

// ---- extensions ----------------------------------------------------------------------------------------------

/** Renders every registered extension of a point into a container (extensions are framework-neutral). */
export function ExtensionSlot({registry, point, className}:{registry:ExtensionRegistry; point:ExtensionPoint; className?:string}) {
 const context=useHiveContext();
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>ref.current?registry.render(point,ref.current,context):undefined,[registry,point,context]);
 return <div ref={ref} className={className} data-hive-extension-point={point} />;
}

/**
 * @hive-platform/workspace — headless multi-slot workspace engine (SINGLE, TABS, SPLIT, DASHBOARD), inter-app event
 * hub and safe persistence, plus an optional plain-DOM renderer. Usable by any host; the default shell is one client.
 */
export {WorkspaceEngine, LAYOUT_CAPACITY, type Resolution, type WorkspaceEngineOptions} from './engine.js';
export {HiveEventHub, type EventScope} from './event-bus.js';
export {sanitizeState, sessionPersistence, memoryPersistence, WORKSPACE_SCHEMA_VERSION, type WorkspacePersistence} from './persistence.js';
export {renderDomWorkspace, type DomRendererOptions} from './dom-renderer.js';

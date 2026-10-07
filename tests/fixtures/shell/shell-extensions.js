// Consumer-provided shell extensions (test fixture). Deployed next to the default shell; no shell source changes.
const banner = {
  key: 'campus.banner', point: 'HEADER', version: '1.0.0', contractVersion: '1.1.0',
  render(element, context) {
    element.setAttribute('data-testid', 'extension-banner');
    element.textContent = context.authenticated ? `Welcome back, ${context.identity.displayName}` : 'Open day this Friday';
  },
};
const annotations = {
  key: 'campus.annotations-link', point: 'NAVIGATION', version: '1.0.0', contractVersion: '1.1.0',
  requires: ['campus-example:student-example.list:annotate'],
  render(element) {
    const link = document.createElement('a');
    link.href = '/students'; link.textContent = 'Annotations'; link.setAttribute('data-testid', 'extension-annotations');
    element.appendChild(link);
    return () => link.remove();
  },
};
const widget = {
  key: 'campus.dashboard-widget', point: 'DASHBOARD', version: '1.0.0', contractVersion: '1.1.0',
  render(element) { element.setAttribute('data-testid', 'extension-dashboard'); element.textContent = 'Dashboard summary widget'; },
};
export default [banner, annotations, widget];

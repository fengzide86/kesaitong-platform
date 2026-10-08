/** Legacy compatibility is opt-in for isolated fixtures, never a production UI. */
export function allowLegacyDemoFixture(explicitlyAllowed = false): boolean {
  return explicitlyAllowed && (import.meta.env.DEV || import.meta.env.MODE === 'test')
}

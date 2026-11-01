import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenerProvider, useScreenerContext } from '../pages/equity/screener/ScreenerContext';
vi.mock('../api/client', () => ({
  fetchScreenerPresetsV3: async () => [{ id: 'default', name: 'Default', query: 'ROCE > 12' }],
  fetchSavedScreensV3: async () => [{ id: 'chosen', name: 'Chosen', query: 'ROE > 20' }],
  fetchPublicScreensV3: async () => [], fetchScreenerUniversesV3: async () => [], runScreenerV3: vi.fn(),
}));
function Consumer() {
  const context = useScreenerContext();
  useEffect(() => {
    const found = context.savedScreens.find(s => s.id === new URLSearchParams(window.location.search).get('screen'));
    if (found) context.loadSavedScreen(found);
  }, [context.savedScreens, context.loadSavedScreen]);
  return <output>{context.activeSavedScreenId}:{context.query}</output>;
}
afterEach(() => window.history.replaceState({}, '', '/'));
it('does not let asynchronous default preset selection overwrite a restored saved-screen query', async () => {
  window.history.replaceState({}, '', '/equity/screener?screen=chosen');
  render(<ScreenerProvider><Consumer/></ScreenerProvider>);
  expect(await screen.findByText('chosen:ROE > 20')).toBeInTheDocument();
  expect(screen.queryByText('chosen:ROCE > 12')).not.toBeInTheDocument();
});

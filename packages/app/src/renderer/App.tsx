import { useState } from 'react';
import type { AppState } from '../shared/api';
import { EditorPlaceholder } from './screens/EditorPlaceholder';
import { Library } from './screens/Library';

type Screen = { name: 'library' } | { name: 'editor'; schemeId: string };

/** The screen under the header: the Library, or the Editor on one scheme. */
export function App({ state }: { state: AppState | null }) {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  if (screen.name === 'editor') {
    return (
      <EditorPlaceholder schemeId={screen.schemeId} onBack={() => setScreen({ name: 'library' })} />
    );
  }
  return (
    <Library state={state} onOpenEditor={(schemeId) => setScreen({ name: 'editor', schemeId })} />
  );
}

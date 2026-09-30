import { describe, it, expect, beforeEach } from 'vitest';
import {
  isCustomWidgetId,
  selectAllCustomCardIds,
  selectCustomCardIds,
  useCustomCardsStore,
  MAX_CUSTOM_CARDS_PER_SCOPE,
} from './customCardsStore';

const SCOPE = { uid: 'test-user', orgId: '' };

beforeEach(() => {
  useCustomCardsStore.setState({ cardsByScope: {} });
});

describe('customCardsStore', () => {
  it('adds a valid card with a stable custom id', () => {
    const id = useCustomCardsStore
      .getState()
      .addCard(SCOPE, { label: 'My views', metric: 'views', period: 30 });
    expect(id).toMatch(/^custom:[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/);
    expect(isCustomWidgetId(id ?? '')).toBe(true);
    expect(isCustomWidgetId('views')).toBe(false);
    const cards = useCustomCardsStore.getState().cardsByScope['test-user::personal'];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ label: 'My views', metric: 'views', period: 30 });
  });

  it('rejects invalid input', () => {
    const state = useCustomCardsStore.getState();
    expect(state.addCard(SCOPE, { label: '   ', metric: 'views', period: 30 })).toBeNull();
    expect(state.addCard(SCOPE, { label: 'x', metric: 'nope', period: 30 })).toBeNull();
    expect(
      state.addCard(SCOPE, { label: 'x', metric: 'views', period: 14 as 30 }),
    ).toBeNull();
    expect(selectCustomCardIds(useCustomCardsStore.getState().cardsByScope, SCOPE)).toEqual([]);
  });

  it('removes cards and selects ids per scope', () => {
    const state = useCustomCardsStore.getState();
    const id = state.addCard(SCOPE, { label: 'Likes', metric: 'likes', period: 7 });
    const orgScope = { uid: 'test-user', orgId: 'org-1' };
    state.addCard(orgScope, { label: 'Org views', metric: 'views', period: 90 });
    expect(selectCustomCardIds(useCustomCardsStore.getState().cardsByScope, SCOPE)).toEqual([id]);
    expect(selectAllCustomCardIds(useCustomCardsStore.getState().cardsByScope)).toHaveLength(2);
    useCustomCardsStore.getState().removeCard(SCOPE, id ?? '');
    expect(selectCustomCardIds(useCustomCardsStore.getState().cardsByScope, SCOPE)).toEqual([]);
    expect(selectAllCustomCardIds(useCustomCardsStore.getState().cardsByScope)).toHaveLength(1);
  });

  it('caps cards per scope', () => {
    const state = useCustomCardsStore.getState();
    for (let i = 0; i < MAX_CUSTOM_CARDS_PER_SCOPE + 2; i += 1) {
      state.addCard(SCOPE, { label: `Card ${i}`, metric: 'views', period: 30 });
    }
    expect(selectCustomCardIds(useCustomCardsStore.getState().cardsByScope, SCOPE)).toHaveLength(
      MAX_CUSTOM_CARDS_PER_SCOPE,
    );
  });
});

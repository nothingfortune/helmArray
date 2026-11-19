import { describe, expect, it } from 'vitest';
import type { AppState } from '../shared/api';
import { watchState } from './appState';

const state = (label: string): AppState => ({
  devices: [],
  sync: { label, tone: 'ok' },
  writeBlock: null,
  question: null,
});

/** A fake `helm`: the test decides when state() answers and pushes states itself. */
function fakeApi() {
  let answer!: (value: AppState) => void;
  let fail!: (error: Error) => void;
  const pending = new Promise<AppState>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  const listeners = new Set<(state: AppState) => void>();
  return {
    api: {
      state: () => pending,
      onState: (listener: (state: AppState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    answer,
    fail,
    push: (value: AppState) => listeners.forEach((listener) => listener(value)),
    listening: () => listeners.size,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('watchState', () => {
  it('tells the listener the state now', async () => {
    const helm = fakeApi();
    const seen: string[] = [];
    watchState(helm.api, (s) => seen.push(s.sync.label));
    helm.answer(state('now'));
    await flush();
    expect(seen).toEqual(['now']);
  });

  it('then every change', async () => {
    const helm = fakeApi();
    const seen: string[] = [];
    watchState(helm.api, (s) => seen.push(s.sync.label));
    helm.answer(state('now'));
    await flush();
    helm.push(state('next'));
    helm.push(state('after'));
    expect(seen).toEqual(['now', 'next', 'after']);
  });

  it('drops the late answer when a newer state was already pushed', async () => {
    const helm = fakeApi();
    const seen: string[] = [];
    watchState(helm.api, (s) => seen.push(s.sync.label));
    helm.push(state('pushed'));
    helm.answer(state('stale'));
    await flush();
    expect(seen).toEqual(['pushed']);
  });

  it('stops listening, and ignores an answer that arrives after', async () => {
    const helm = fakeApi();
    const seen: string[] = [];
    const stop = watchState(helm.api, (s) => seen.push(s.sync.label));
    expect(helm.listening()).toBe(1);
    stop();
    expect(helm.listening()).toBe(0);
    helm.answer(state('late'));
    await flush();
    expect(seen).toEqual([]);
  });

  it('survives a failed first read and still shows what is pushed', async () => {
    const helm = fakeApi();
    const seen: string[] = [];
    watchState(helm.api, (s) => seen.push(s.sync.label));
    helm.fail(new Error('no answer'));
    await flush();
    helm.push(state('pushed'));
    expect(seen).toEqual(['pushed']);
  });
});

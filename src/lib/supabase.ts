import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// expo-secure-store has a 2048-byte limit per key.
// Supabase session tokens can exceed that, so we chunk large values.
const CHUNK_SIZE = 1900;

const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const numChunks = parseInt((await SecureStore.getItemAsync(`${key}__n`)) ?? '0');
      if (!numChunks) return null;
      let value = '';
      for (let i = 0; i < numChunks; i++) {
        value += (await SecureStore.getItemAsync(`${key}__${i}`)) ?? '';
      }
      return value;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    const numChunks = Math.ceil(value.length / CHUNK_SIZE);
    await SecureStore.setItemAsync(`${key}__n`, String(numChunks));
    for (let i = 0; i < numChunks; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  },
  async removeItem(key: string): Promise<void> {
    const numChunks = parseInt((await SecureStore.getItemAsync(`${key}__n`)) ?? '0');
    await SecureStore.deleteItemAsync(`${key}__n`);
    for (let i = 0; i < numChunks; i++) {
      await SecureStore.deleteItemAsync(`${key}__${i}`);
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Cached so ownership checks in the UI don't need an async call on every render.
// App.tsx awaits ensureAuth() before the first screen mounts.
let userId: string | null = null;

export function getUserId(): string | null {
  return userId;
}

export async function ensureAuth(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    userId = session.user.id;
    return;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn('Anonymous sign-in failed:', error.message);
    return;
  }
  userId = data.user?.id ?? null;
}

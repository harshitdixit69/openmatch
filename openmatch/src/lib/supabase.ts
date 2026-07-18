import { Platform } from 'react-native';

if (Platform.OS !== 'web') {
    require('react-native-url-polyfill/auto');
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        'Missing Supabase environment variables. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
}

const webLocalStorageFallback = {
    getItem: (key: string): string | null => {
        try {
            return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        } catch {
            return null;
        }
    },
    setItem: (key: string, value: string): void => {
        try {
            if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
        } catch {}
    },
    removeItem: (key: string): void => {
        try {
            if (typeof window !== 'undefined') window.localStorage.removeItem(key);
        } catch {}
    }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: Platform.OS === 'web' ? webLocalStorageFallback : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
    },
});

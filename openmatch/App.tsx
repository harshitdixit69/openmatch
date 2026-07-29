import { useEffect, useState } from 'react';

console.log('[DEBUG] App.tsx module evaluated! Bundle timestamp: 19:07:00');

import { StatusBar } from 'expo-status-bar';
import { Session } from '@supabase/supabase-js';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import { fetchCurrentProfile } from './src/lib/profileApi';
import { AuthScreen } from './src/screens/AuthScreen';
import { MainTabsScreen } from './src/screens/MainTabsScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ThemeProvider } from './src/lib/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [hasCompletedProfile, setHasCompletedProfile] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function syncSessionState(nextSession: Session | null) {
      console.log('[DEBUG] syncSessionState called! session user ID:', nextSession?.user?.id ?? 'none');
      if (!isMounted) return;

      setSession(nextSession);

      if (!nextSession) {
        setHasCompletedProfile(false);
        return;
      }

      try {
        console.log('[DEBUG] Fetching current profile...');
        const profile = await fetchCurrentProfile(nextSession.user.id);
        console.log('[DEBUG] Profile fetched:', profile ? 'exists' : 'null');
        if (!isMounted) return;
        setHasCompletedProfile(Boolean(profile?.onboarding_completed_at));
      } catch (error) {
        console.error('Failed to load profile state during app bootstrap.', error);
        if (!isMounted) return;
        setHasCompletedProfile(false);
      }
    }

    async function bootstrap() {
      console.log('[DEBUG] App bootstrap started...');
      try {
        // H15 FIX: Removed hardcoded 1500ms timeout that caused false logouts
        // on slow networks. We now await getSession() without a race condition.
        // The onAuthStateChange listener below handles subsequent auth updates.
        const { data, error } = await supabase.auth.getSession();
        console.log('[DEBUG] Auth session request finished. Session user:', data?.session?.user?.id ?? 'none', 'Error:', error);

        if (error) {
          throw error;
        }

        await syncSessionState(data.session);
        console.log('[DEBUG] syncSessionState finished.');
      } catch (error) {
        console.error('Failed to restore auth session.', error);
        if (!isMounted) return;
        setSession(null);
        setHasCompletedProfile(false);
      } finally {
        console.log('[DEBUG] App bootstrap finally block. isMounted:', isMounted);
        if (isMounted) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        void syncSessionState(nextSession);
      },
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (isBootstrapping) {
    return (
      <SafeAreaProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#11313c" />
              <StatusBar style="auto" />
            </View>
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          {!session ? <AuthScreen /> : hasCompletedProfile ? <MainTabsScreen /> : <OnboardingScreen onComplete={() => setHasCompletedProfile(true)} />}
          <StatusBar style="auto" />
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#eff6f8',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

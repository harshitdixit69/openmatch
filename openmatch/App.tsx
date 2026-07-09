import { useEffect, useState } from 'react';

import { StatusBar } from 'expo-status-bar';
import { Session } from '@supabase/supabase-js';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './src/lib/supabase';
import { fetchCurrentProfile } from './src/lib/profileApi';
import { AuthScreen } from './src/screens/AuthScreen';
import { MainTabsScreen } from './src/screens/MainTabsScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [hasCompletedProfile, setHasCompletedProfile] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function syncSessionState(nextSession: Session | null) {
      if (!isMounted) return;

      setSession(nextSession);

      if (!nextSession) {
        setHasCompletedProfile(false);
        return;
      }

      try {
        const profile = await fetchCurrentProfile(nextSession.user.id);
        if (!isMounted) return;
        setHasCompletedProfile(Boolean(profile?.onboarding_completed_at));
      } catch (error) {
        console.error('Failed to load profile state during app bootstrap.', error);
        if (!isMounted) return;
        setHasCompletedProfile(false);
      }
    }

    async function bootstrap() {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        await syncSessionState(data.session);
      } catch (error) {
        console.error('Failed to restore auth session.', error);
        if (!isMounted) return;
        setSession(null);
        setHasCompletedProfile(false);
      } finally {
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#11313c" />
          <StatusBar style="dark" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      {!session ? <AuthScreen /> : hasCompletedProfile ? <MainTabsScreen /> : <OnboardingScreen onComplete={() => setHasCompletedProfile(true)} />}
      <StatusBar style="dark" />
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

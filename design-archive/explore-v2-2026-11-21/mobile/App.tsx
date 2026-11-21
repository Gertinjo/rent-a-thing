import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/auth';
import GlassTabBar from './src/components/GlassTabBar';
import type { RootStackParamList } from './src/navigation';
import { AdminApprovalsScreen, AdminHomeScreen, AdminInboxScreen } from './src/screens/AdminScreens';
import { LoginScreen, RegisterScreen } from './src/screens/AuthScreens';
import BookingsScreen from './src/screens/BookingsScreen';
import ExploreScreen from './src/screens/ExploreScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import ListingEditorScreen from './src/screens/ListingEditorScreen';
import MyListingsScreen from './src/screens/MyListingsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import {
  AboutScreen,
  AppearanceScreen,
  ContactScreen,
  EditProfileScreen,
  HelpScreen,
  LegalScreen,
} from './src/screens/SettingsScreens';
import Viewer360Screen from './src/screens/Viewer360Screen';
import { ThemeProvider, useTheme } from './src/theme';

// In a browser, hide the default focus outline on text fields (the fields draw their own focus state)
// and stop the page itself from rubber-banding, so it feels like an app rather than a web page.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const css = document.createElement('style');
  css.textContent =
    'input, textarea { outline: none !important; } html, body { overscroll-behavior: none; } * { -webkit-tap-highlight-color: transparent; }';
  document.head.appendChild(css);
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function Tabs() {
  return (
    <Tab.Navigator tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen name="Bookings" component={BookingsScreen} />
      <Tab.Screen name="My things" component={MyListingsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { user, loading } = useAuth();
  const { c } = useTheme();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.text2} />
      </View>
    );
  }
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      {user ? (
        <>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
          <Stack.Screen name="ListingEditor" component={ListingEditorScreen} options={{ presentation: 'modal' }} />
          <Stack.Screen name="Review" component={ReviewScreen} options={{ presentation: 'modal' }} />
          <Stack.Screen name="Viewer360" component={Viewer360Screen} options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
          <Stack.Screen name="Appearance" component={AppearanceScreen} />
          <Stack.Screen name="Contact" component={ContactScreen} />
          <Stack.Screen name="Help" component={HelpScreen} />
          <Stack.Screen name="Legal" component={LegalScreen} />
          <Stack.Screen name="About" component={AboutScreen} />
          {user.is_admin && (
            <>
              <Stack.Screen name="Admin" component={AdminHomeScreen} />
              <Stack.Screen name="AdminApprovals" component={AdminApprovalsScreen} />
              <Stack.Screen name="AdminInbox" component={AdminInboxScreen} />
            </>
          )}
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

/**
 * It's a phone app. On a phone (native or phone browser) it fills the screen; in a wide desktop
 * browser it's shown inside a phone-sized frame instead of stretching across the monitor.
 */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const { c, scheme } = useTheme();
  if (Platform.OS !== 'web' || width < 600) return <>{children}</>;
  return (
    <View style={[frame.page, { backgroundColor: scheme === 'dark' ? '#0E0E10' : '#D9D9DE' }]}>
      <View style={[frame.phone, { height: Math.min(880, height - 40), backgroundColor: c.bg }]}>{children}</View>
    </View>
  );
}

const frame = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  phone: {
    width: 402,
    borderRadius: 48,
    overflow: 'hidden',
    borderWidth: 11,
    borderColor: '#0B0B0C',
    boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
  },
});

function Themed() {
  const { c, scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <PhoneFrame>
      <SafeAreaProvider>
        <AuthProvider>
          <NavigationContainer
            theme={{ ...base, colors: { ...base.colors, background: c.bg, card: c.bg, primary: c.accent, text: c.text, border: c.separator } }}
          >
            <Root />
          </NavigationContainer>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        </AuthProvider>
      </SafeAreaProvider>
    </PhoneFrame>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Themed />
    </ThemeProvider>
  );
}

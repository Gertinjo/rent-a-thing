import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth';
import { Button, Field, NavHeader } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { makeStyles, type, useTheme } from '../theme';

function Wordmark() {
  const { c } = useTheme();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.accent }} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: c.text2, letterSpacing: 1.5 }}>RENT A THING</Text>
      </View>
      <Text style={{ fontSize: 40, lineHeight: 44, fontWeight: '800', color: c.text, letterSpacing: -1.2 }}>
        Borrow it from{'\n'}next door.
      </Text>
      <Text style={{ ...type.body, color: c.text2 }}>
        Tools, cameras, tents and bikes from people on your street — by the day, checked in 360° before you book.
      </Text>
    </View>
  );
}

export function LoginScreen({ navigation }: ScreenProps<'Login'>) {
  const { signIn } = useAuth();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null);

  const go = async (e: string, p: string, which: 'login' | 'demo') => {
    setBusy(which);
    try {
      await signIn(e, p);
    } catch (err: any) {
      Alert.alert('Couldn’t log in', err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.wrap, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Wordmark />
        <View style={{ gap: 12, marginTop: 36 }}>
          <Field value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" autoComplete="email" />
          <Field value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" autoComplete="password" />
          <Button title="Log in" onPress={() => go(email, password, 'login')} loading={busy === 'login'} disabled={!!busy || !email || !password} style={{ marginTop: 6 }} />
          <Button title="Explore with a demo account" variant="secondary" onPress={() => go('demo@rentathing.app', 'demo1234', 'demo')} loading={busy === 'demo'} disabled={!!busy} />
          <Button title="Demo admin" variant="plain" size="small" onPress={() => go('admin@rentathing.app', 'admin1234', 'demo')} disabled={!!busy} />
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => navigation.navigate('Register')} style={{ alignSelf: 'center', padding: 12 }}>
          <Text style={s.link}>
            New here? <Text style={s.linkStrong}>Create an account</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function RegisterScreen({ navigation }: ScreenProps<'Register'>) {
  const { signUp } = useAuth();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [f, setF] = useState({ name: '', email: '', password: '', neighborhood: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const go = async () => {
    setBusy(true);
    try {
      await signUp(f);
    } catch (err: any) {
      Alert.alert('Couldn’t create your account', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <NavHeader onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[s.wrap, { paddingTop: 8, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Create your account</Text>
        <Text style={s.sub}>It takes 20 seconds. Your email stays private.</Text>
        <View style={{ gap: 14, marginTop: 24 }}>
          <Field label="Name" value={f.name} onChangeText={set('name')} placeholder="Jamie Lee" autoComplete="name" />
          <Field label="Neighbourhood" value={f.neighborhood} onChangeText={set('neighborhood')} placeholder="Maple Street" />
          <Field label="Email" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label="Password" value={f.password} onChangeText={set('password')} secureTextEntry hint="At least 6 characters" autoComplete="new-password" />
          <Button title="Create account" onPress={go} loading={busy} disabled={!f.name || !f.email || f.password.length < 6} style={{ marginTop: 8 }} />
          <Text style={s.legal}>By continuing you agree to our Terms of Service and Privacy Policy.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  wrap: { paddingHorizontal: 24, flexGrow: 1 },
  title: { ...type.largeTitle, color: c.text },
  sub: { ...type.body, color: c.text2, marginTop: 6 },
  link: { ...type.callout, color: c.text2 },
  linkStrong: { color: c.accent, fontWeight: '600' },
  legal: { ...type.footnote, color: c.text2, textAlign: 'center', lineHeight: 18 },
}));

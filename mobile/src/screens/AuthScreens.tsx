import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth';
import LogoMark from '../components/LogoMark';
import { Button, Field, NavHeader } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { makeStyles, type, useTheme } from '../theme';

function Wordmark() {
  const { c } = useTheme();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <LogoMark size={30} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: c.text2, letterSpacing: 1.5 }}>RENTIFY</Text>
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
  const { c } = useTheme();
  const [f, setF] = useState({ name: '', email: '', password: '', neighborhood: '' });
  // Renters go straight in; lenders need an admin to approve them before they can list.
  const [lender, setLender] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const go = async () => {
    setBusy(true);
    try {
      await signUp({ ...f, lender });
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
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            {[
              { v: false, icon: 'bag-handle-outline' as const, t: 'I just want to rent', d: 'Start right away. You verify your ID once before your first booking.' },
              { v: true, icon: 'cube-outline' as const, t: 'I want to rent and lend', d: 'Rent right away. Listing your things unlocks after an admin approves you.' },
            ].map((o) => {
              const on = lender === o.v;
              return (
                <Pressable
                  key={String(o.v)}
                  onPress={() => setLender(o.v)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[s.choice, { borderColor: on ? c.accent : c.separator, backgroundColor: on ? c.accent + '14' : c.surface }]}
                >
                  <Ionicons name={o.icon} size={22} color={on ? c.accent : c.text2} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.choiceTitle}>{o.t}</Text>
                    <Text style={s.choiceText}>{o.d}</Text>
                  </View>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? c.accent : c.text3} />
                </Pressable>
              );
            })}
          </View>
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
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5 },
  choiceTitle: { ...type.headline, color: c.text },
  choiceText: { ...type.subhead, color: c.text2, lineHeight: 19 },
}));

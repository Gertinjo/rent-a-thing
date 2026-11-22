import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ContactTopic } from '../api';
import { useAuth } from '../auth';
import { Avatar, Button, Field, ListGroup, ListRow, NavHeader } from '../components/ui';
import { APP, FAQ, LEGAL } from '../content';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { ACCENTS, AccentKey, buildColors, makeStyles, Mode, type, useTheme } from '../theme';

/** Shared shell: grouped background, nav header, scroll. */
function Page({
  title,
  onBack,
  right,
  children,
  grouped = true,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
  grouped?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: grouped ? c.grouped : c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NavHeader title={title} onBack={onBack} right={right} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 28 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ===========================================================================
// Edit profile
// ===========================================================================

export function EditProfileScreen({ navigation }: ScreenProps<'EditProfile'>) {
  const { user, setUser, signOut } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const [f, setF] = useState({ name: user?.name ?? '', neighborhood: user?.neighborhood ?? '', bio: user?.bio ?? '' });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ open: false, current: '', next: '', busy: false });
  const [del, setDel] = useState({ open: false, password: '', busy: false });
  if (!user) return null;

  const dirty = f.name !== user.name || f.neighborhood !== user.neighborhood || f.bio !== user.bio;

  const save = async () => {
    if (!f.name.trim()) return Alert.alert('Your name can’t be empty');
    setSaving(true);
    try {
      setUser(await api.updateMe({ name: f.name.trim(), neighborhood: f.neighborhood.trim(), bio: f.bio.trim() }));
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Couldn’t save', e.message);
    } finally {
      setSaving(false);
    }
  };

  const changeAvatar = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (res.canceled) return;
    try {
      const a = res.assets[0];
      setUser(await api.uploadAvatar({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, file: a.file }));
    } catch (e: any) {
      Alert.alert('Upload failed', e.message);
    }
  };

  const changePassword = async () => {
    setPw((p) => ({ ...p, busy: true }));
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ open: false, current: '', next: '', busy: false });
      Alert.alert('Password changed');
    } catch (e: any) {
      Alert.alert('Couldn’t change password', e.message);
      setPw((p) => ({ ...p, busy: false }));
    }
  };

  const deleteAccount = async () => {
    setDel((d) => ({ ...d, busy: true }));
    try {
      await api.deleteAccount(del.password);
      setDel({ open: false, password: '', busy: false });
      await signOut();
    } catch (e: any) {
      Alert.alert('Couldn’t delete account', e.message);
      setDel((d) => ({ ...d, busy: false }));
    }
  };

  return (
    <Page
      title="Edit profile"
      onBack={() => navigation.goBack()}
      right={<Button title="Save" size="small" variant="plain" onPress={save} loading={saving} disabled={!dirty} />}
    >
      <Pressable onPress={changeAvatar} style={{ alignItems: 'center', gap: 10 }}>
        <Avatar name={f.name || user.name} url={user.avatar_url} size={96} />
        <Text style={{ color: c.accent, fontWeight: '600', fontSize: 16 }}>{user.avatar_url ? 'Change photo' : 'Add photo'}</Text>
      </Pressable>

      <View style={s.formCard}>
        <Field label="Name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} maxLength={80} />
        <Field label="Neighbourhood" value={f.neighborhood} onChangeText={(v) => setF({ ...f, neighborhood: v })} placeholder="Maple Street" maxLength={80} />
        <Field
          label="About you"
          value={f.bio}
          onChangeText={(v) => setF({ ...f, bio: v })}
          placeholder="What do you lend? What do you borrow? A line about you."
          multiline
          maxLength={300}
          hint={`${f.bio.length}/300 · shown on your profile and listings`}
          style={{ minHeight: 100, textAlignVertical: 'top' }}
        />
      </View>

      <ListGroup title="Private" footer="Your email is never shown to other people.">
        <ListRow icon="mail" iconColor="#8E8E93" label="Email" value={user.email} chevron={false} />
        <ListRow icon="key" iconColor="#8E8E93" label="Change password" onPress={() => setPw((p) => ({ ...p, open: !p.open }))} />
      </ListGroup>

      {pw.open && (
        <View style={s.formCard}>
          <Field label="Current password" value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} secureTextEntry autoComplete="password" />
          <Field label="New password" value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} secureTextEntry hint="At least 6 characters" autoComplete="new-password" />
          <Button title="Update password" onPress={changePassword} loading={pw.busy} disabled={!pw.current || pw.next.length < 6} />
        </View>
      )}

      <ListGroup footer="Deleting hides your listings, cancels open requests and removes your profile. Past rentals and reviews stay, anonymised.">
        <ListRow label="Delete account" destructive chevron={false} onPress={() => setDel({ ...del, open: true })} />
      </ListGroup>

      <Modal visible={del.open} transparent animationType="fade" onRequestClose={() => setDel({ ...del, open: false })}>
        <View style={s.dialogBg}>
          <View style={s.dialog}>
            <Ionicons name="warning" size={32} color={c.danger} style={{ alignSelf: 'center' }} />
            <Text style={s.dialogTitle}>Delete your account?</Text>
            <Text style={s.dialogText}>This can’t be undone. Enter your password to confirm.</Text>
            <Field value={del.password} onChangeText={(v) => setDel({ ...del, password: v })} secureTextEntry placeholder="Password" autoFocus />
            <Button title="Delete my account" onPress={deleteAccount} loading={del.busy} disabled={!del.password} style={{ marginTop: 4 }} />
            <Button title="Cancel" variant="plain" onPress={() => setDel({ open: false, password: '', busy: false })} />
          </View>
        </View>
      </Modal>
    </Page>
  );
}

// ===========================================================================
// Appearance
// ===========================================================================

function ModePreview({ scheme, label, active, onPress }: { scheme: 'light' | 'dark' | 'split'; label: string; active: boolean; onPress: () => void }) {
  const { c, accentKey } = useTheme();
  const s = useStyles();
  const mini = (sch: 'light' | 'dark') => {
    const k = buildColors(sch, accentKey);
    return (
      <View style={{ flex: 1, backgroundColor: k.bg, padding: 8, gap: 5 }}>
        <View style={{ height: 6, width: '55%', borderRadius: 3, backgroundColor: k.text }} />
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <View style={{ flex: 1, height: 30, borderRadius: 6, backgroundColor: k.imageBg }} />
          <View style={{ flex: 1, height: 30, borderRadius: 6, backgroundColor: k.imageBg }} />
        </View>
        <View style={{ height: 4, width: '70%', borderRadius: 2, backgroundColor: k.text3 }} />
        <View style={{ flex: 1 }} />
        <View style={{ height: 12, borderRadius: 6, backgroundColor: k.glassTint, borderWidth: 1, borderColor: k.separator, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: k.accent }} />
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: k.text3 }} />
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: k.text3 }} />
        </View>
      </View>
    );
  };
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 10 }}>
      <View style={[s.preview, { borderColor: active ? c.accent : c.separator }]}>
        {scheme === 'split' ? (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {mini('light')}
            {mini('dark')}
          </View>
        ) : (
          mini(scheme)
        )}
      </View>
      <Text style={{ color: c.text, fontWeight: '500', fontSize: 15 }}>{label}</Text>
      <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={active ? c.accent : c.text3} />
    </Pressable>
  );
}

export function AppearanceScreen({ navigation }: ScreenProps<'Appearance'>) {
  const { c, scheme, mode, setMode, accentKey, setAccent } = useTheme();
  const s = useStyles();
  const modes: { m: Mode; label: string; scheme: 'light' | 'dark' | 'split' }[] = [
    { m: 'light', label: 'Light', scheme: 'light' },
    { m: 'dark', label: 'Dark', scheme: 'dark' },
    { m: 'system', label: 'Automatic', scheme: 'split' },
  ];
  return (
    <Page title="Appearance" onBack={() => navigation.goBack()}>
      <View style={{ gap: 7 }}>
        <Text style={s.groupTitle}>Theme</Text>
        <View style={[s.formCard, { flexDirection: 'row', gap: 10, paddingVertical: 20 }]}>
          {modes.map((x) => (
            <ModePreview key={x.m} scheme={x.scheme} label={x.label} active={mode === x.m} onPress={() => setMode(x.m)} />
          ))}
        </View>
        <Text style={s.footer}>Automatic follows your phone’s light or dark setting.</Text>
      </View>

      <View style={{ gap: 7 }}>
        <Text style={s.groupTitle}>Accent colour</Text>
        <View style={[s.formCard, { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 }]}>
          {(Object.keys(ACCENTS) as AccentKey[]).map((k) => {
            const on = k === accentKey;
            const kc = buildColors(scheme, k);
            const col = kc.accent;
            return (
              <Pressable key={k} onPress={() => setAccent(k)} style={{ alignItems: 'center', gap: 8 }} accessibilityLabel={ACCENTS[k].name}>
                <View style={[s.swatchRing, { borderColor: on ? col : 'transparent' }]}>
                  <View style={[s.swatch, { backgroundColor: col }]}>{on && <Ionicons name="checkmark" size={18} color={kc.onAccent} />}</View>
                </View>
                <Text style={{ fontSize: 12, color: on ? c.text : c.text2, fontWeight: on ? '600' : '400' }}>{ACCENTS[k].name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 7 }}>
        <Text style={s.groupTitle}>Preview</Text>
        <View style={[s.formCard, { gap: 12 }]}>
          <Text style={{ ...type.headline, color: c.text }}>Cordless drill 18V</Text>
          <Text style={{ ...type.subhead, color: c.text2 }}>€8 / day · Qyteza Pejton</Text>
          <Button title="Request" />
        </View>
      </View>
    </Page>
  );
}

// ===========================================================================
// Contact us
// ===========================================================================

const TOPICS: { v: ContactTopic; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { v: 'general', label: 'Question', icon: 'help-circle-outline' },
  { v: 'booking', label: 'A booking', icon: 'calendar-outline' },
  { v: 'safety', label: 'Safety', icon: 'shield-outline' },
  { v: 'bug', label: 'Bug', icon: 'bug-outline' },
  { v: 'feedback', label: 'Idea', icon: 'bulb-outline' },
];

export function ContactScreen({ route, navigation }: ScreenProps<'Contact'>) {
  const { user } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const [topic, setTopic] = useState<ContactTopic>(route.params?.topic ?? 'general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await api.contact({ topic, message, email, booking_id: route.params?.bookingId });
      setSent(true);
    } catch (e: any) {
      Alert.alert('Couldn’t send', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Page title="Contact us" onBack={() => navigation.goBack()} grouped={false}>
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 60 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="checkmark" size={36} color={c.accent} />
          </View>
          <Text style={{ ...type.title2, color: c.text }}>Message sent</Text>
          <Text style={{ ...type.body, color: c.text2, textAlign: 'center' }}>
            We usually reply {APP.responseTime} to {email || 'your email'}.
          </Text>
          <Button title="Done" onPress={() => navigation.goBack()} style={{ marginTop: 16, alignSelf: 'stretch' }} />
        </View>
      </Page>
    );
  }

  return (
    <Page title="Contact us" onBack={() => navigation.goBack()}>
      <View style={{ gap: 6, paddingHorizontal: 4 }}>
        <Text style={{ ...type.title, color: c.text }}>How can we help?</Text>
        <Text style={{ ...type.callout, color: c.text2, lineHeight: 21 }}>
          {topic === 'safety'
            ? 'If someone is in danger, call your local emergency number first. Tell us what happened and we’ll act quickly.'
            : 'Real people read every message.'}
        </Text>
      </View>

      <View style={s.topics}>
        {TOPICS.map((t) => {
          const on = t.v === topic;
          return (
            <Pressable key={t.v} onPress={() => setTopic(t.v)} style={[s.topic, on && { backgroundColor: c.accentSoft, borderColor: c.accent }]}>
              <Ionicons name={t.icon} size={20} color={on ? c.accent : c.text2} />
              <Text style={[s.topicText, on && { color: c.accent }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.formCard}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder={
            topic === 'booking' ? 'Which item and dates? What went wrong?' : topic === 'bug' ? 'What did you tap, and what happened?' : 'Your message'
          }
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          multiline
          maxLength={5000}
          style={s.message}
        />
        <Field label="Reply to" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Button title="Send message" icon="paper-plane" onPress={send} loading={busy} disabled={message.trim().length < 5 || !email.includes('@')} />
      </View>

      <ListGroup title="Other ways">
        <ListRow icon="mail" iconColor="#0A84FF" label="Email us" value={APP.supportEmail} onPress={() => Linking.openURL(`mailto:${APP.supportEmail}`)} />
        <ListRow icon="help-buoy" iconColor="#30B0C7" label="Help & FAQ" onPress={() => navigation.navigate('Help')} />
      </ListGroup>
    </Page>
  );
}

// ===========================================================================
// Help & FAQ
// ===========================================================================

export function HelpScreen({ navigation }: ScreenProps<'Help'>) {
  const { c } = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Page title="Help & FAQ" onBack={() => navigation.goBack()}>
      <View style={s.listCard}>
        {FAQ.map((f, i) => (
          <View key={i}>
            {i > 0 && <View style={s.sep} />}
            <Pressable onPress={() => setOpen(open === i ? null : i)} style={s.faqQ}>
              <Text style={{ ...type.headline, color: c.text, flex: 1, fontSize: 16 }}>{f.q}</Text>
              <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={c.text3} />
            </Pressable>
            {open === i && <Text style={s.faqA}>{f.a}</Text>}
          </View>
        ))}
      </View>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Text style={{ ...type.callout, color: c.text2 }}>Still stuck?</Text>
        <Button title="Contact us" variant="secondary" icon="chatbubble-ellipses-outline" onPress={() => navigation.navigate('Contact')} />
      </View>
    </Page>
  );
}

// ===========================================================================
// Terms / Privacy / Rental rules
// ===========================================================================

export function LegalScreen({ route, navigation }: ScreenProps<'Legal'>) {
  const doc = LEGAL[route.params.doc];
  const { c } = useTheme();
  return (
    <Page title={doc.title} onBack={() => navigation.goBack()} grouped={false}>
      <View style={{ gap: 6, paddingHorizontal: 4 }}>
        <Text style={{ ...type.title, color: c.text }}>{doc.title}</Text>
        <Text style={{ ...type.footnote, color: c.text2 }}>Last updated {APP.updated}</Text>
      </View>
      {doc.sections.map((sec) => (
        <View key={sec.h} style={{ gap: 6, paddingHorizontal: 4 }}>
          <Text style={{ ...type.headline, color: c.text }}>{sec.h}</Text>
          <Text style={{ ...type.body, color: c.text2 }}>{sec.p}</Text>
        </View>
      ))}
      <Text style={{ ...type.footnote, color: c.text3, paddingHorizontal: 4 }}>
        Questions about this document? Contact {APP.supportEmail}.
      </Text>
    </Page>
  );
}

// ===========================================================================
// About
// ===========================================================================

export function AboutScreen({ navigation }: ScreenProps<'About'>) {
  const { c } = useTheme();
  return (
    <Page title="About" onBack={() => navigation.goBack()}>
      <View style={{ alignItems: 'center', gap: 10, paddingVertical: 20 }}>
        <View style={{ width: 84, height: 84, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="cube" size={42} color={c.onAccent} />
        </View>
        <Text style={{ ...type.title2, color: c.text }}>{APP.name}</Text>
        <Text style={{ ...type.subhead, color: c.text2 }}>Version {APP.version}</Text>
        <Text style={{ ...type.callout, color: c.text2, textAlign: 'center', paddingHorizontal: 24, lineHeight: 21, marginTop: 6 }}>
          Most things we own sit unused 99% of the time. {APP.name} lets neighbours share them by the day — and see them in 360° before borrowing.
        </Text>
      </View>
      <ListGroup>
        <ListRow icon="people" iconColor="#FF9500" label="Rental rules" onPress={() => navigation.navigate('Legal', { doc: 'rules' })} />
        <ListRow icon="document-text" iconColor="#8E8E93" label="Terms of Service" onPress={() => navigation.navigate('Legal', { doc: 'terms' })} />
        <ListRow icon="lock-closed" iconColor="#8E8E93" label="Privacy Policy" onPress={() => navigation.navigate('Legal', { doc: 'privacy' })} />
      </ListGroup>
      <Text style={{ ...type.footnote, color: c.text3, textAlign: 'center' }}>Built with React Native, FastAPI and SQLite.</Text>
    </Page>
  );
}

// ===========================================================================

const useStyles = makeStyles((c, scheme) => ({
  formCard: { backgroundColor: c.surface, borderRadius: 18, padding: 16, gap: 14 },
  listCard: { backgroundColor: c.surface, borderRadius: 18, overflow: 'hidden' },
  sep: { height: 1, backgroundColor: c.separator, marginLeft: 16 },
  groupTitle: { ...type.footnote, color: c.text2, textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 16 },
  footer: { ...type.footnote, color: c.text2, marginHorizontal: 16 },
  preview: { width: '100%', aspectRatio: 0.62, borderRadius: 14, borderWidth: 2.5, overflow: 'hidden' },
  swatchRing: { width: 48, height: 48, borderRadius: 24, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topic: {
    width: '31.5%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: c.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  topicText: { fontSize: 13, fontWeight: '600', color: c.text2 },
  message: { backgroundColor: c.fill, borderRadius: 14, padding: 14, minHeight: 140, fontSize: 16, color: c.text, textAlignVertical: 'top' },
  faqQ: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  faqA: { ...type.callout, color: c.text2, lineHeight: 22, paddingHorizontal: 16, paddingBottom: 16, marginTop: -6 },
  dialogBg: { flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: c.surface, borderRadius: 24, padding: 20, gap: 12 },
  dialogTitle: { ...type.title2, color: c.text, textAlign: 'center' },
  dialogText: { ...type.callout, color: c.text2, textAlign: 'center' },
}));

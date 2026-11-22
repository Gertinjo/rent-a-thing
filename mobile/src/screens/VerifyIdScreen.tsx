import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, IdDocType, LocalFile, Verification } from '../api';
import { useAuth } from '../auth';
import { VerifiedBadge } from '../components/Badges';
import { Button, NavHeader } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert, isWeb } from '../platform';
import { fmtDate, makeStyles, type, useTheme } from '../theme';

const DOCS: { key: IdDocType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'id_card', label: 'ID card', icon: 'card-outline' },
  { key: 'passport', label: 'Passport', icon: 'book-outline' },
  { key: 'driving_licence', label: 'Driving licence', icon: 'car-outline' },
];

type Shot = { file: LocalFile; uri: string } | null;

export default function VerifyIdScreen({ navigation }: ScreenProps<'VerifyId'>) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { refresh } = useAuth();
  const [v, setV] = useState<Verification | null>(null);
  const [doc, setDoc] = useState<IdDocType>('id_card');
  const [front, setFront] = useState<Shot>(null);
  const [selfie, setSelfie] = useState<Shot>(null);
  const [busy, setBusy] = useState(false);
  const [redo, setRedo] = useState(false);

  useEffect(() => {
    api.verification().then(setV).catch((e) => Alert.alert('Couldn’t load', e.message));
  }, []);

  const pick = async (which: 'front' | 'selfie', camera: boolean) => {
    if (camera && !isWeb && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert('Camera access is needed');
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.85,
      cameraType: which === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    const a = res.assets[0];
    const shot = { uri: a.uri, file: { uri: a.uri, name: a.fileName, mimeType: a.mimeType, file: a.file } };
    (which === 'front' ? setFront : setSelfie)(shot);
  };

  const submit = async () => {
    if (!front || !selfie) return;
    setBusy(true);
    try {
      setV(await api.submitVerification(doc, front.file, selfie.file));
      setRedo(false);
      setFront(null);
      setSelfie(null);
      await refresh();
    } catch (e: any) {
      Alert.alert('Couldn’t send', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!v) {
    return (
      <View style={s.screen}>
        <NavHeader title="Verify your ID" onBack={() => navigation.goBack()} />
        <ActivityIndicator style={{ marginTop: 40 }} color={c.text2} />
      </View>
    );
  }

  const showForm = v.status === 'none' || v.status === 'rejected' || redo;

  return (
    <View style={s.screen}>
      <NavHeader title="Verify your ID" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 18 }}>
        {/* ---------- status ---------- */}
        {v.status === 'verified' && (
          <StatusCard icon="shield-checkmark" color={c.info} title="You’re verified" text={`Checked ${v.verified_at ? fmtDate(v.verified_at.slice(0, 10)) : ''}. Your badge shows on your profile, listings and bookings.`}>
            <VerifiedBadge label />
          </StatusCard>
        )}
        {v.status === 'pending' && !redo && (
          <StatusCard
            icon="hourglass-outline"
            color={c.warning}
            title="We’re checking your ID"
            text="An admin compares your document with your selfie, usually within a day. We’ll notify you as soon as it’s done."
          >
            <Button title="Send different photos" size="small" variant="secondary" onPress={() => setRedo(true)} />
          </StatusCard>
        )}
        {v.status === 'rejected' && (
          <StatusCard icon="alert-circle" color={c.danger} title="We couldn’t verify your ID" text={`${v.note} Send new photos below.`} />
        )}

        {showForm && (
          <>
            <View style={{ gap: 6 }}>
              <Text style={s.h1}>Keep the neighbourhood safe</Text>
              <Text style={s.p}>
                Everyone on Rentify verifies their identity before they can borrow or lend. It takes a minute: a photo of your ID and a quick selfie.
              </Text>
            </View>

            <Text style={s.label}>1 · Which document?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {DOCS.map((d) => {
                const on = d.key === doc;
                return (
                  <Pressable key={d.key} onPress={() => setDoc(d.key)} style={[s.doc, on && { borderColor: c.accent, backgroundColor: c.accentSoft }]} accessibilityState={{ selected: on }}>
                    <Ionicons name={d.icon} size={22} color={on ? c.accent : c.text2} />
                    <Text style={[s.docText, on && { color: c.accent }]} numberOfLines={2}>
                      {d.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.label}>2 · Photo of your {DOCS.find((d) => d.key === doc)!.label.toLowerCase()}</Text>
            <ShotBox shot={front} icon="card" hint="The side with your photo. Flat, well lit, all four corners visible." onCamera={() => pick('front', true)} onLibrary={() => pick('front', false)} />

            <Text style={s.label}>3 · A selfie</Text>
            <ShotBox shot={selfie} icon="happy" hint="Face the camera, no sunglasses or hat. We compare it with the document photo." onCamera={() => pick('selfie', true)} onLibrary={() => pick('selfie', false)} round />

            <Button title="Send for verification" icon="shield-checkmark" onPress={submit} loading={busy} disabled={!front || !selfie} />

            <View style={s.privacy}>
              <Ionicons name="lock-closed" size={16} color={c.text2} />
              <Text style={s.privacyText}>
                Your photos are stored privately, seen only by our verification team, and deleted as soon as your ID is checked. Other users only see the “ID verified” badge.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatusCard({ icon, color, title, text, children }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; text: string; children?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ padding: 16, borderRadius: 20, backgroundColor: color + '17', gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Ionicons name={icon} size={28} color={color} />
        <Text style={{ ...type.headline, color: c.text, flex: 1 }}>{title}</Text>
      </View>
      <Text style={{ ...type.subhead, color: c.text2, lineHeight: 20 }}>{text}</Text>
      {children && <View style={{ alignItems: 'flex-start' }}>{children}</View>}
    </View>
  );
}

function ShotBox({ shot, icon, hint, onCamera, onLibrary, round }: { shot: Shot; icon: keyof typeof Ionicons.glyphMap; hint: string; onCamera: () => void; onLibrary: () => void; round?: boolean }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.shot}>
      {shot ? (
        <Image source={{ uri: shot.uri }} style={[s.preview, round && { width: 150, height: 150, borderRadius: 75, alignSelf: 'center' }]} resizeMode="cover" />
      ) : (
        <View style={[s.placeholder, round && { width: 150, height: 150, borderRadius: 75, alignSelf: 'center' }]}>
          <Ionicons name={icon} size={36} color={c.text3} />
        </View>
      )}
      <Text style={s.hint}>{hint}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={shot ? 'Retake' : 'Take photo'} icon="camera" size="small" onPress={onCamera} style={{ flex: 1 }} />
        <Button title="Choose" icon="images" size="small" variant="secondary" onPress={onLibrary} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  h1: { ...type.title2, color: c.text },
  p: { ...type.body, color: c.text2, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '800', color: c.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  doc: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 2, borderRadius: 16, borderWidth: 1.5, borderColor: c.separator, backgroundColor: c.surface },
  docText: { fontSize: 12, fontWeight: '700', color: c.text2, textAlign: 'center' },
  shot: { gap: 10, padding: 14, borderRadius: 20, backgroundColor: c.surface, borderWidth: scheme === 'dark' ? 0 : 1, borderColor: c.separator },
  preview: { width: '100%', aspectRatio: 1.58, borderRadius: 14, backgroundColor: c.imageBg },
  placeholder: { width: '100%', aspectRatio: 1.58, borderRadius: 14, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.text3 },
  hint: { fontSize: 13, color: c.text2, lineHeight: 18 },
  privacy: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: c.fill },
  privacyText: { flex: 1, fontSize: 12, color: c.text2, lineHeight: 17 },
}));

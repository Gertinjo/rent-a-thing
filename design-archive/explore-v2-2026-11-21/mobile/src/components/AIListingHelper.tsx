import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Text, TextInput, View } from 'react-native';

import { api, ListingDraft, LocalFile } from '../api';
import { Alert } from '../platform';
import { categoryLabel, makeStyles, money, type, useTheme } from '../theme';
import { Button } from './ui';

const COMPAT = { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
const toFile = (a: ImagePicker.ImagePickerAsset): LocalFile => ({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, file: a.file });

/**
 * "Start with photos": the owner picks 1-4 photos, Claude suggests title, category, description,
 * price and deposit, and the form below is filled in for them to check. Hidden when the server has no AI.
 */
export default function AIListingHelper({ onDraft }: { onDraft: (d: ListingDraft, photos: LocalFile[]) => void }) {
  const { c } = useTheme();
  const s = useStyles();
  const [enabled, setEnabled] = useState(false);
  const [photos, setPhotos] = useState<LocalFile[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ListingDraft | null>(null);

  useEffect(() => {
    api.aiStatus().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  const pick = async (camera: boolean) => {
    if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert('Camera access is needed');
    const res = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4, quality: 0.8, ...COMPAT });
    if (res.canceled) return;
    const next = [...photos, ...res.assets.map(toFile)].slice(0, 4);
    setPhotos(next);
    setResult(null);
  };

  const run = async () => {
    setBusy(true);
    try {
      const d = await api.aiListingDraft(photos, note);
      if (!d.is_rentable_item) {
        Alert.alert('That doesn’t look like something to lend', d.note || 'Try a clear photo of the item itself.');
        return;
      }
      setResult(d);
      onDraft(d, photos);
    } catch (e: any) {
      Alert.alert('AI couldn’t fill this in', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="sparkles" size={18} color={c.accent} />
        <Text style={s.title}>Start with photos</Text>
      </View>
      <Text style={s.text}>Add 1–4 photos and AI fills in the title, category, description and a fair price. You check everything before it’s saved.</Text>

      {photos.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {photos.map((p, i) => (
            <Image key={p.uri + i} source={{ uri: p.uri }} style={s.thumb} />
          ))}
        </View>
      )}

      {photos.length < 4 && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title={photos.length ? 'Add more' : 'Choose photos'} icon="images-outline" variant="secondary" size="small" onPress={() => pick(false)} style={{ flex: 1 }} />
          {Platform.OS !== 'web' && <Button title="Take photo" icon="camera-outline" variant="secondary" size="small" onPress={() => pick(true)} style={{ flex: 1 }} />}
        </View>
      )}

      {photos.length > 0 && (
        <>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything to add? e.g. comes with 2 batteries"
            placeholderTextColor={c.text3}
            selectionColor={c.accent}
            style={s.note}
            maxLength={300}
          />
          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', height: 44 }}>
              <ActivityIndicator color={c.accent} />
              <Text style={s.text}>Looking at your photos…</Text>
            </View>
          ) : (
            <Button title={result ? 'Try again' : 'Fill in with AI'} icon="sparkles" onPress={run} variant={result ? 'secondary' : 'primary'} />
          )}
        </>
      )}

      {result && (
        <View style={s.result}>
          <Ionicons name="checkmark-circle" size={18} color={c.success} />
          <Text style={[s.text, { flex: 1, color: c.text }]}>
            Filled in below: {categoryLabel[result.category]} · {money(result.price_per_day)}/day
            {result.deposit ? ` · ${money(result.deposit)} deposit` : ''}. {result.note || 'Check it over and edit anything.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.accentSoft, borderRadius: 22, padding: 16, gap: 12 },
  title: { ...type.headline, color: c.text },
  text: { ...type.subhead, color: c.text2, lineHeight: 20 },
  thumb: { width: 64, height: 64, borderRadius: 14, backgroundColor: c.imageBg },
  note: { backgroundColor: c.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text },
  result: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
}));

import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth';
import { api, CATEGORIES, Category, FeePeriod, Item, LocalFile, mediaUrl, Place } from '../api';
import AIListingHelper from '../components/AIListingHelper';
import LenderTermsModal from '../components/LenderTermsModal';
import LocationPicker from '../components/LocationPicker';
import SpinViewer from '../components/SpinViewer';
import { Button, Field, Glass, ListGroup, ListRow, NavHeader } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { categoryHint, categoryIcon, categoryLabel, makeStyles, money, type, useTheme } from '../theme';

// Ask iOS to hand us H.264/JPEG instead of HEVC/HEIC so the server can always decode it.
const COMPAT = { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };

const toFile = (a: ImagePicker.ImagePickerAsset): LocalFile => ({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, file: a.file });

/** New listings need an approved lender account; renter-only accounts see how to apply instead. */
export default function ListingEditorScreen(props: ScreenProps<'ListingEditor'>) {
  const { user } = useAuth();
  const isNew = !props.route.params?.id;
  if (isNew && user && !user.is_admin && user.approval_status !== 'approved') return <LenderGate navigation={props.navigation} />;
  return <ListingEditorForm {...props} />;
}

function LenderGate({ navigation }: { navigation: ScreenProps<'ListingEditor'>['navigation'] }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const st = user!.approval_status;
  const apply = async () => {
    setBusy(true);
    try {
      setUser(await api.applyToLend());
    } catch (e: any) {
      Alert.alert('Couldn’t send your request', e.message);
    } finally {
      setBusy(false);
    }
  };
  const copy = {
    none: { icon: 'cube-outline' as const, color: c.accent, t: 'Lend your things', d: 'Your account is set up for renting. To list things, apply to lend and an admin will review your account, usually within a few hours. You can keep renting meanwhile.' },
    pending: { icon: 'hourglass-outline' as const, color: c.warning, t: 'We’re reviewing your lender account', d: 'You can list things as soon as an admin approves you, usually within a few hours. You can keep renting meanwhile.' },
    rejected: { icon: 'alert-circle' as const, color: c.danger, t: 'Lending wasn’t approved', d: `${user!.approval_note || 'An admin couldn’t approve you as a lender.'} You can update your profile and apply again.` },
  }[st === 'approved' ? 'pending' : st];
  return (
    <View style={{ flex: 1, backgroundColor: c.grouped }}>
      <NavHeader title="List a thing" onBack={() => navigation.goBack()} />
      <View style={{ flex: 1, padding: 24, paddingBottom: insets.bottom + 24, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: copy.color + '1F' }}>
          <Ionicons name={copy.icon} size={34} color={copy.color} />
        </View>
        <Text style={{ ...type.title2, color: c.text, textAlign: 'center' }}>{copy.t}</Text>
        <Text style={{ ...type.body, color: c.text2, textAlign: 'center', lineHeight: 22, maxWidth: 360 }}>{copy.d}</Text>
        {st !== 'pending' && (
          <Button title={st === 'rejected' ? 'Apply again' : 'Apply to lend'} icon="arrow-forward" onPress={apply} loading={busy} style={{ marginTop: 8, alignSelf: 'stretch' }} />
        )}
      </View>
    </View>
  );
}

function ListingEditorForm({ route, navigation }: ScreenProps<'ListingEditor'>) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<Item | null>(null);
  const editingId = route.params?.id ?? item?.id;
  const [f, setF] = useState({ title: '', description: '', category: 'tools' as Category, price: '', deposit: '' });
  const [place, setPlace] = useState<Place | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  // Lender terms pop-up: shown every time a new product is added, before it's created.
  const [termsOpen, setTermsOpen] = useState(false);
  const [feePercent, setFeePercent] = useState(10);
  const [feePeriods, setFeePeriods] = useState<FeePeriod[]>([]);
  // Photos picked for the AI helper; uploaded to the listing as soon as it's created.
  const [draftPhotos, setDraftPhotos] = useState<LocalFile[]>([]);

  useEffect(() => {
    api
      .config()
      .then((cfg) => {
        setFeePercent(cfg.platform_fee_percent);
        setFeePeriods(cfg.fee_periods ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!route.params?.id) return;
    api.item(route.params.id).then((it) => {
      setItem(it);
      setF({
        title: it.title,
        description: it.description,
        category: it.category,
        price: String(it.price_per_day),
        deposit: it.deposit ? String(it.deposit) : '',
      });
      if (it.location) setPlace({ label: it.location.label, lat: it.location.lat, lng: it.location.lng });
    });
  }, [route.params?.id]);

  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const priceValue = parseFloat(f.price.replace(',', '.'));
  const earnings = priceValue > 0 ? Math.round(priceValue * (100 - feePercent)) / 100 : 0;

  const saveDetails = async (termsJustAccepted = false) => {
    const price = priceValue;
    const deposit = parseFloat((f.deposit || '0').replace(',', '.'));
    if (!f.title.trim() || !(price > 0)) return Alert.alert('Add a title and a daily price');
    if (!place) return Alert.alert('Add a pick-up location', 'Search for the street, or use your current location.');
    // New product: show the lender terms pop-up first; the listing is created only after "Agree".
    if (!editingId && !termsJustAccepted) return setTermsOpen(true);
    setSaving(true);
    try {
      const body = {
        title: f.title.trim(),
        description: f.description.trim(),
        category: f.category,
        price_per_day: price,
        deposit: deposit || 0,
        location: place,
        ...(editingId ? {} : { terms_accepted: true }),
      };
      let saved = editingId ? await api.updateItem(editingId, body) : await api.createItem(body);
      if (!editingId && draftPhotos.length) {
        setUploading('Adding your photos…');
        try {
          saved = await api.addPhotos(saved.id, draftPhotos);
          setDraftPhotos([]);
        } finally {
          setUploading(null);
        }
      }
      setItem(saved);
      if (!editingId && saved.review_status === 'pending') {
        Alert.alert('Sent for review', 'An admin checks new listings before they go live — usually within a few hours. Add photos and a 360° view meanwhile.');
      } else if (editingId) Alert.alert(saved.review_status === 'pending' && item?.review_status === 'rejected' ? 'Sent for review again' : 'Saved');
    } catch (e: any) {
      Alert.alert('Couldn’t save', e.message);
    } finally {
      setSaving(false);
    }
  };

  const withUpload = async (label: string, fn: () => Promise<Item>) => {
    setUploading(label);
    try {
      setItem(await fn());
    } catch (e: any) {
      Alert.alert('Upload failed', e.message);
    } finally {
      setUploading(null);
    }
  };

  const addPhotos = async (fromCamera: boolean) => {
    if (!item) return;
    if (fromCamera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert('Camera access is needed');
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.8, ...COMPAT });
    if (res.canceled) return;
    await withUpload('Uploading photos…', () => api.addPhotos(item.id, res.assets.map(toFile)));
  };

  const recordSpin = async () => {
    if (!item) return;
    if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert('Camera access is needed');
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 30,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });
    if (res.canceled) return;
    await withUpload('Building your 360° view…', () => api.uploadSpinVideo(item.id, toFile(res.assets[0])));
  };

  const pickSpinVideo = async () => {
    if (!item) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], ...COMPAT });
    if (res.canceled) return;
    await withUpload('Building your 360° view…', () => api.uploadSpinVideo(item.id, toFile(res.assets[0])));
  };

  const pickSpinPhotos = async () => {
    if (!item) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: 72,
      quality: 0.7,
      ...COMPAT,
    });
    if (res.canceled) return;
    if (res.assets.length < 8) return Alert.alert('Pick at least 8 photos', 'Select them in the order you walked around the item.');
    await withUpload('Building your 360° view…', () => api.uploadSpinFrames(item.id, res.assets.map(toFile)));
  };

  const removeSpin = () =>
    item &&
    Alert.alert('Remove the 360° view?', undefined, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => withUpload('Removing…', () => api.deleteSpin(item.id)) },
    ]);

  const toggleActive = () =>
    item && withUpload(item.is_active ? 'Hiding…' : 'Publishing…', () => api.updateItem(item.id, { is_active: !item.is_active }));

  const title = route.params?.id ? 'Edit listing' : item ? 'Photos & 360°' : 'New listing';

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <NavHeader title={title} onBack={() => navigation.goBack()} backIcon={route.params?.id ? 'chevron-back' : 'close'} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 28, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {item && item.review_status !== 'approved' && (
          <View style={[s.banner, item.review_status === 'rejected' && { backgroundColor: c.danger + '1A' }]}>
            <Ionicons
              name={item.review_status === 'rejected' ? 'alert-circle' : 'time-outline'}
              size={22}
              color={item.review_status === 'rejected' ? c.danger : c.warning}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.bannerTitle}>{item.review_status === 'rejected' ? 'Changes needed' : 'Waiting for approval'}</Text>
              <Text style={s.bannerText}>
                {item.review_status === 'rejected'
                  ? `${item.review_note || 'An admin asked for changes.'} Save your fixes to send it for review again.`
                  : 'An admin checks every new listing before it appears on Explore.'}
              </Text>
            </View>
          </View>
        )}
        {/* ---------- details ---------- */}
        {!route.params?.id && !item && (
          <AIListingHelper
            onDraft={(d, photos) => {
              setF({
                title: d.title,
                description: d.description,
                category: d.category,
                price: d.price_per_day ? String(d.price_per_day) : '',
                deposit: d.deposit ? String(d.deposit) : '',
              });
              setDraftPhotos(photos);
            }}
          />
        )}
        <View style={{ gap: 16 }}>
          <Text style={s.step}>Details</Text>
          <Field label="What are you lending?" value={f.title} onChangeText={set('title')} placeholder="Cordless drill 18V" />
          <View style={{ gap: 8 }}>
            <Text style={s.label}>Category</Text>
            <View style={s.cats}>
              {CATEGORIES.map((cat) => {
                const on = f.category === cat;
                return (
                  <Pressable key={cat} onPress={() => set('category')(cat)} style={[s.cat, on && { backgroundColor: c.accentSoft, borderColor: c.accent }]}>
                    <Ionicons name={categoryIcon[cat] as any} size={22} color={on ? c.accent : c.text2} />
                    <Text style={[s.catText, on && { color: c.accent }]} numberOfLines={1}>
                      {categoryLabel[cat]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.hint}>{categoryHint[f.category]}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label="Price per day (€)" value={f.price} onChangeText={set('price')} keyboardType="decimal-pad" placeholder="€10" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Deposit (optional)" value={f.deposit} onChangeText={set('deposit')} keyboardType="decimal-pad" placeholder="€0" />
            </View>
          </View>
          <Text style={s.hint}>
            {priceValue > 0
              ? `You earn ${money(earnings)} per day. Rentify keeps a ${feePercent}% service fee (${money(priceValue - earnings)}).`
              : `Rentify keeps a ${feePercent}% service fee from each rental: €1 on €10, €2 on €20.`}
            {feePeriods.length > 0 && `\nSpecial fees for rentals starting: ${feePeriods.slice(0, 3).map(feePeriodText).join(' · ')}.`}
          </Text>
          <Field
            label="Description"
            value={f.description}
            onChangeText={set('description')}
            multiline
            placeholder="What’s included? Any tips for using it?"
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
          <View style={{ gap: 8 }}>
            <Text style={s.label}>Pick-up location</Text>
            <LocationPicker value={place} onChange={setPlace} />
            <Text style={s.hint}>People only see the area until you confirm their booking. Then they get the exact spot and directions.</Text>
          </View>
          <Button title={item ? 'Save details' : 'Continue'} onPress={() => saveDetails()} loading={saving} />
        </View>

        {item && (
          <>
            {/* ---------- 360 ---------- */}
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.step}>360° view</Text>
                {item.has_360 && <Button size="small" variant="destructive" title="Remove" onPress={removeSpin} />}
              </View>
              {item.has_360 ? (
                <View style={{ borderRadius: 24, overflow: 'hidden' }}>
                  <SpinViewer frames={item.spin_frames} height={300} />
                </View>
              ) : (
                <View style={s.tips}>
                  <Text style={s.tipsTitle}>Let people walk around it</Text>
                  {[
                    'Put it in the middle of the floor, in good light.',
                    'Film one slow full circle around it (10–20 s), keeping it centred.',
                    'We cut it into 36 frames that renters can drag to spin.',
                  ].map((t, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                      <Text style={s.tipNum}>{i + 1}</Text>
                      <Text style={s.tip}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
              <ListGroup>
                <ListRow icon="videocam" label={item.has_360 ? 'Re-record walk-around' : 'Record walk-around'} onPress={recordSpin} />
                <ListRow icon="film-outline" iconColor="#5E5CE6" label="Choose a video" onPress={pickSpinVideo} />
                <ListRow icon="images-outline" iconColor="#0A84FF" label="Choose 8+ photos in order" onPress={pickSpinPhotos} />
              </ListGroup>
            </View>

            {/* ---------- photos ---------- */}
            <View style={{ gap: 12 }}>
              <Text style={s.step}>Photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                <Pressable style={[s.photo, s.addPhoto]} onPress={() => addPhotos(false)} accessibilityLabel="Add photos">
                  <Ionicons name="add" size={28} color={c.text2} />
                </Pressable>
                {Platform.OS !== 'web' && (
                  <Pressable style={[s.photo, s.addPhoto]} onPress={() => addPhotos(true)} accessibilityLabel="Take a photo">
                    <Ionicons name="camera-outline" size={26} color={c.text2} />
                  </Pressable>
                )}
                {item.photos.map((p) => (
                  <Pressable
                    key={p.id}
                    onLongPress={() =>
                      Alert.alert('Delete this photo?', undefined, [
                        { text: 'Keep', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => withUpload('Deleting…', () => api.deletePhoto(item.id, p.id)) },
                      ])
                    }
                  >
                    <Image source={{ uri: mediaUrl(p.url) }} style={s.photo} />
                  </Pressable>
                ))}
              </ScrollView>
              {item.photos.length > 0 && <Text style={s.hint}>Press and hold a photo to delete it.</Text>}
            </View>

            <View style={{ gap: 10 }}>
              <Button title="Done" onPress={() => navigation.replace('ItemDetail', { id: item.id })} />
              {route.params?.id && (
                <Button title={item.is_active ? 'Hide from Explore' : 'Show on Explore again'} variant={item.is_active ? 'destructive' : 'plain'} onPress={toggleActive} />
              )}
            </View>
          </>
        )}
      </ScrollView>

      {uploading && (
        <View style={s.overlay}>
          <Glass radius={24}>
            <View style={{ padding: 24, alignItems: 'center', gap: 12, minWidth: 200 }}>
              <ActivityIndicator color={c.text} />
              <Text style={{ color: c.text, fontWeight: '600' }}>{uploading}</Text>
            </View>
          </Glass>
        </View>
      )}

      <LenderTermsModal
        visible={termsOpen}
        feePercent={feePercent}
        onCancel={() => setTermsOpen(false)}
        onAgree={() => {
          setTermsOpen(false);
          saveDetails(true);
        }}
        onReadFull={() => {
          setTermsOpen(false);
          navigation.navigate('Legal', { doc: 'terms' });
        }}
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  step: { ...type.title2, color: c.text },
  label: { ...type.footnote, color: c.text2, fontWeight: '600', marginLeft: 4 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: { width: '31.5%', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 16, backgroundColor: c.fill, borderWidth: 1.5, borderColor: 'transparent' },
  banner: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: c.warning + '1F' },
  bannerTitle: { ...type.headline, color: c.text },
  bannerText: { ...type.subhead, color: c.text2, lineHeight: 19 },
  catText: { fontSize: 12, fontWeight: '600', color: c.text2 },
  tips: { backgroundColor: c.accentSoft, borderRadius: 20, padding: 16, gap: 10 },
  tipsTitle: { ...type.headline, color: c.text },
  tipNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: c.accent, color: c.onAccent, textAlign: 'center', fontSize: 12, fontWeight: '700', lineHeight: 20, overflow: 'hidden' },
  tip: { ...type.callout, color: c.text, flex: 1, lineHeight: 20 },
  photo: { width: 96, height: 96, borderRadius: 18, backgroundColor: c.imageBg },
  addPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill },
  hint: { ...type.footnote, color: c.text2 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center' },
}));

const fmtMD = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** "Black Friday (Nov 27) 3%", "Summer (Jun 1 – Aug 31, every year) 15%" */
function feePeriodText(p: FeePeriod) {
  const dates = p.start_date === p.end_date ? fmtMD(p.start_date) : `${fmtMD(p.start_date)} – ${fmtMD(p.end_date)}`;
  return `${p.name} (${dates}${p.yearly ? ', every year' : ''}${p.active ? ', on now' : ''}) ${p.fee_percent}%`;
}

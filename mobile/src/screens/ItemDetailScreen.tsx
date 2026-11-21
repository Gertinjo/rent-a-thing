import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Calendar, Item, mediaUrl, Review } from '../api';
import { useAuth } from '../auth';
import AvailabilityCalendar, { Selection } from '../components/AvailabilityCalendar';
import MapEmbed from '../components/MapEmbed';
import { openDirections, openInMaps } from '../maps';
import SpinViewer from '../components/SpinViewer';
import {
  Avatar,
  Button,
  Glass,
  GlassIconButton,
  IconName,
  NavHeader,
  Rating,
  Segmented,
  SectionTitle,
  Stars,
} from '../components/ui';
import { UserBadges } from '../components/Badges';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { categoryLabel, daysBetween, fmtDate, fmtRange, makeStyles, money, type, useTheme } from '../theme';

export default function ItemDetailScreen({ route, navigation }: ScreenProps<'ItemDetail'>) {
  const { id } = route.params;
  const { user } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<Item | null>(null);
  const [cal, setCal] = useState<Calendar | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [mode, setMode] = useState<'360' | 'photos'>('360');
  const [sel, setSel] = useState<Selection>({});
  const [askOpen, setAskOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const isOwner = item?.owner.id === user?.id;
  const frameW = Math.min(width, 430);

  const load = useCallback(async () => {
    try {
      const [it, cal2, r] = await Promise.all([api.item(id), api.calendar(id), api.itemReviews(id)]);
      setItem(it);
      setCal(cal2);
      setReviews(r);
      if (!it.has_360) setMode('photos');
    } catch (e: any) {
      Alert.alert('Couldn’t load this item', e.message);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!item) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={c.text2} />
      </View>
    );
  }

  const days = sel.start ? daysBetween(sel.start, sel.end ?? sel.start) + 1 : 0;
  const total = days * item.price_per_day;
  const heroH = Math.round(frameW * 1.02);

  const requestBooking = async () => {
    if (!sel.start) return;
    setBusy(true);
    try {
      await api.requestBooking({ item_id: item.id, start_date: sel.start, end_date: sel.end ?? sel.start, message });
      setAskOpen(false);
      setSel({});
      setMessage('');
      await load();
      Alert.alert('Request sent', `${item.owner.name.split(' ')[0]} will get back to you. You can follow it in Bookings.`);
    } catch (e: any) {
      Alert.alert('Couldn’t send request', e.message);
    } finally {
      setBusy(false);
    }
  };

  const blockDates = async () => {
    if (!sel.start) return;
    setBusy(true);
    try {
      setCal(await api.addBlackout(item.id, sel.start, sel.end ?? sel.start, 'Not available'));
      setSel({});
    } catch (e: any) {
      Alert.alert('Couldn’t block dates', e.message);
    } finally {
      setBusy(false);
    }
  };

  const unblock = (blackoutId: number) =>
    Alert.alert('Make these dates available again?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock', onPress: async () => setCal(await api.deleteBlackout(item.id, blackoutId)) },
    ]);

  const facts: { icon: IconName; title: string; text: string }[] = [
    { icon: 'cash-outline', title: `${money(item.price_per_day)} per day`, text: 'Pay the owner at pick-up.' },
    ...(item.deposit > 0
      ? [{ icon: 'shield-checkmark-outline' as IconName, title: `${money(item.deposit)} refundable deposit`, text: 'Returned when it comes back as you got it.' }]
      : []),
    { icon: 'location-outline', title: `Pick up in ${item.location?.label || item.neighborhood || 'the neighbourhood'}`, text: item.location?.exact ? 'Exact spot below.' : 'Exact spot shared after the owner confirms.' },
    { icon: 'calendar-outline', title: 'Free cancellation', text: 'Cancel any time before the first day.' },
  ];

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        {/* ---------- hero ---------- */}
        {mode === '360' && item.has_360 ? (
          <SpinViewer
            frames={item.spin_frames}
            height={heroH}
            bottomInset={26}
            onFullscreen={() => navigation.navigate('Viewer360', { frames: item.spin_frames, title: item.title })}
          />
        ) : (
          <FlatList
            horizontal
            pagingEnabled
            data={item.photos}
            keyExtractor={(p) => String(p.id)}
            showsHorizontalScrollIndicator={false}
            style={{ height: heroH, backgroundColor: c.imageBg }}
            renderItem={({ item: p }) => <Image source={{ uri: mediaUrl(p.url) }} style={{ width: frameW, height: heroH }} resizeMode="cover" />}
            ListEmptyComponent={
              <View style={{ width: frameW, height: heroH, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="image-outline" size={40} color={c.text3} />
              </View>
            }
          />
        )}

        {/* ---------- sheet ---------- */}
        <View style={s.sheet}>
          {item.has_360 && (
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: '360', label: '360° view' },
                { value: 'photos', label: `Photos · ${item.photos.length}` },
              ]}
              style={{ marginBottom: 18 }}
            />
          )}

          <Text style={s.eyebrow}>{categoryLabel[item.category] ?? item.category}</Text>
          <Text style={s.title}>{item.title}</Text>
          <View style={s.metaRow}>
            <Rating avg={item.rating_avg} count={item.rating_count} size={14} />
            <Text style={s.dot}>·</Text>
            <Text style={s.meta}>{item.neighborhood || 'Nearby'}</Text>
          </View>
          {!item.is_active && <Text style={{ color: c.danger, fontWeight: '600', marginTop: 8 }}>This listing is hidden from Explore</Text>}
          {item.review_status === 'pending' && <Text style={{ color: c.warning, fontWeight: '600', marginTop: 8 }}>Waiting for admin approval — not visible on Explore yet</Text>}
          {item.review_status === 'rejected' && (
            <Text style={{ color: c.danger, fontWeight: '600', marginTop: 8 }}>Changes needed: {item.review_note || 'see Edit listing'}</Text>
          )}

          <View style={s.rule} />

          {/* owner */}
          <View style={s.owner}>
            <Avatar name={item.owner.name} url={item.owner.avatar_url} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={s.ownerName}>{isOwner ? 'You’re lending this' : `Lent by ${item.owner.name.split(' ')[0]}`}</Text>
                <UserBadges user={item.owner} small />
              </View>
              <Text style={s.meta}>
                {item.owner.rating_count ? `★ ${item.owner.rating_avg?.toFixed(1)} · ${item.owner.rating_count} review${item.owner.rating_count === 1 ? '' : 's'}` : 'New lender'} ·{' '}
                {item.owner.neighborhood}
              </Text>
            </View>
          </View>
          {!!item.owner.bio && <Text style={s.quote}>“{item.owner.bio}”</Text>}

          <View style={s.rule} />

          {/* facts */}
          <View style={{ gap: 18 }}>
            {facts.map((f) => (
              <View key={f.title} style={{ flexDirection: 'row', gap: 14 }}>
                <Ionicons name={f.icon} size={24} color={c.text} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.factTitle}>{f.title}</Text>
                  <Text style={s.meta}>{f.text}</Text>
                </View>
              </View>
            ))}
          </View>

          {item.location && (
            <>
              <View style={s.rule} />
              <View style={{ gap: 12 }}>
                <SectionTitle>Where to pick it up</SectionTitle>
                <MapEmbed lat={item.location.lat} lng={item.location.lng} zoom={item.location.exact ? 16 : 14} height={210} approximate={!item.location.exact} />
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <Ionicons name={item.location.exact ? 'location' : 'location-outline'} size={20} color={c.accent} />
                  <Text style={[s.factTitle, { flex: 1 }]}>{item.location.label || item.neighborhood}</Text>
                </View>
                <Text style={s.meta}>
                  {item.location.exact
                    ? isOwner
                      ? 'This is your pick-up spot. Renters see it once you confirm their booking.'
                      : 'Your booking is confirmed, so here’s the exact spot.'
                    : 'Approximate area. The exact address appears here once the owner confirms your booking.'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button
                    title={item.location.exact ? 'Get directions' : 'Directions to area'}
                    icon="navigate"
                    size="small"
                    onPress={() => openDirections(item.location!.lat, item.location!.lng)}
                    style={{ flex: 1 }}
                  />
                  <Button title="Open in Maps" icon="map-outline" size="small" variant="secondary" onPress={() => openInMaps(item.location!.lat, item.location!.lng)} style={{ flex: 1 }} />
                </View>
              </View>
            </>
          )}

          {!!item.description && (
            <>
              <View style={s.rule} />
              <View style={{ gap: 8 }}>
                <SectionTitle>About</SectionTitle>
                <Text style={s.body}>{item.description}</Text>
              </View>
            </>
          )}

          <View style={s.rule} />

          {/* calendar */}
          <View style={{ gap: 12 }}>
            <SectionTitle>{isOwner ? 'Your calendar' : 'Availability'}</SectionTitle>
            <Text style={[s.meta, { marginTop: -6 }]}>
              {isOwner ? 'Select days you need it yourself to block them.' : 'Tap your pick-up day, then your return day.'}
            </Text>
            <AvailabilityCalendar data={cal} selection={sel} onChange={setSel} onBlockedPress={(m) => Alert.alert(m)} />
            {isOwner &&
              cal?.ranges
                .filter((r) => r.kind === 'blocked')
                .map((r) => (
                  <Pressable key={r.id} onPress={() => unblock(r.id)} style={s.blockRow}>
                    <Ionicons name="remove-circle-outline" size={20} color={c.text2} />
                    <Text style={{ flex: 1, color: c.text, fontSize: 15 }}>
                      {fmtRange(r.start_date, r.end_date)}
                      {r.note ? ` · ${r.note}` : ''}
                    </Text>
                    <Text style={{ color: c.accent, fontWeight: '600' }}>Unblock</Text>
                  </Pressable>
                ))}
          </View>

          <View style={s.rule} />

          {/* reviews */}
          <View style={{ gap: 16 }}>
            <SectionTitle right={item.rating_count ? <Rating avg={item.rating_avg} count={item.rating_count} size={15} /> : undefined}>
              Reviews
            </SectionTitle>
            {reviews.length === 0 && <Text style={s.meta}>No reviews yet.</Text>}
            {reviews.map((r) => (
              <View key={r.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar name={r.reviewer.name} url={r.reviewer.avatar_url} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.factTitle}>{r.reviewer.name}</Text>
                    <Text style={[s.meta, { fontSize: 13 }]}>{fmtDate(r.created_at.slice(0, 10))}</Text>
                  </View>
                  <Stars value={r.rating} size={12} />
                </View>
                {!!r.comment && <Text style={s.body}>{r.comment}</Text>}
              </View>
            ))}
          </View>

          {!isOwner && (
            <Pressable onPress={() => navigation.navigate('Contact', { topic: 'safety' })} style={{ marginTop: 28, alignSelf: 'flex-start' }}>
              <Text style={{ color: c.text2, fontSize: 14, textDecorationLine: 'underline' }}>Report this listing</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      <NavHeader
        floating
        onBack={() => navigation.goBack()}
        right={isOwner ? <GlassIconButton icon="create-outline" label="Edit listing" onPress={() => navigation.navigate('ListingEditor', { id })} /> : undefined}
      />

      {/* ---------- floating glass booking bar ---------- */}
      <View style={[s.barWrap, { bottom: Math.max(insets.bottom, 12) + 6 }]} pointerEvents="box-none">
        <Glass radius={32} intensity={55} style={{ width: '92%', maxWidth: 420 }}>
          <View style={s.bar}>
            <View style={{ flex: 1, paddingLeft: 10 }}>
              {sel.start ? (
                <>
                  <Text style={s.barPrice}>{isOwner ? `${days} day${days > 1 ? 's' : ''}` : money(total)}</Text>
                  <Text style={s.barSub}>
                    {fmtRange(sel.start, sel.end ?? sel.start)}
                    {!isOwner && ` · ${days} day${days > 1 ? 's' : ''}`}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={s.barPrice}>
                    {money(item.price_per_day)}
                    <Text style={s.barSub}> / day</Text>
                  </Text>
                  <Text style={s.barSub}>{isOwner ? 'Pick days to block' : 'Pick your dates'}</Text>
                </>
              )}
            </View>
            {isOwner ? (
              <Button title="Block" icon="lock-closed" onPress={blockDates} disabled={!sel.start} loading={busy} />
            ) : user?.id_required && user.id_status !== 'verified' ? (
              <Button title={user.id_status === 'pending' ? 'ID being checked' : 'Verify ID'} icon="shield-checkmark" onPress={() => navigation.navigate('VerifyId')} disabled={user.id_status === 'pending'} />
            ) : (
              <Button title="Request" onPress={() => setAskOpen(true)} disabled={!sel.start || !item.is_active} />
            )}
          </View>
        </Glass>
      </View>

      {/* ---------- request sheet ---------- */}
      <Modal visible={askOpen} animationType="slide" transparent onRequestClose={() => setAskOpen(false)}>
        <Pressable style={s.modalBg} onPress={() => setAskOpen(false)} />
        <View style={[s.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.grabber} />
          <Text style={s.modalTitle}>Request to rent</Text>
          <View style={s.summary}>
            <Image source={{ uri: mediaUrl(item.cover_url) }} style={s.summaryImg} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.factTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={s.meta}>{sel.start && fmtRange(sel.start, sel.end ?? sel.start)}</Text>
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <View style={s.sumRow}>
              <Text style={s.body}>
                {money(item.price_per_day)} × {days} day{days > 1 ? 's' : ''}
              </Text>
              <Text style={[s.body, { fontWeight: '600' }]}>{money(total)}</Text>
            </View>
            {item.deposit > 0 && (
              <View style={s.sumRow}>
                <Text style={s.meta}>Refundable deposit</Text>
                <Text style={s.meta}>{money(item.deposit)}</Text>
              </View>
            )}
            <View style={s.sumRow}>
              <Text style={s.meta}>Platform fee (kept by Rent a Thing)</Text>
              <Text style={s.meta}>{money(total * 0.25)}</Text>
            </View>
          </View>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={`Message to ${item.owner.name.split(' ')[0]} (what’s it for?)`}
            placeholderTextColor={c.text3}
            selectionColor={c.accent}
            multiline
            style={s.message}
          />
          <Button title={`Send request · ${money(total)}`} onPress={requestBooking} loading={busy} />
          <Text style={[s.meta, { textAlign: 'center', fontSize: 13 }]}>You won’t pay anything until pick-up.</Text>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  sheet: { marginTop: -26, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: c.bg, paddingHorizontal: 20, paddingTop: 20, gap: 0 },
  eyebrow: { ...type.footnote, color: c.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { ...type.title, color: c.text, marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  rule: { height: 1, backgroundColor: c.separator, marginVertical: 24 },
  dot: { color: c.text2 },
  meta: { ...type.subhead, color: c.text2, lineHeight: 19 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ownerName: { ...type.headline, color: c.text },
  quote: { ...type.callout, color: c.text2, fontStyle: 'italic', marginTop: 12, lineHeight: 21 },
  factTitle: { ...type.headline, color: c.text, fontSize: 16 },
  body: { ...type.body, color: c.text },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.fill, borderRadius: 14, padding: 12 },
  barWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 10 },
  barPrice: { fontSize: 18, fontWeight: '700', color: c.text },
  barSub: { fontSize: 13, color: c.text2, fontWeight: '400' },
  modalBg: { flex: 1, backgroundColor: c.overlay },
  modalSheet: { backgroundColor: c.bg, paddingHorizontal: 20, paddingTop: 10, gap: 18, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.text3 },
  modalTitle: { ...type.title2, color: c.text },
  summary: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  summaryImg: { width: 56, height: 56, borderRadius: 14, backgroundColor: c.imageBg },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  message: { backgroundColor: c.fill, borderRadius: 16, padding: 14, minHeight: 90, fontSize: 16, color: c.text, textAlignVertical: 'top' },
}));

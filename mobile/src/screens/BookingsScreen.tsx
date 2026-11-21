import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, SectionList, Text, View } from 'react-native';

import { api, Booking, mediaUrl } from '../api';
import { Avatar, Button, Empty, LargeHeader, Segmented, StatusDot, useTabBarSpace } from '../components/ui';
import type { RootStackParamList } from '../navigation';
import { Alert } from '../platform';
import { useRealtime } from '../realtime';
import { fmtRange, isoDay, makeStyles, money, statusStyle, type, useTheme } from '../theme';

type Tab = 'renter' | 'owner';
type Action = 'accept' | 'decline' | 'cancel' | 'complete';

export default function BookingsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { c } = useTheme();
  const s = useStyles();
  const bottom = useTabBarSpace();
  const [tab, setTab] = useState<Tab>('renter');
  const [all, setAll] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { on } = useRealtime();
  const [chatUnread, setChatUnread] = useState<Record<number, number>>({});
  const loadUnread = useCallback(() => {
    api
      .chats()
      .then((ts) => setChatUnread(Object.fromEntries(ts.map((t) => [t.booking_id, t.unread]))))
      .catch(() => {});
  }, []);
  // live: refresh the per-booking counts and the list when a message or booking update arrives
  useEffect(() => {
    const a = on('message', loadUnread);
    const b = on('notification', (n: { kind: string }) => (n.kind === 'message' ? loadUnread() : load()));
    return () => {
      a();
      b();
    };
  }, [on, loadUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAll(await api.bookings('all'));
    } catch (e: any) {
      Alert.alert('Couldn’t load bookings', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      loadUnread();
    }, [load, loadUnread]),
  );

  const today = isoDay();
  const needsMe = (b: Booking) => b.can_review || (b.role === 'owner' && b.status === 'pending');
  const mine = all.filter((b) => b.role === tab);
  const sections = [
    { title: 'Needs you', data: mine.filter(needsMe) },
    { title: 'Upcoming', data: mine.filter((b) => !needsMe(b) && ['pending', 'accepted'].includes(b.status) && b.end_date >= today) },
    { title: 'Past', data: mine.filter((b) => !needsMe(b) && !(['pending', 'accepted'].includes(b.status) && b.end_date >= today)) },
  ].filter((x) => x.data.length);
  const count = (t: Tab) => all.filter((b) => b.role === t && needsMe(b)).length;

  const act = async (b: Booking, action: Action) => {
    setBusyId(b.id);
    try {
      await api.bookingAction(b.id, action);
      await load();
      if (action === 'accept') Alert.alert('Booking confirmed', 'Overlapping requests were declined and those days are now blocked.');
    } catch (e: any) {
      Alert.alert('Something went wrong', e.message);
    } finally {
      setBusyId(null);
    }
  };

  const confirm = (b: Booking, action: 'decline' | 'cancel') =>
    Alert.alert(action === 'decline' ? 'Decline this request?' : b.status === 'pending' ? 'Withdraw your request?' : 'Cancel this booking?', undefined, [
      { text: 'Keep', style: 'cancel' },
      { text: action === 'decline' ? 'Decline' : 'Yes, cancel', style: 'destructive', onPress: () => act(b, action) },
    ]);

  const renderItem = ({ item: b }: { item: Booking }) => {
    const other = b.role === 'owner' ? b.renter : b.owner;
    const started = b.start_date <= today;
    const st = statusStyle(b.status, c);
    const first = other.name.split(' ')[0];
    const actions: React.ReactNode[] = [];
    if (b.role === 'owner' && b.status === 'pending') {
      actions.push(<Button key="a" size="small" title="Accept" onPress={() => act(b, 'accept')} loading={busyId === b.id} style={{ flex: 1 }} />);
      actions.push(<Button key="d" size="small" variant="secondary" title="Decline" onPress={() => confirm(b, 'decline')} style={{ flex: 1 }} />);
    }
    if (b.role === 'owner' && b.status === 'accepted' && started)
      actions.push(<Button key="r" size="small" title="Mark as returned" onPress={() => act(b, 'complete')} loading={busyId === b.id} style={{ flex: 1 }} />);
    if ((b.status === 'pending' && b.role === 'renter') || (b.status === 'accepted' && !started))
      actions.push(
        <Button key="c" size="small" variant="secondary" title={b.status === 'pending' ? 'Withdraw' : 'Cancel booking'} onPress={() => confirm(b, 'cancel')} style={{ flex: 1 }} />,
      );
    if (b.can_review)
      actions.push(<Button key="v" size="small" title={`Review ${first}`} icon="star" onPress={() => nav.navigate('Review', { booking: b })} style={{ flex: 1 }} />);

    return (
      <Pressable onPress={() => nav.navigate('ItemDetail', { id: b.item.id })}>
        {({ pressed }) => (
          <View style={[s.card, pressed && { opacity: 0.85 }]}>
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <Image source={{ uri: mediaUrl(b.item.cover_url) }} style={s.thumb} />
              <View style={{ flex: 1, gap: 3 }}>
                <StatusDot color={st.color} label={st.label} />
                <Text style={s.title} numberOfLines={1}>
                  {b.item.title}
                </Text>
                <Text style={s.meta}>
                  {fmtRange(b.start_date, b.end_date)} · {b.days} day{b.days > 1 ? 's' : ''} · {money(b.total_price)}
                  {b.club_discount && b.club_discount > 0 ? ` · −${money(b.club_discount)} club` : ''}
                </Text>
                {b.role === 'owner' && b.owner_payout != null && (b.platform_fee ?? 0) > 0 && (
                  <Text style={[s.meta, { color: c.text }]}>
                    You get {money(b.owner_payout)} · {money(b.platform_fee!)} service fee
                  </Text>
                )}
              </View>
            </View>
            <View style={s.person}>
              <Avatar name={other.name} url={other.avatar_url} size={24} />
              <Text style={s.meta} numberOfLines={1}>
                {b.role === 'owner' ? `${other.name} wants to borrow it` : `From ${other.name}`}
                {other.rating_count ? ` · ★ ${other.rating_avg?.toFixed(1)}` : ''}
              </Text>
              {b.status !== 'declined' && b.status !== 'cancelled' && (
                <Pressable onPress={() => nav.navigate('Chat', { bookingId: b.id })} style={s.chatBtn} hitSlop={6} accessibilityLabel={`Message ${first}`}>
                  <Ionicons name="chatbubble-ellipses" size={15} color={c.accent} />
                  <Text style={s.chatText}>Message</Text>
                  {(chatUnread[b.id] ?? 0) > 0 && (
                    <View style={s.chatBadge}>
                      <Text style={s.chatBadgeText}>{chatUnread[b.id]}</Text>
                    </View>
                  )}
                </Pressable>
              )}
            </View>
            {!!b.message && <Text style={s.msg}>“{b.message}”</Text>}
            {actions.length > 0 && <View style={{ flexDirection: 'row', gap: 8 }}>{actions}</View>}
            {b.reviewed_by_me && <Text style={[s.meta, { fontSize: 13 }]}>You reviewed this rental</Text>}
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={s.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(b) => String(b.id)}
        renderItem={renderItem}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <LargeHeader title="Bookings" />
            <Segmented
              value={tab}
              onChange={setTab}
              style={{ marginHorizontal: 20, marginTop: 4, marginBottom: 8 }}
              options={[
                { value: 'renter', label: 'Borrowing', badge: count('renter') },
                { value: 'owner', label: 'Lending', badge: count('owner') },
              ]}
            />
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={s.section}>{section.title}</Text>}
        contentContainerStyle={{ paddingBottom: bottom }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
        ListEmptyComponent={
          loading ? undefined : tab === 'renter' ? (
            <Empty icon="bag-handle-outline" title="Nothing borrowed yet" text="Find something on Explore and request a few days." />
          ) : (
            <Empty icon="file-tray-outline" title="No requests yet" text="When neighbours want to borrow your things, it shows up here." />
          )
        }
      />
    </View>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  section: { ...type.footnote, color: c.text2, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 22, marginBottom: 10 },
  card: { marginHorizontal: 20, padding: 14, gap: 12, borderRadius: 22, backgroundColor: c.surface },
  thumb: { width: 72, height: 72, borderRadius: 16, backgroundColor: c.imageBg },
  title: { ...type.headline, color: c.text },
  meta: { ...type.subhead, color: c.text2, flexShrink: 1 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatBtn: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: c.accentSoft },
  chatText: { color: c.accent, fontWeight: '800', fontSize: 13 },
  chatBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' },
  chatBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  msg: { ...type.callout, color: c.text, lineHeight: 21 },
}));

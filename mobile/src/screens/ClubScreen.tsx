import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ClubInfo, ClubMessage } from '../api';
import { useAuth } from '../auth';
import { CLUB_GOLD, VerifiedBadge } from '../components/Badges';
import { Avatar, Button, NavHeader } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { useRealtime } from '../realtime';
import { makeStyles, type, useTheme } from '../theme';

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Rent Club: progress for everyone; members (and admins) get the group chat. */
export default function ClubScreen({ navigation }: ScreenProps<'Club'>) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { on, clubSend, clubJoin, clubRead, setClubOpen } = useRealtime();
  const [info, setInfo] = useState<ClubInfo | null>(null);
  const [messages, setMessages] = useState<ClubMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const load = useCallback(async () => {
    try {
      const i = await api.club();
      setInfo(i);
      if (i.can_chat) {
        clubJoin();
        setMessages(await api.clubMessages());
        clubRead();
      }
    } catch (e: any) {
      Alert.alert('Couldn’t load the club', e.message);
    }
  }, [clubJoin, clubRead]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setClubOpen(true);
      return () => setClubOpen(false);
    }, [setClubOpen]),
  );

  useEffect(
    () =>
      on('club_message', (m: ClubMessage) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.sender.id !== user?.id) clubRead();
      }),
    [on, clubRead, user?.id],
  );

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await clubSend(body);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setText('');
    } catch (e: any) {
      Alert.alert('Message not sent', e.message);
    } finally {
      setSending(false);
    }
  };

  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  if (!info) {
    return (
      <View style={s.screen}>
        <NavHeader title="Rent Club" onBack={() => navigation.goBack()} />
        <ActivityIndicator style={{ marginTop: 40 }} color={c.text2} />
      </View>
    );
  }

  const header = (
    <View style={s.hero}>
      <View style={s.medal}>
        <Ionicons name="ribbon" size={30} color="#fff" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.heroTitle}>Rent Club</Text>
        <Text style={s.heroSub}>
          {info.member_count} member{info.member_count === 1 ? '' : 's'} · {info.discount_percent}% off every booking
        </Text>
      </View>
      <Pressable onPress={() => setShowMembers((v) => !v)} hitSlop={8} accessibilityLabel="Show members">
        <View style={s.avatars}>
          {info.members.slice(0, 3).map((m, i) => (
            <View key={m.id} style={{ marginLeft: i ? -12 : 0, borderRadius: 16, borderWidth: 2, borderColor: c.surface }}>
              <Avatar name={m.name} url={m.avatar_url} size={28} />
            </View>
          ))}
        </View>
      </Pressable>
    </View>
  );

  /* ---------- not a member yet: progress + perks ---------- */
  if (!info.can_chat) {
    const pct = Math.min(1, info.rentals / info.needed);
    const left = Math.max(0, info.needed - info.rentals);
    return (
      <View style={s.screen}>
        <NavHeader title="Rent Club" onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 40 }}>
          {header}
          <View style={s.card}>
            <Text style={s.cardTitle}>
              {left === 0 ? 'Almost there!' : `${left} more rental${left === 1 ? '' : 's'} to join`}
            </Text>
            <View style={s.track}>
              <View style={[s.fill, { width: `${pct * 100}%` }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {Array.from({ length: info.needed }, (_, i) => (
                <View key={i} style={[s.step, i < info.rentals && { backgroundColor: CLUB_GOLD, borderColor: CLUB_GOLD }]}>
                  {i < info.rentals ? <Ionicons name="checkmark" size={14} color="#fff" /> : <Text style={s.stepN}>{i + 1}</Text>}
                </View>
              ))}
            </View>
            <Text style={s.muted}>A rental counts once the owner marks the item as returned.</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Members get</Text>
            {[
              ['ribbon', 'The gold Rent Club badge on your profile, bookings and chats'],
              ['pricetag', `${info.discount_percent}% off every booking`],
              ['chatbubbles', 'The members’ chat: tips, swaps and first dibs on new listings'],
            ].map(([icon, label]) => (
              <View key={label} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={s.perkIcon}>
                  <Ionicons name={icon as any} size={18} color={CLUB_GOLD} />
                </View>
                <Text style={[s.body, { flex: 1 }]}>{label}</Text>
              </View>
            ))}
          </View>
          <Button title="Find something to rent" icon="search" onPress={() => navigation.navigate('Tabs', { screen: 'Explore' } as never)} />
        </ScrollView>
      </View>
    );
  }

  /* ---------- members' chat ---------- */
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <NavHeader title="Rent Club" onBack={() => navigation.goBack()} />
      <View style={{ paddingHorizontal: 14 }}>{header}</View>
      {showMembers && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 14, paddingTop: 10 }}>
          {info.members.map((m) => (
            <View key={m.id} style={{ alignItems: 'center', width: 64, gap: 4 }}>
              <Avatar name={m.name} url={m.avatar_url} size={44} />
              <Text style={s.memberName} numberOfLines={1}>
                {m.name.split(' ')[0]}
              </Text>
              <Text style={s.memberN}>{m.rentals} rentals</Text>
            </View>
          ))}
        </ScrollView>
      )}
      <FlatList
        inverted
        data={reversed}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 14, gap: 10, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
            <Ionicons name="chatbubbles-outline" size={40} color={c.text3} />
            <Text style={[s.muted, { textAlign: 'center' }]}>You’re in! Say hi to the other members.</Text>
          </View>
        }
        renderItem={({ item: m, index }) => {
          const mine = m.sender.id === user?.id;
          const next = reversed[index + 1]; // the message above (list is inverted)
          const showName = !mine && (!next || next.sender.id !== m.sender.id);
          return (
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end' }}>
              {!mine && <Avatar name={m.sender.name} url={m.sender.avatar_url} size={30} />}
              <View style={{ maxWidth: '78%', gap: 3 }}>
                {showName && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 6 }}>
                    <Text style={s.sender}>{m.sender.name}</Text>
                    {m.sender.id_verified && <VerifiedBadge small />}
                    {m.sender.is_admin && <Text style={s.mod}>MOD</Text>}
                  </View>
                )}
                <View style={[s.bubble, mine ? s.mine : s.theirs]}>
                  <Text style={[s.msg, mine && { color: c.onAccent }]}>{m.body}</Text>
                  <Text style={[s.time, mine && { color: c.onAccent, opacity: 0.75 }]}>{time(m.created_at)}</Text>
                </View>
              </View>
            </View>
          );
        }}
      />
      <View style={[s.composer, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message the club"
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          multiline
          maxLength={2000}
          style={s.input}
        />
        <Pressable onPress={send} disabled={!text.trim() || sending} style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]} accessibilityLabel="Send message">
          {sending ? <ActivityIndicator color={c.onAccent} size="small" /> : <Ionicons name="arrow-up" size={20} color={c.onAccent} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    backgroundColor: CLUB_GOLD + (scheme === 'dark' ? '2E' : '1C'),
    borderWidth: 1,
    borderColor: CLUB_GOLD + '55',
  },
  medal: { width: 52, height: 52, borderRadius: 26, backgroundColor: CLUB_GOLD, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...type.title2, color: c.text },
  heroSub: { fontSize: 13, color: c.text2, fontWeight: '600' },
  avatars: { flexDirection: 'row' },
  card: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: scheme === 'dark' ? 0 : 1, borderColor: c.separator },
  cardTitle: { ...type.headline, color: c.text },
  track: { height: 10, borderRadius: 5, backgroundColor: c.fill, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: CLUB_GOLD },
  step: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: c.separator, alignItems: 'center', justifyContent: 'center' },
  stepN: { fontSize: 12, fontWeight: '800', color: c.text3 },
  perkIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: CLUB_GOLD + '22', alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 15, color: c.text, lineHeight: 20 },
  muted: { fontSize: 13, color: c.text2, lineHeight: 18 },
  memberName: { fontSize: 12, fontWeight: '700', color: c.text },
  memberN: { fontSize: 10, color: c.text2 },
  sender: { fontSize: 12, fontWeight: '800', color: c.text2 },
  mod: { fontSize: 9, fontWeight: '900', color: c.onAccent, backgroundColor: c.accent, paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, gap: 2 },
  mine: { backgroundColor: c.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: c.surface, borderBottomLeftRadius: 6, borderWidth: scheme === 'dark' ? 0 : 1, borderColor: c.separator },
  msg: { fontSize: 16, lineHeight: 21, color: c.text },
  time: { fontSize: 11, color: c.text3, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: c.bg },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 130,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: c.text,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.separator,
  },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
}));


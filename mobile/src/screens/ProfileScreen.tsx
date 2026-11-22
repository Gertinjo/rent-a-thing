import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Review } from '../api';
import { useAuth } from '../auth';
import AccountBanner from '../components/AccountBanner';
import { CLUB_GOLD, UserBadges } from '../components/Badges';
import { useRealtime } from '../realtime';
import { Avatar, Button, Glass, ListGroup, ListRow, Stars, useTabBarSpace } from '../components/ui';
import { APP } from '../content';
import type { RootStackParamList } from '../navigation';
import { Alert } from '../platform';
import { ACCENTS, fmtDate, makeStyles, type, useTheme } from '../theme';

export default function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, signOut, refresh, setUser } = useAuth();
  const { c, mode, accentKey } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const [reviews, setReviews] = useState<Review[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      refresh().catch(() => {});
      api.userReviews(user.id).then(setReviews).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]),
  );

  if (!user) return null;

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

  const logOut = () =>
    Alert.alert('Log out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: signOut },
    ]);

  const clubUnread = useRealtime().unread.club ?? 0;
  const modeLabel = { system: 'Automatic', light: 'Light', dark: 'Dark' }[mode];

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: bottom, paddingHorizontal: 16, gap: 28 }}>
      {/* ---------- identity ---------- */}
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Pressable onPress={changeAvatar} accessibilityLabel="Change profile photo">
          <Avatar name={user.name} url={user.avatar_url} size={104} />
          <Glass radius={17} style={s.camera}>
            <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="camera" size={17} color={c.text} />
            </View>
          </Glass>
        </Pressable>
        <Text style={s.name}>{user.name}</Text>
        <UserBadges user={user} labels />
        <Text style={s.meta}>
          {[user.neighborhood, `Joined ${new Date(user.created_at).getFullYear()}`].filter(Boolean).join(' · ')}
        </Text>
        {!!user.bio && <Text style={s.bio}>{user.bio}</Text>}
        <Button title="Edit profile" size="small" variant="secondary" onPress={() => nav.navigate('EditProfile')} style={{ marginTop: 10 }} />
      </View>

      <AccountBanner />

      {/* ---------- stats ---------- */}
      <View style={s.stats}>
        {[
          { n: user.rating_count ? user.rating_avg!.toFixed(1) : '–', l: user.rating_count ? `${user.rating_count} review${user.rating_count === 1 ? '' : 's'}` : 'No rating' },
          { n: String(user.listings_count), l: 'Listed' },
          { n: String(user.rentals_count), l: 'Borrowed' },
          { n: String(user.lendings_count), l: 'Lent out' },
        ].map((x, i) => (
          <View key={i} style={[s.stat, i > 0 && s.statBorder]}>
            <Text style={s.statN}>{x.n}</Text>
            <Text style={s.statL}>{x.l}</Text>
          </View>
        ))}
      </View>

      {/* ---------- reviews ---------- */}
      {reviews.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={s.groupTitle}>What neighbours say</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginHorizontal: -16 }}>
            <View style={{ width: 6 }} />
            {reviews.map((r) => (
              <View key={r.id} style={s.review}>
                <Stars value={r.rating} size={12} />
                <Text style={s.reviewText} numberOfLines={4}>
                  {r.comment || 'No comment'}
                </Text>
                <View style={{ flex: 1 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Avatar name={r.reviewer.name} url={r.reviewer.avatar_url} size={24} />
                  <Text style={s.reviewBy} numberOfLines={1}>
                    {r.reviewer.name.split(' ')[0]} · {fmtDate(r.created_at.slice(0, 10))}
                  </Text>
                </View>
              </View>
            ))}
            <View style={{ width: 6 }} />
          </ScrollView>
        </View>
      )}

      {/* ---------- settings ---------- */}
      {user.is_admin && (
        <ListGroup title="Administration" footer="Only admins can see this.">
          <ListRow icon="speedometer" iconColor="#636366" label="Admin dashboard" onPress={() => nav.navigate('Admin')} />
        </ListGroup>
      )}

      <ListGroup title="Trust & community">
        <ListRow
          icon="shield-checkmark"
          iconColor="#2563EB"
          label="ID verification"
          value={{ none: 'Not verified', pending: 'Being checked', verified: 'Verified ✓', rejected: 'Try again' }[user.id_status]}
          onPress={() => nav.navigate('VerifyId')}
        />
        <ListRow
          icon="ribbon"
          iconColor={CLUB_GOLD}
          label="Rent Club"
          value={user.club_member ? (clubUnread ? `${clubUnread} new` : 'Member') : `${Math.min(user.rental_count, 5)}/5 rentals`}
          onPress={() => nav.navigate('Club')}
        />
        {!user.is_admin && (
          <ListRow
            icon="cube"
            iconColor="#FF9500"
            label="Lending"
            value={{ none: 'Apply to lend', pending: 'Being reviewed', approved: 'Approved', rejected: 'Not approved' }[user.approval_status]}
            onPress={() => nav.navigate('ListingEditor', {})}
          />
        )}
      </ListGroup>

      <ListGroup title="Account">
        <ListRow icon="person" label="Edit profile" onPress={() => nav.navigate('EditProfile')} />
        <ListRow icon="contrast" iconColor="#5E5CE6" label="Appearance" value={`${modeLabel} · ${ACCENTS[accentKey].name}`} onPress={() => nav.navigate('Appearance')} />
      </ListGroup>

      <ListGroup title="Support">
        <ListRow icon="help-buoy" iconColor="#30B0C7" label="Help & FAQ" onPress={() => nav.navigate('Help')} />
        <ListRow icon="chatbubble-ellipses" iconColor="#34C759" label="Contact us" onPress={() => nav.navigate('Contact')} />
        <ListRow icon="shield-half" iconColor="#FF3B30" label="Report a safety issue" onPress={() => nav.navigate('Contact', { topic: 'safety' })} />
      </ListGroup>

      <ListGroup title="Legal">
        <ListRow icon="document-text" iconColor="#8E8E93" label="Terms of Service" onPress={() => nav.navigate('Legal', { doc: 'terms' })} />
        <ListRow icon="lock-closed" iconColor="#8E8E93" label="Privacy Policy" onPress={() => nav.navigate('Legal', { doc: 'privacy' })} />
        <ListRow icon="people" iconColor="#FF9500" label="Rental rules" onPress={() => nav.navigate('Legal', { doc: 'rules' })} />
      </ListGroup>

      <ListGroup footer={`${APP.name} ${APP.version} · ${user.email}`}>
        <ListRow icon="information-circle" iconColor="#8E8E93" label="About" onPress={() => nav.navigate('About')} />
        <ListRow label="Log out" destructive onPress={logOut} chevron={false} />
      </ListGroup>
    </ScrollView>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  screen: { flex: 1, backgroundColor: c.grouped },
  camera: { position: 'absolute', right: -2, bottom: -2 },
  name: { ...type.title, color: c.text, marginTop: 10 },
  meta: { ...type.subhead, color: c.text2 },
  bio: { ...type.callout, color: c.text, textAlign: 'center', marginTop: 6, paddingHorizontal: 24, lineHeight: 21 },
  stats: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: 18, paddingVertical: 14 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statBorder: { borderLeftWidth: 1, borderLeftColor: c.separator },
  statN: { fontSize: 20, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  statL: { fontSize: 12, color: c.text2 },
  groupTitle: { ...type.footnote, color: c.text2, textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 16 },
  review: { width: 250, height: 150, backgroundColor: c.surface, borderRadius: 18, padding: 14, gap: 8 },
  reviewText: { ...type.callout, color: c.text, lineHeight: 20 },
  reviewBy: { ...type.footnote, color: c.text2, flex: 1 },
}));

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';

import { api, Item, mediaUrl } from '../api';
import { daysLeft } from '../components/PromoCarousel';
import PromoteSheet from '../components/PromoteSheet';
import { Button, Empty, GlassIconButton, LargeHeader, Rating, useTabBarSpace } from '../components/ui';
import type { RootStackParamList } from '../navigation';
import { Alert } from '../platform';
import { makeStyles, money, type, useTheme } from '../theme';

export default function MyListingsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { c } = useTheme();
  const s = useStyles();
  const bottom = useTabBarSpace();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [promoting, setPromoting] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.myItems());
    } catch (e: any) {
      Alert.alert('Couldn’t load your things', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const live = items.filter((i) => i.is_active && i.review_status === 'approved').length;

  return (
    <View style={s.screen}>
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        ListHeaderComponent={
          <LargeHeader
            title="My things"
            subtitle={items.length ? `${live} live${items.length - live ? ` · ${items.length - live} not live` : ''}` : undefined}
            right={<GlassIconButton icon="add" label="List a thing" onPress={() => nav.navigate('ListingEditor', {})} />}
          />
        }
        contentContainerStyle={{ paddingBottom: bottom }}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
        renderItem={({ item }) => {
          const isLive = item.is_active && item.review_status === 'approved';
          const promoDays = item.promo_until ? daysLeft(item.promo_until) : 0;
          return (
          <Pressable onPress={() => nav.navigate('ItemDetail', { id: item.id })}>
            {({ pressed }) => (
              <View style={[s.row, pressed && { backgroundColor: c.fill }, !item.is_active && { opacity: 0.5 }]}>
                <Image source={{ uri: mediaUrl(item.cover_url) }} style={s.thumb} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.title} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={s.meta}>
                    {money(item.price_per_day)} / day{!item.is_active ? ' · Hidden' : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 2 }}>
                    <Rating avg={item.rating_avg} count={item.rating_count} size={12} />
                    {promoDays > 0 && isLive ? (
                      <Text style={[s.tag, { color: c.accent }]}>Promoted · {promoDays}d left</Text>
                    ) : item.promo_review === 'pending' && isLive ? (
                      <Text style={[s.tag, { color: c.warning }]}>Promo in review</Text>
                    ) : item.review_status === 'pending' ? (
                      <Text style={[s.tag, { color: c.warning }]}>Waiting for approval</Text>
                    ) : item.review_status === 'rejected' ? (
                      <Text style={[s.tag, { color: c.danger }]}>Changes needed</Text>
                    ) : !item.location ? (
                      <Text style={[s.tag, { color: c.accent }]}>Add a location</Text>
                    ) : item.has_360 ? (
                      <Text style={[s.tag, { color: c.text2 }]}>360° ready</Text>
                    ) : (
                      <Text style={[s.tag, { color: c.accent }]}>Add a 360° view</Text>
                    )}
                  </View>
                </View>
                {isLive && (
                  <Pressable hitSlop={8} onPress={() => setPromoting(item)} accessibilityLabel={promoDays > 0 ? 'Manage promotion' : 'Promote'}>
                    {({ pressed: p }) => (
                      <View style={[s.promoBtn, promoDays > 0 && { backgroundColor: c.accent }, p && { opacity: 0.7 }]}>
                        <Ionicons name={promoDays > 0 ? 'megaphone' : 'megaphone-outline'} size={17} color={promoDays > 0 ? c.onAccent : c.accent} />
                      </View>
                    )}
                  </Pressable>
                )}
                <Pressable hitSlop={12} onPress={() => nav.navigate('ListingEditor', { id: item.id })} accessibilityLabel="Edit">
                  <Ionicons name="ellipsis-horizontal-circle-outline" size={26} color={c.text2} />
                </Pressable>
              </View>
            )}
          </Pressable>
          );
        }}
        ListEmptyComponent={
          loading ? undefined : (
            <Empty
              icon="cube-outline"
              title="Nothing listed yet"
              text="That drill in your cupboard could pay for itself. It takes two minutes."
              action={<Button title="List a thing" icon="add" onPress={() => nav.navigate('ListingEditor', {})} />}
            />
          )
        }
      />
      <PromoteSheet
        item={promoting}
        onClose={() => setPromoting(null)}
        onChanged={(u) => setItems((list) => list.map((i) => (i.id === u.id ? u : i)))}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  sep: { height: 1, backgroundColor: c.separator, marginLeft: 20 + 76 + 14 },
  thumb: { width: 76, height: 76, borderRadius: 18, backgroundColor: c.imageBg },
  title: { ...type.headline, color: c.text },
  meta: { ...type.subhead, color: c.text2 },
  tag: { fontSize: 12, fontWeight: '600' },
  promoBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft },
}));

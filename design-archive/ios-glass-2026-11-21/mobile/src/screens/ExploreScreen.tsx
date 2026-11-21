import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { api, CATEGORIES, ItemBrief } from '../api';
import { useAuth } from '../auth';
import AccountBanner from '../components/AccountBanner';
import ItemCard, { FeaturedCard } from '../components/ItemCard';
import { Avatar, Empty, LargeHeader, SectionTitle, useTabBarSpace } from '../components/ui';
import type { RootStackParamList } from '../navigation';
import { categoryIcon, categoryLabel, makeStyles, type, useTheme } from '../theme';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function ExploreScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNav = useNavigation<any>();
  const { user } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const bottom = useTabBarSpace();
  const [items, setItems] = useState<ItemBrief[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.items({ q: q || undefined, category }));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, category]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const visible = items.filter((i) => i.owner_id !== user?.id);
  const filtering = !!q || !!category;
  const featured = visible.filter((i) => i.has_360);
  const open = (id: number) => nav.navigate('ItemDetail', { id });
  const cardW = Math.min(width, 430) * 0.78;

  const header = (
    <View>
      <LargeHeader
        subtitle={`${greeting()}, ${user?.name.split(' ')[0] ?? ''}`}
        title="Explore"
        right={
          <Pressable onPress={() => tabNav.navigate('Profile')} accessibilityLabel="Your profile">
            <Avatar name={user?.name ?? '?'} url={user?.avatar_url} size={38} />
          </Pressable>
        }
      />
      <View style={s.searchWrap}>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={c.text2} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Drills, tents, cameras…"
            placeholderTextColor={c.text2}
            selectionColor={c.accent}
            style={s.searchInput}
            returnKeyType="search"
          />
          {!!q && (
            <Pressable onPress={() => setQ('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={c.text3} />
            </Pressable>
          )}
        </View>
      </View>
      <AccountBanner style={{ marginHorizontal: 20, marginTop: 12 }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cats}>
        {CATEGORIES.map((cat) => {
          const on = category === cat;
          return (
            <Pressable key={cat} onPress={() => setCategory(on ? undefined : cat)} style={[s.cat, on && { backgroundColor: c.text }]}>
              <Ionicons name={categoryIcon[cat] as any} size={16} color={on ? c.bg : c.text} />
              <Text style={[s.catText, on && { color: c.bg }]}>{categoryLabel[cat]}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!filtering && featured.length > 0 && (
        <View style={{ gap: 14, marginTop: 10 }}>
          <View style={{ paddingHorizontal: 20 }}>
            <SectionTitle>Look around in 360°</SectionTitle>
            <Text style={s.sectionSub}>Spin it before you borrow it.</Text>
          </View>
          <FlatList
            horizontal
            data={featured}
            keyExtractor={(i) => `f${i.id}`}
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardW + 12}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            renderItem={({ item }) => <FeaturedCard item={item} width={cardW} onPress={() => open(item.id)} />}
          />
        </View>
      )}

      <View style={{ paddingHorizontal: 20, marginTop: 28, marginBottom: 14 }}>
        <SectionTitle>{filtering ? `${visible.length} ${visible.length === 1 ? 'result' : 'results'}` : 'Near you'}</SectionTitle>
      </View>
    </View>
  );

  return (
    <View style={s.screen}>
      <FlatList
        data={visible}
        keyExtractor={(i) => String(i.id)}
        numColumns={2}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: 14, paddingHorizontal: 20 }}
        contentContainerStyle={{ gap: 22, paddingBottom: bottom }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
        renderItem={({ item }) => (
          <View style={{ flex: 1 / 2 }}>
            <ItemCard item={item} onPress={() => open(item.id)} />
          </View>
        )}
        ListEmptyComponent={
          loading ? undefined : error ? (
            <Empty icon="cloud-offline-outline" title="Can’t reach the server" text={error} />
          ) : (
            <Empty icon="search-outline" title="Nothing found" text="Try another word or category — or list your own thing." />
          )
        }
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  searchWrap: { paddingHorizontal: 20, paddingTop: 4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.fill, borderRadius: 14, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, fontSize: 17, color: c.text, height: 44 },
  cats: { gap: 8, paddingHorizontal: 20, paddingVertical: 16 },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: c.fill },
  catText: { fontSize: 14, fontWeight: '600', color: c.text },
  sectionSub: { ...type.subhead, color: c.text2, marginTop: 2 },
}));

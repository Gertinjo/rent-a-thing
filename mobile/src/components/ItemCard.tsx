import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { ItemBrief, mediaUrl } from '../api';
import { categoryIcon, makeStyles, money, useTheme } from '../theme';
import { Glass, Rating } from './ui';

export function Badge360({ small }: { small?: boolean }) {
  const { c } = useTheme();
  return (
    <Glass radius={12} shadow={false} style={{ position: 'absolute', top: 10, left: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: small ? 7 : 9, paddingVertical: small ? 3 : 5 }}>
        <Ionicons name="sync" size={small ? 11 : 13} color={c.text} />
        <Text style={{ color: c.text, fontWeight: '700', fontSize: small ? 11 : 12 }}>360°</Text>
      </View>
    </Glass>
  );
}

/** Grid card: big rounded image, quiet text underneath (no box). */
export default function ItemCard({ item, onPress }: { item: ItemBrief; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      {({ pressed }) => (
        <View style={{ gap: 8, transform: [{ scale: pressed ? 0.98 : 1 }] }}>
          <View style={s.imgWrap}>
            {item.cover_url ? (
              <Image source={{ uri: mediaUrl(item.cover_url) }} style={s.img} />
            ) : (
              <Ionicons name={categoryIcon[item.category] as any} size={36} color={c.text3} />
            )}
            {item.has_360 && <Badge360 small />}
          </View>
          <View style={{ gap: 2, paddingHorizontal: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
              <Text style={s.title} numberOfLines={1}>
                {item.title}
              </Text>
            </View>
            <Text style={s.meta} numberOfLines={1}>
              {item.location_label || item.neighborhood || 'Nearby'}
            </Text>
            <View style={s.row}>
              <Text style={s.price}>
                {money(item.price_per_day)}
                <Text style={s.per}> day</Text>
              </Text>
              <Rating avg={item.rating_avg} count={item.rating_count} size={12} />
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Wide card for the horizontal "Look around in 360°" shelf. */
export function FeaturedCard({ item, onPress, width }: { item: ItemBrief; onPress: () => void; width: number }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[s.featured, { width, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
          <Image source={{ uri: mediaUrl(item.cover_url) }} style={s.img} />
          <Badge360 />
          <Glass radius={20} style={s.featuredInfo}>
            <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, { fontSize: 16 }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={s.meta} numberOfLines={1}>
                  {item.owner_name.split(' ')[0]} · {item.location_label || item.neighborhood || 'Nearby'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.price, { color: c.text }]}>{money(item.price_per_day)}</Text>
                <Text style={s.meta}>per day</Text>
              </View>
            </View>
          </Glass>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  imgWrap: {
    aspectRatio: 1,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: c.imageBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { width: '100%', height: '100%' },
  title: { fontSize: 15, fontWeight: '600', color: c.text, letterSpacing: -0.2, flex: 1 },
  meta: { fontSize: 13, color: c.text2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 },
  price: { fontSize: 15, fontWeight: '700', color: c.text },
  per: { fontWeight: '400', color: c.text2 },
  featured: { height: 300, borderRadius: 28, overflow: 'hidden', backgroundColor: c.imageBg },
  featuredInfo: { position: 'absolute', left: 10, right: 10, bottom: 10 },
}));

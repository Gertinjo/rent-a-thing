import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

import { useTheme } from '../theme';

/** Gold "Rent Club" member badge. */
export const CLUB_GOLD = '#C9922E';

export function ClubBadge({ small }: { small?: boolean }) {
  const size = small ? 10 : 12;
  return (
    <View
      accessibilityLabel="Rent Club member"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: small ? 6 : 8,
        paddingVertical: small ? 2 : 3,
        borderRadius: 999,
        backgroundColor: CLUB_GOLD + '24',
        borderWidth: 1,
        borderColor: CLUB_GOLD + '66',
      }}
    >
      <Ionicons name="ribbon" size={size} color={CLUB_GOLD} />
      <Text style={{ color: CLUB_GOLD, fontWeight: '800', fontSize: small ? 10 : 12 }}>Rent Club</Text>
    </View>
  );
}

export function VerifiedBadge({ small, label }: { small?: boolean; label?: boolean }) {
  const { c } = useTheme();
  if (!label) return <Ionicons name="shield-checkmark" size={small ? 13 : 16} color={c.info} accessibilityLabel="ID verified" />;
  return (
    <View
      accessibilityLabel="ID verified"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.info + '1C' }}
    >
      <Ionicons name="shield-checkmark" size={12} color={c.info} />
      <Text style={{ color: c.info, fontWeight: '800', fontSize: 12 }}>ID verified</Text>
    </View>
  );
}

/** The badges a person has earned, for next to their name. */
export function UserBadges({ user, small, labels }: { user?: { club_member?: boolean; id_verified?: boolean } | null; small?: boolean; labels?: boolean }) {
  if (!user || (!user.club_member && !user.id_verified)) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      {user.id_verified && <VerifiedBadge small={small} label={labels} />}
      {user.club_member && <ClubBadge small={small} />}
    </View>
  );
}

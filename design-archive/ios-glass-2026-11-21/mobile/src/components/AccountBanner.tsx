import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '../auth';
import { type, useTheme } from '../theme';

/** Shown while a new account waits for an admin (or was not approved). */
export default function AccountBanner({ style }: { style?: object }) {
  const { user } = useAuth();
  const { c } = useTheme();
  if (!user || user.approval_status === 'approved') return null;
  const rejected = user.approval_status === 'rejected';
  const color = rejected ? c.danger : c.warning;
  return (
    <View style={[{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: color + '1F' }, style]}>
      <Ionicons name={rejected ? 'alert-circle' : 'hourglass-outline'} size={22} color={color} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: c.text }}>{rejected ? 'Account not approved' : 'Your account is being reviewed'}</Text>
        <Text style={{ ...type.subhead, color: c.text2, lineHeight: 19 }}>
          {rejected
            ? `${user.approval_note || 'An admin couldn’t approve your account.'} Update your profile or contact us from Profile.`
            : 'Look around and list your things meanwhile. Booking unlocks once an admin approves you, usually within a few hours.'}
        </Text>
      </View>
    </View>
  );
}

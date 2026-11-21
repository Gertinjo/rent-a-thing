import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '../auth';
import { type, useTheme } from '../theme';

/** Shown while a new account waits for an admin (or was not approved), or still has to verify its ID. */
export default function AccountBanner({ style }: { style?: object }) {
  const { user } = useAuth();
  const { c } = useTheme();
  const nav = useNavigation<any>();
  if (user && user.approval_status === 'approved' && user.id_required && user.id_status !== 'verified') {
    const st = user.id_status;
    const color = st === 'rejected' ? c.danger : st === 'pending' ? c.warning : c.info;
    return (
      <Pressable onPress={() => nav.navigate('VerifyId')} accessibilityRole="button">
        <View style={[{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: color + '1F', alignItems: 'center' }, style]}>
          <Ionicons name={st === 'pending' ? 'hourglass-outline' : st === 'rejected' ? 'alert-circle' : 'shield-checkmark'} size={24} color={color} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.headline, color: c.text }}>
              {st === 'pending' ? 'We’re checking your ID' : st === 'rejected' ? 'Your ID needs another try' : 'Verify your ID to start renting'}
            </Text>
            <Text style={{ ...type.subhead, color: c.text2, lineHeight: 19 }}>
              {st === 'pending'
                ? 'You can book and list as soon as it’s verified, usually within a day.'
                : st === 'rejected'
                  ? user.id_note || 'Please send clearer photos.'
                  : 'Everyone verifies once: a photo of your ID and a selfie. Takes a minute.'}
            </Text>
          </View>
          {st !== 'pending' && <Ionicons name="chevron-forward" size={18} color={c.text3} />}
        </View>
      </Pressable>
    );
  }
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

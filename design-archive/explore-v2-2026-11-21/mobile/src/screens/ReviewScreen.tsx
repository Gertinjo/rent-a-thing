import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, mediaUrl } from '../api';
import { Avatar, Button, NavHeader, Stars } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { fmtRange, makeStyles, type, useTheme } from '../theme';

const LABELS = ['Tap a star', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

export default function ReviewScreen({ route, navigation }: ScreenProps<'Review'>) {
  const { booking: b } = route.params;
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const other = b.role === 'owner' ? b.renter : b.owner;
  const first = other.name.split(' ')[0];
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.review({ booking_id: b.id, rating, comment });
      Alert.alert('Review posted', `Thanks — it helps neighbours trust ${first}.`);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Couldn’t post your review', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <NavHeader title="Review" onBack={() => navigation.goBack()} backIcon="close" />
      <ScrollView contentContainerStyle={{ padding: 24, gap: 26, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 12 }}>
          <View>
            <Image source={{ uri: mediaUrl(b.item.cover_url) }} style={s.thumb} />
            <View style={s.avatarRing}>
              <Avatar name={other.name} url={other.avatar_url} size={40} />
            </View>
          </View>
          <Text style={s.q}>{b.role === 'renter' ? `How was borrowing from ${first}?` : `How was ${first} as a borrower?`}</Text>
          <Text style={s.meta}>
            {b.item.title} · {fmtRange(b.start_date, b.end_date)}
          </Text>
        </View>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Stars value={rating} size={40} onChange={setRating} gap={12} />
          <Text style={{ color: rating ? c.text : c.text2, fontWeight: '600', fontSize: 15 }}>{LABELS[rating]}</Text>
        </View>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder={b.role === 'renter' ? 'Was it as described? Was the hand-off easy?' : 'Was it returned on time and in good shape?'}
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          multiline
          style={s.input}
        />
        <Button title="Post review" onPress={submit} loading={busy} disabled={!rating} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  thumb: { width: 96, height: 96, borderRadius: 24, backgroundColor: c.imageBg },
  avatarRing: { position: 'absolute', right: -12, bottom: -12, borderRadius: 24, borderWidth: 4, borderColor: c.bg },
  q: { ...type.title2, color: c.text, textAlign: 'center', marginTop: 8 },
  meta: { ...type.subhead, color: c.text2 },
  input: { backgroundColor: c.fill, borderRadius: 18, padding: 16, minHeight: 130, fontSize: 16, color: c.text, textAlignVertical: 'top' },
}));

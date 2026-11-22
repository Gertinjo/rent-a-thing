import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { api, Place } from '../api';
import { Alert } from '../platform';
import { makeStyles, type, useTheme } from '../theme';
import MapEmbed from './MapEmbed';
import { Button } from './ui';

/** Pick a pick-up spot: search an address or use the phone's current position. */
export default function LocationPicker({ value, onChange }: { value: Place | null; onChange: (p: Place | null) => void }) {
  const { c } = useTheme();
  const s = useStyles();
  const [editing, setEditing] = useState(!value);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => setEditing(!value), [value]);

  useEffect(() => {
    if (q.trim().length < 3) return setResults([]);
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api.searchPlaces(q.trim()));
      } catch (e: any) {
        Alert.alert('Address search failed', e.message);
      } finally {
        setSearching(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (p: Place) => {
    onChange(p);
    setQ('');
    setResults([]);
  };

  const useCurrent = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Location permission was not given. Search for the address instead.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      pick(await api.reversePlace(pos.coords.latitude, pos.coords.longitude));
    } catch (e: any) {
      Alert.alert(
        'Couldn’t get your location',
        e?.message?.includes('secure') || e?.code === 1
          ? 'Browsers only share location on secure (https) pages. Search for the address instead.'
          : e?.message ?? 'Search for the address instead.',
      );
    } finally {
      setLocating(false);
    }
  };

  if (value && !editing) {
    return (
      <View style={{ gap: 10 }}>
        <MapEmbed lat={value.lat} lng={value.lng} zoom={16} height={170} />
        <View style={s.chosen}>
          <Ionicons name="location" size={20} color={c.accent} />
          <Text style={s.chosenText} numberOfLines={2}>
            {value.label || 'Pinned location'}
          </Text>
          <Pressable onPress={() => setEditing(true)} hitSlop={8}>
            <Text style={s.link}>Change</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={s.search}>
        <Ionicons name="search" size={18} color={c.text2} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Street and area, e.g. Rr. Pashko Vasa, Qyteza Pejton"
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          style={s.input}
          autoCorrect={false}
        />
        {searching && <ActivityIndicator size="small" color={c.text2} />}
      </View>
      {results.map((r, i) => (
        <Pressable key={`${r.lat},${r.lng},${i}`} onPress={() => pick(r)} style={({ pressed }) => [s.result, pressed && { backgroundColor: c.fill }]}>
          <Ionicons name="location-outline" size={18} color={c.text2} />
          <Text style={{ color: c.text, flex: 1, fontSize: 15 }} numberOfLines={2}>
            {r.label}
          </Text>
        </Pressable>
      ))}
      {q.trim().length >= 3 && !searching && results.length === 0 && <Text style={s.hint}>No matches yet — try adding the city.</Text>}
      <Button title="Use my current location" icon="locate-outline" variant="secondary" onPress={useCurrent} loading={locating} />
      {value && <Button title="Keep the current location" variant="plain" size="small" onPress={() => setEditing(false)} />}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.fill, borderRadius: 14, paddingHorizontal: 12, height: 48 },
  input: { flex: 1, fontSize: 16, color: c.text, height: 48 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12 },
  hint: { ...type.footnote, color: c.text2, marginLeft: 4 },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.fill, borderRadius: 14, padding: 12 },
  chosenText: { flex: 1, color: c.text, fontSize: 15, fontWeight: '500' },
  link: { color: c.accent, fontWeight: '600', fontSize: 15 },
}));

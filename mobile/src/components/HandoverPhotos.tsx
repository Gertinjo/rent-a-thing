import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Booking, HandoverPhoto, HandoverStage, LocalFile, mediaUrl } from '../api';
import { Alert } from '../platform';
import { makeStyles, type, useTheme } from '../theme';

const MAX_PER_STAGE = 6; // per person, same as the server
const COMPAT = { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
const toFile = (a: ImagePicker.ImagePickerAsset): LocalFile => ({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, file: a.file });
const STAGES: { key: HandoverStage; label: string }[] = [
  { key: 'pickup', label: 'Pick-up' },
  { key: 'return', label: 'Return' },
];

/**
 * Condition photos inside a booking card. Both people can photograph the item at pick-up and at
 * return, so there's a shared record if something gets damaged. Shown while a confirmed rental is
 * running (from the day before) and afterwards whenever photos exist.
 */
export default function HandoverPhotos({ booking: b, onChange }: { booking: Booking; onChange: (b: Booking) => void }) {
  const { c } = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState<HandoverStage | null>(null);
  const [open, setOpen] = useState<HandoverPhoto | null>(null);
  const photos = b.handover_photos ?? [];
  const canAdd = !!b.can_add_handover;
  if (!canAdd && photos.length === 0) return null;

  const me = b.role === 'owner' ? b.owner.id : b.renter.id;
  const who = (p: HandoverPhoto) => (p.uploader_id === me ? 'you' : (p.uploader_id === b.owner.id ? b.owner : b.renter).name.split(' ')[0]);

  const upload = async (stage: HandoverStage, camera: boolean) => {
    const room = MAX_PER_STAGE - photos.filter((p) => p.stage === stage && p.uploader_id === me).length;
    if (room <= 0) return Alert.alert(`You’ve added ${MAX_PER_STAGE} photos here`, 'That’s the most per person.');
    if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return Alert.alert('Camera access is needed');
    const res = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 0.7, ...COMPAT });
    if (res.canceled || !res.assets.length) return;
    setBusy(stage);
    try {
      onChange(await api.addHandoverPhotos(b.id, stage, res.assets.slice(0, room).map(toFile)));
    } catch (e: any) {
      Alert.alert('Couldn’t add the photos', e.message);
    } finally {
      setBusy(null);
    }
  };

  const add = (stage: HandoverStage) => {
    // In a phone browser the file picker already offers the camera.
    if (Platform.OS === 'web') return upload(stage, false);
    Alert.alert(`${stage === 'pickup' ? 'Pick-up' : 'Return'} photos`, 'Show the whole item and any marks or damage.', [
      { text: 'Take photo', onPress: () => upload(stage, true) },
      { text: 'Choose from library', onPress: () => upload(stage, false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const remove = (p: HandoverPhoto) =>
    Alert.alert('Remove this photo?', undefined, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            onChange(await api.deleteHandoverPhoto(b.id, p.id));
            setOpen(null);
          } catch (e: any) {
            Alert.alert('Couldn’t remove it', e.message);
          }
        },
      },
    ]);

  return (
    <View style={s.box}>
      <View style={s.head}>
        <Ionicons name="camera" size={16} color={c.text} />
        <Text style={s.headText}>Handover photos</Text>
      </View>
      {photos.length === 0 && <Text style={s.hint}>Photograph the item when it changes hands, so you both have a record of its condition.</Text>}
      {STAGES.map(({ key, label }) => {
        const list = photos.filter((p) => p.stage === key);
        if (!canAdd && list.length === 0) return null;
        return (
          <View key={key} style={s.row}>
            <Text style={s.label}>{label}</Text>
            <View style={s.thumbs}>
              {list.map((p) => (
                <Pressable key={p.id} onPress={() => setOpen(p)} accessibilityLabel={`${label} photo by ${who(p)}`}>
                  <Image source={{ uri: mediaUrl(p.url) }} style={s.thumb} />
                </Pressable>
              ))}
              {canAdd &&
                (busy === key ? (
                  <View style={[s.thumb, s.add]}>
                    <ActivityIndicator color={c.accent} />
                  </View>
                ) : (
                  <Pressable onPress={() => add(key)} style={[s.thumb, s.add]} accessibilityLabel={`Add ${label.toLowerCase()} photos`} disabled={!!busy}>
                    <Ionicons name="add" size={22} color={c.accent} />
                  </Pressable>
                ))}
            </View>
          </View>
        );
      })}
      <PhotoViewer photo={open} by={open ? who(open) : ''} onClose={() => setOpen(null)} onRemove={remove} />
    </View>
  );
}

function PhotoViewer({ photo, by, onClose, onRemove }: { photo: HandoverPhoto | null; by: string; onClose: () => void; onRemove: (p: HandoverPhoto) => void }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  if (!photo) return null;
  const when = new Date(photo.created_at.endsWith('Z') ? photo.created_at : photo.created_at + 'Z');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.viewer}>
        <Pressable style={[s.close, { top: insets.top + 12 }]} onPress={onClose} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
        <Image source={{ uri: mediaUrl(photo.url) }} style={s.full} resizeMode="contain" />
        <View style={[s.caption, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={s.captionText}>
            {photo.stage === 'pickup' ? 'Pick-up' : 'Return'} · by {by} · {when.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </Text>
          {photo.can_delete && (
            <Pressable onPress={() => onRemove(photo)} hitSlop={8} style={s.removeBtn}>
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={s.removeText}>Remove</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  box: { backgroundColor: c.grouped, borderRadius: 16, padding: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { ...type.footnote, fontWeight: '700', color: c.text },
  hint: { ...type.footnote, color: c.text2, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { ...type.caption, color: c.text2, width: 52 },
  thumbs: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 46, height: 46, borderRadius: 12, backgroundColor: c.imageBg },
  add: { backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' },
  close: { position: 'absolute', right: 16, zIndex: 2, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '75%' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  captionText: { ...type.footnote, color: 'rgba(255,255,255,0.85)', flex: 1 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  removeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
}));

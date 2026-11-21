// Native (iOS/Android) version. The browser version is MapEmbed.web.tsx.
import React from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { embedUrl } from '../maps';
import { AreaRing, MapProps, useMapStyles } from './MapEmbedShared';

export default function MapEmbed({ lat, lng, zoom = 15, height = 200, approximate }: MapProps) {
  const s = useMapStyles();
  return (
    <View style={[s.wrap, { height }]}>
      <WebView source={{ uri: embedUrl(lat, lng, zoom) }} style={{ flex: 1 }} scrollEnabled={false} originWhitelist={['*']} />
      {approximate && <AreaRing />}
    </View>
  );
}

// Browser version: a plain iframe (react-native-web renders straight to the DOM).
import React from 'react';
import { View } from 'react-native';

import { embedUrl } from '../maps';
import { AreaRing, MapProps, useMapStyles } from './MapEmbedShared';

export default function MapEmbed({ lat, lng, zoom = 15, height = 200, approximate }: MapProps) {
  const s = useMapStyles();
  return (
    <View style={[s.wrap, { height }]}>
      {React.createElement('iframe', {
        src: embedUrl(lat, lng, zoom),
        title: 'Map',
        loading: 'lazy',
        referrerPolicy: 'no-referrer-when-downgrade',
        style: { border: 0, width: '100%', height: '100%' },
      })}
      {approximate && <AreaRing />}
    </View>
  );
}

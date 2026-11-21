import React from 'react';
import { View } from 'react-native';

import { makeStyles, useTheme } from '../theme';

export interface MapProps {
  lat: number;
  lng: number;
  zoom?: number;
  height?: number;
  /** Draw a soft circle instead of implying an exact spot. */
  approximate?: boolean;
}

/** Translucent ring over the map centre: "somewhere around here". */
export function AreaRing() {
  const { c } = useTheme();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 130, height: 130, borderRadius: 65, backgroundColor: c.accentSoft, borderWidth: 2, borderColor: c.accent }} />
    </View>
  );
}

export const useMapStyles = makeStyles((c) => ({
  wrap: { width: '100%', borderRadius: 20, overflow: 'hidden', backgroundColor: c.imageBg },
}));

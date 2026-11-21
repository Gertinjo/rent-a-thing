import { Linking } from 'react-native';

/**
 * Google Maps without any setup: the classic embed URL and the official "Maps URLs" need no key.
 * If you add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to mobile/.env, the official Maps Embed API is used
 * instead (free, unlimited — https://developers.google.com/maps/documentation/embed/usage-and-billing).
 */
const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export function embedUrl(lat: number, lng: number, zoom = 15) {
  return KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${KEY}&q=${lat},${lng}&zoom=${zoom}`
    : `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&hl=en&output=embed`;
}

/** Opens Google Maps (app if installed, website otherwise) with directions to the point. */
export const openDirections = (lat: number, lng: number) =>
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);

/** Opens Google Maps centred on the point. */
export const openInMaps = (lat: number, lng: number) =>
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);

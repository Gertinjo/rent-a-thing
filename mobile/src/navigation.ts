import { createNavigationContainerRef } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { Booking } from './api';
import type { LegalDoc } from './content';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Tabs: undefined;
  ItemDetail: { id: number };
  Viewer360: { frames: string[]; title: string };
  ListingEditor: { id?: number };
  Review: { booking: Booking };
  EditProfile: undefined;
  Appearance: undefined;
  Contact: { topic?: 'general' | 'booking' | 'safety' | 'bug' | 'feedback'; bookingId?: number } | undefined;
  Help: undefined;
  Legal: { doc: LegalDoc };
  About: undefined;
  Admin: undefined;
  AdminApprovals: undefined;
  AdminInbox: undefined;
  Chat: { bookingId: number };
  Messages: undefined;
  Notifications: undefined;
  Club: undefined;
  VerifyId: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

/** Lets code outside screens (e.g. the live notification banner) navigate. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

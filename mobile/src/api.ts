import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the FastAPI server lives.
 * - EXPO_PUBLIC_API_URL wins if set (e.g. a tunnel or deployed URL).
 * - Otherwise reuse the IP of the machine running Metro (works for a phone with Expo Go on the
 *   same Wi-Fi, the iOS simulator and the Android emulator) on port 8000.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // In a browser (laptop or a phone on the same Wi-Fi) the API lives on the same machine that served the page.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // Served by the FastAPI server itself (port 8000): same address. From the Expo dev server: port 8000.
    const { protocol, hostname, port, origin } = window.location;
    return port === '8000' ? origin : `${protocol}//${hostname}:8000`;
  }
  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const host = hostUri.split(':')[0];
  if (host) return `http://${host}:8000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
}

export const API_URL = resolveBaseUrl();

export const mediaUrl = (path?: string | null) =>
  !path ? undefined : path.startsWith('http') ? path : `${API_URL}${path}`;

// ---------- types (mirror backend/app/schemas.py) ----------
export type Category =
  | 'tools' | 'garden' | 'camping' | 'bikes' | 'photo' | 'electronics' | 'party'
  | 'sports' | 'kids' | 'home' | 'music' | 'travel' | 'other';
export const CATEGORIES: Category[] = [
  'tools', 'garden', 'camping', 'bikes', 'photo', 'electronics', 'party', 'sports', 'kids', 'home', 'music', 'travel', 'other',
];
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export interface Place {
  label: string;
  lat: number;
  lng: number;
}
export interface ItemLocation extends Place {
  /** false = rounded to ~500 m; the exact pin is shared once the owner confirms your booking */
  exact: boolean;
}

export interface UserBrief {
  id: number;
  name: string;
  neighborhood: string;
  avatar_url: string | null;
  /** public badges */
  club_member?: boolean;
  id_verified?: boolean;
}
export interface User extends UserBrief {
  bio: string;
  created_at: string;
  rating_avg: number | null;
  rating_count: number;
}
export interface Me extends User {
  email: string;
  is_admin: boolean;
  approval_status: ApprovalStatus;
  approval_note: string;
  listings_count: number;
  rentals_count: number;
  lendings_count: number;
  club_member: boolean;
  rental_count: number;
  id_status: IdStatus;
  id_note: string;
  /** true when the app requires an ID check for this account */
  id_required: boolean;
}
export type IdStatus = 'none' | 'pending' | 'verified' | 'rejected';
export type IdDocType = 'id_card' | 'passport' | 'driving_licence';
export interface Verification {
  status: IdStatus;
  doc_type: IdDocType | '';
  note: string;
  submitted_at: string | null;
  verified_at: string | null;
  required: boolean;
}
export interface ClubInfo {
  is_member: boolean;
  can_chat: boolean;
  rentals: number;
  needed: number;
  discount_percent: number;
  member_count: number;
  members: { id: number; name: string; avatar_url: string | null; rentals: number }[];
  unread: number;
}
export interface ClubMessage {
  id: number;
  body: string;
  created_at: string;
  sender: { id: number; name: string; avatar_url: string | null; is_admin: boolean; id_verified: boolean };
}
export type ContactTopic = 'general' | 'booking' | 'safety' | 'bug' | 'feedback';
export interface Photo {
  id: number;
  url: string;
}
export interface Item {
  id: number;
  title: string;
  description: string;
  category: Category;
  price_per_day: number;
  deposit: number;
  neighborhood: string;
  cover_url: string | null;
  is_active: boolean;
  created_at: string;
  owner: User;
  photos: Photo[];
  spin_frames: string[];
  has_360: boolean;
  rating_avg: number | null;
  rating_count: number;
  location: ItemLocation | null;
  review_status: ApprovalStatus;
  review_note: string;
}
export interface ItemBrief {
  id: number;
  title: string;
  category: Category;
  price_per_day: number;
  neighborhood: string;
  cover_url: string | null;
  has_360: boolean;
  rating_avg: number | null;
  rating_count: number;
  owner_id: number;
  owner_name: string;
  location_label: string;
}
export interface CalendarRange {
  start_date: string;
  end_date: string;
  kind: 'booked' | 'blocked' | 'pending';
  id: number;
  note: string;
}
export interface Calendar {
  item_id: number;
  start: string;
  end: string;
  ranges: CalendarRange[];
  unavailable_days: string[];
}
export type BookingStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'completed';
export interface Booking {
  id: number;
  item: ItemBrief;
  renter: User;
  owner: User;
  start_date: string;
  end_date: string;
  days: number;
  total_price: number;
  platform_fee?: number;
  owner_payout?: number;
  club_discount?: number;
  status: BookingStatus;
  message: string;
  created_at: string;
  role: 'renter' | 'owner';
  can_review: boolean;
  reviewed_by_me: boolean;
}
export interface Review {
  id: number;
  booking_id: number;
  item_id: number;
  direction: 'renter_to_owner' | 'owner_to_renter';
  rating: number;
  comment: string;
  created_at: string;
  reviewer: UserBrief;
}
export interface ListingDraft {
  is_rentable_item: boolean;
  title: string;
  category: Category;
  description: string;
  price_per_day: number;
  deposit: number;
  note: string;
}
export interface AICheck {
  verdict?: 'ok' | 'check' | 'reject';
  summary?: string;
  issues?: { severity: 'high' | 'medium' | 'low'; text: string }[];
  message_to_owner?: string;
  error?: string;
  checked_at?: string;
}
export interface ChatMessage {
  id: number;
  booking_id: number;
  sender_id: number;
  body: string;
  created_at: string;
  read_at: string | null;
}
export interface ChatThread {
  booking_id: number;
  status: BookingStatus;
  start_date: string;
  end_date: string;
  item: { id: number; title: string; cover_url: string | null };
  other: { id: number; name: string; avatar_url: string | null };
  role: 'renter' | 'owner';
  last_message: ChatMessage | null;
  unread: number;
  activity: string;
}
export interface AppNotification {
  id: number;
  kind: 'message' | 'booking_request' | 'booking_accepted' | 'booking_declined' | 'booking_cancelled' | 'booking_completed' | 'review' | string;
  title: string;
  body: string;
  booking_id: number | null;
  item_id: number | null;
  read: boolean;
  created_at: string;
}
export interface Unread {
  messages: number;
  notifications: number;
  club?: number;
}
export interface LocalFile {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  /** Set by the image picker in a browser. */
  file?: File | null;
}

// ---------- request helper ----------
let token: string | null = null;
export const getToken = () => token;
export const setToken = (t: string | null) => {
  token = t;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 20000): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload, signal: ctrl.signal });
  } catch {
    throw new ApiError(0, `Can't reach the server at ${API_URL}. Is the backend running?`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as any)?.detail;
    const msg = Array.isArray(detail) ? detail.map((d: any) => d.msg).join('\n') : detail || `Error ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

async function appendFile(fd: FormData, field: string, f: LocalFile, fallbackName: string, fallbackType: string) {
  const name = f.name || (f.uri.startsWith('data:') || f.uri.startsWith('blob:') ? '' : f.uri.split('/').pop()) || fallbackName;
  if (Platform.OS === 'web') {
    // Browsers need a real Blob/File in FormData.
    const blob = f.file ?? (await (await fetch(f.uri)).blob());
    fd.append(field, blob, name);
    return;
  }
  // React Native's FormData accepts {uri, name, type} objects for files.
  fd.append(field, { uri: f.uri, name, type: f.mimeType || fallbackType } as unknown as Blob);
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

// ---------- endpoints ----------
export const api = {
  register: (b: { name: string; email: string; password: string; neighborhood: string }) =>
    request<{ access_token: string; user: Me }>('POST', '/auth/register', b),
  login: (email: string, password: string) =>
    request<{ access_token: string; user: Me }>('POST', '/auth/login', { email, password }),
  me: () => request<Me>('GET', '/users/me'),
  updateMe: (b: Partial<Pick<Me, 'name' | 'neighborhood' | 'bio'>>) => request<Me>('PATCH', '/users/me', b),
  uploadAvatar: async (f: LocalFile) => {
    const fd = new FormData();
    await appendFile(fd, 'file', f, 'avatar.jpg', 'image/jpeg');
    return request<Me>('POST', '/users/me/avatar', fd, 60000);
  },
  changePassword: (current_password: string, new_password: string) =>
    request<void>('POST', '/users/me/password', { current_password, new_password }),
  deleteAccount: (password: string) => request<void>('DELETE', '/users/me', { password }),
  contact: (b: { topic: ContactTopic; message: string; email?: string; name?: string; booking_id?: number }) =>
    request<{ id: number }>('POST', '/support/contact', b),
  user: (id: number) => request<User>('GET', `/users/${id}`),
  userReviews: (id: number) => request<Review[]>('GET', `/users/${id}/reviews`),

  items: (p: { q?: string; category?: string; has_360?: boolean; available_from?: string; available_to?: string } = {}) =>
    request<ItemBrief[]>('GET', `/items${qs(p)}`),
  myItems: () => request<Item[]>('GET', '/items/mine'),
  item: (id: number) => request<Item>('GET', `/items/${id}`),
  config: () => request<{ platform_fee_percent: number; currency: string; currency_symbol: string }>('GET', '/config'),
  createItem: (b: { title: string; description: string; category: Category; price_per_day: number; deposit: number; location?: Place | null; terms_accepted?: boolean }) =>
    request<Item>('POST', '/items', b),
  updateItem: (id: number, b: Partial<Omit<Item, 'location'>> & { location?: Place | null }) => request<Item>('PATCH', `/items/${id}`, b),
  aiStatus: () => request<{ enabled: boolean; model: string }>('GET', '/ai/status'),
  aiListingDraft: async (files: LocalFile[], note = '') => {
    const fd = new FormData();
    for (const [i, f] of files.entries()) await appendFile(fd, 'files', f, `photo${i}.jpg`, 'image/jpeg');
    fd.append('note', note);
    return request<ListingDraft>('POST', '/ai/listing-draft', fd, 90000);
  },
  searchPlaces: (q: string) => request<Place[]>('GET', `/geo/search${qs({ q })}`),
  reversePlace: (lat: number, lng: number) => request<Place>('GET', `/geo/reverse${qs({ lat, lng })}`),
  deleteItem: (id: number) => request<void>('DELETE', `/items/${id}`),
  addPhotos: async (id: number, files: LocalFile[]) => {
    const fd = new FormData();
    for (const [i, f] of files.entries()) await appendFile(fd, 'files', f, `photo${i}.jpg`, 'image/jpeg');
    return request<Item>('POST', `/items/${id}/photos`, fd, 120000);
  },
  deletePhoto: (id: number, photoId: number) => request<Item>('DELETE', `/items/${id}/photos/${photoId}`),
  uploadSpinVideo: async (id: number, f: LocalFile, frames = 36) => {
    const fd = new FormData();
    await appendFile(fd, 'file', f, 'spin.mp4', 'video/mp4');
    return request<Item>('POST', `/items/${id}/spin/video?frames=${frames}`, fd, 300000);
  },
  uploadSpinFrames: async (id: number, files: LocalFile[]) => {
    const fd = new FormData();
    for (const [i, f] of files.entries()) {
      await appendFile(fd, 'files', f, `frame${String(i).padStart(3, '0')}.jpg`, 'image/jpeg');
    }
    return request<Item>('POST', `/items/${id}/spin/frames`, fd, 300000);
  },
  deleteSpin: (id: number) => request<Item>('DELETE', `/items/${id}/spin`),

  calendar: (id: number, start?: string, end?: string) => request<Calendar>('GET', `/items/${id}/calendar${qs({ start, end })}`),
  addBlackout: (id: number, start_date: string, end_date: string, note = '') =>
    request<Calendar>('POST', `/items/${id}/blackouts`, { start_date, end_date, note }),
  deleteBlackout: (id: number, blackoutId: number) => request<Calendar>('DELETE', `/items/${id}/blackouts/${blackoutId}`),
  itemReviews: (id: number) => request<Review[]>('GET', `/items/${id}/reviews`),

  bookings: (role: 'renter' | 'owner' | 'all' = 'all') => request<Booking[]>('GET', `/bookings?role=${role}`),
  requestBooking: (b: { item_id: number; start_date: string; end_date: string; message: string }) =>
    request<Booking>('POST', '/bookings', b),
  bookingAction: (id: number, action: 'accept' | 'decline' | 'cancel' | 'complete') =>
    request<Booking>('POST', `/bookings/${id}/${action}`),
  review: (b: { booking_id: number; rating: number; comment: string }) => request<Review>('POST', '/reviews', b),

  // ----- chat + notifications (live updates come over Socket.IO, see src/realtime.tsx) -----
  chats: () => request<ChatThread[]>('GET', '/chats'),
  messages: (bookingId: number) => request<ChatMessage[]>('GET', `/bookings/${bookingId}/messages`),
  sendMessage: (bookingId: number, body: string) => request<ChatMessage>('POST', `/bookings/${bookingId}/messages`, { body }),
  markRead: (bookingId: number) => request<{ read: number } & Unread>('POST', `/bookings/${bookingId}/read`),
  notifications: () => request<{ items: AppNotification[] } & Unread>('GET', '/notifications'),
  readNotifications: () => request<Unread>('POST', '/notifications/read'),
  unread: () => request<Unread>('GET', '/me/unread'),

  // ----- Rent Club + ID verification -----
  club: () => request<ClubInfo>('GET', '/club'),
  clubMessages: () => request<ClubMessage[]>('GET', '/club/messages'),
  clubSend: (body: string) => request<ClubMessage>('POST', '/club/messages', { body }),
  clubRead: () => request<Unread>('POST', '/club/read'),
  verification: () => request<Verification>('GET', '/me/verification'),
  submitVerification: async (docType: IdDocType, front: LocalFile, selfie: LocalFile) => {
    const fd = new FormData();
    fd.append('doc_type', docType);
    await appendFile(fd, 'front', front, 'id-front.jpg', 'image/jpeg');
    await appendFile(fd, 'selfie', selfie, 'selfie.jpg', 'image/jpeg');
    return request<Verification>('POST', '/me/verification', fd, 120000);
  },
};

// ---------- admin (mirror backend/app/routers/admin.py) ----------
export interface AdminAction {
  id: number;
  action: string;
  target_type: string;
  target_id: number;
  summary: string;
  reason: string;
  admin_name: string;
  created_at: string;
}
export interface AdminStats {
  users: number;
  new_users_7d: number;
  suspended_users: number;
  admins: number;
  listings_active: number;
  listings_hidden: number;
  listings_with_360: number;
  bookings: Record<BookingStatus, number>;
  bookings_total: number;
  revenue_completed: number;
  revenue_upcoming: number;
  reviews: number;
  avg_rating: number | null;
  open_messages: number;
  pending_users: number;
  pending_listings: number;
  bookings_per_day: { date: string; count: number }[];
  recent_actions: AdminAction[];
}
export interface AdminUser {
  id: number;
  name: string;
  email: string;
  neighborhood: string;
  avatar_url: string | null;
  created_at: string;
  is_admin: boolean;
  is_suspended: boolean;
  suspended_reason: string;
  approval_status: ApprovalStatus;
  approval_note: string;
  bio: string;
  listings_count: number;
  bookings_count: number;
  rating_avg: number | null;
  rating_count: number;
}
export interface AdminItem {
  id: number;
  title: string;
  category: Category;
  price_per_day: number;
  cover_url: string | null;
  is_active: boolean;
  has_360: boolean;
  owner_id: number;
  owner_name: string;
  owner_email: string;
  owner_suspended: boolean;
  owner_approval: ApprovalStatus;
  bookings_count: number;
  rating_avg: number | null;
  rating_count: number;
  created_at: string;
  description: string;
  deposit: number;
  photos: string[];
  spin_frames: number;
  review_status: ApprovalStatus;
  review_note: string;
  location_label: string;
  lat: number | null;
  lng: number | null;
  ai_check: AICheck | null;
}
export interface AdminBooking {
  id: number;
  item_id: number;
  item_title: string;
  cover_url: string | null;
  renter_id: number;
  renter_name: string;
  owner_id: number;
  owner_name: string;
  start_date: string;
  end_date: string;
  days: number;
  total_price: number;
  status: BookingStatus;
  message: string;
  created_at: string;
}
export interface AdminReview {
  id: number;
  booking_id: number;
  item_id: number;
  item_title: string;
  direction: 'renter_to_owner' | 'owner_to_renter';
  rating: number;
  comment: string;
  reviewer: UserBrief;
  reviewee_name: string;
  created_at: string;
}
export interface AdminMessage {
  id: number;
  user_id: number | null;
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  booking_id: number | null;
  status: 'open' | 'resolved';
  admin_note: string;
  created_at: string;
  resolved_at: string | null;
}

export const admin = {
  stats: () => request<AdminStats>('GET', '/admin/stats'),
  actions: () => request<AdminAction[]>('GET', '/admin/actions'),
  users: (p: { q?: string; filter?: 'all' | 'pending' | 'admins' | 'suspended' | 'rejected' }) =>
    request<AdminUser[]>('GET', `/admin/users${qs(p)}`),
  updateUser: (id: number, b: { is_suspended?: boolean; is_admin?: boolean; approval_status?: ApprovalStatus; reason?: string }) =>
    request<AdminUser>('PATCH', `/admin/users/${id}`, b),
  items: (p: { q?: string; status?: 'all' | 'active' | 'hidden' | 'pending' | 'rejected' }) => request<AdminItem[]>('GET', `/admin/items${qs(p)}`),
  updateItem: (id: number, b: { is_active?: boolean; review_status?: ApprovalStatus; reason?: string }) =>
    request<AdminItem>('PATCH', `/admin/items/${id}`, b),
  runAICheck: (id: number) => request<AdminItem>('POST', `/admin/items/${id}/ai-check`, undefined, 90000),
  bookings: (p: { status?: string; q?: string }) => request<AdminBooking[]>('GET', `/admin/bookings${qs(p)}`),
  cancelBooking: (id: number, reason = '') => request<AdminBooking>('POST', `/admin/bookings/${id}/cancel`, { reason }),
  reviews: (p: { max_rating?: number } = {}) => request<AdminReview[]>('GET', `/admin/reviews${qs(p)}`),
  deleteReview: (id: number, reason = '') => request<void>('DELETE', `/admin/reviews/${id}${qs({ reason })}`),
  messages: (status: 'open' | 'resolved' | 'all') => request<AdminMessage[]>('GET', `/admin/messages?status=${status}`),
  updateMessage: (id: number, b: { status?: 'open' | 'resolved'; admin_note?: string }) =>
    request<AdminMessage>('PATCH', `/admin/messages/${id}`, b),
};

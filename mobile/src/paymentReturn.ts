import { useEffect } from 'react';

import { api } from './api';
import { navigationRef } from './navigation';
import { Alert, isWeb } from './platform';

/**
 * Stripe Checkout sends the browser back to  /?payment=success&booking=12&session_id=cs_test_...
 * (or payment=cancelled). Confirm with the server, tell the user, open Bookings, and clean the URL.
 */
export function usePaymentReturn(loggedIn: boolean) {
  useEffect(() => {
    if (!isWeb || !loggedIn || typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const result = q.get('payment');
    const booking = Number(q.get('booking'));
    if (!result || !booking) return;
    window.history.replaceState(null, '', window.location.pathname);
    const openBookings = () => navigationRef.isReady() && navigationRef.navigate('Tabs', { screen: 'Bookings' } as never);
    if (result !== 'success') {
      Alert.alert('Payment cancelled', 'No money was taken. You can pay later from Bookings.');
      setTimeout(openBookings, 300);
      return;
    }
    api
      .confirmPayment(booking, q.get('session_id') ?? undefined)
      .then((b) =>
        b.payment_status === 'paid'
          ? Alert.alert('Payment done ✓', `You paid ${b.total_price.toFixed(2)} € for ${b.item.title} (Stripe test mode, no real money).`)
          : Alert.alert('Payment not finished', 'Stripe hasn’t confirmed it yet. Check Bookings in a moment.'),
      )
      .catch((e) => Alert.alert('Couldn’t confirm the payment', e.message))
      .finally(() => setTimeout(openBookings, 300));
  }, [loggedIn]);
}

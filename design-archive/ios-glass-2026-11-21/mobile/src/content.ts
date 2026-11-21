/**
 * App info, FAQ and legal texts.
 *
 * The legal documents are a reasonable starting template for a hackathon, not legal advice.
 * Replace the company name, contact details and governing law before a real launch.
 */

export const APP = {
  name: 'Rent a Thing',
  version: '1.0.0',
  company: 'Rent a Thing',
  supportEmail: 'support@rentathing.app',
  responseTime: 'within 24 hours',
  updated: 'November 21, 2026',
};

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'How does renting work?',
    a: 'Find something on Explore, pick your pick-up and return days on the calendar and send a request. The owner accepts or declines. Once confirmed, the dates are blocked for everyone else and you arrange the hand-off together.',
  },
  {
    q: 'What is the 360° view?',
    a: 'Owners film one slow walk around their item. We turn it into a spin you can drag, so you can check every side, scratches included, before you book.',
  },
  {
    q: 'When do I pay?',
    a: 'The daily price and any refundable deposit are shown before you request. Payment is settled between neighbours at pick-up; the deposit is returned when the item comes back in the same condition.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes. You can withdraw a request at any time, and cancel a confirmed booking until the day it starts. Owners can do the same.',
  },
  {
    q: 'What if something breaks?',
    a: 'Tell the owner straight away and agree on a fix, a repair cost or keeping part of the deposit. If you can’t agree, contact us from Profile → Contact us and we’ll help.',
  },
  {
    q: 'How do reviews work?',
    a: 'After a rental ends both sides can leave one review. Reviews are public and help neighbours trust each other.',
  },
  {
    q: 'How do I list my own things?',
    a: 'Go to My things → List a thing. Add a title, a daily price and photos, then record a walk-around video for the 360° view.',
  },
];

export type LegalDoc = 'terms' | 'privacy' | 'rules';

export const LEGAL: Record<LegalDoc, { title: string; sections: { h: string; p: string }[] }> = {
  terms: {
    title: 'Terms of Service',
    sections: [
      {
        h: '1. About these terms',
        p: `These terms apply when you use ${APP.name} (“the app”). By creating an account you agree to them. If you don’t agree, please don’t use the app.`,
      },
      {
        h: '2. What we do',
        p: `${APP.name} helps neighbours lend and borrow everyday things. We provide the listings, calendar, booking requests and reviews. We are not a party to the rental itself — the agreement is between the owner and the renter.`,
      },
      {
        h: '3. Your account',
        p: 'You must be at least 18, give accurate information and keep your password safe. You are responsible for everything done with your account. You can delete your account at any time from Profile → Edit profile.',
      },
      {
        h: '4. Listing things',
        p: 'Only list things you own or are allowed to lend, that are safe, legal and work as described. Photos and 360° views must show the actual item and its real condition. Set a fair daily price and deposit and keep your calendar up to date.',
      },
      {
        h: '5. Renting things',
        p: 'Use items carefully and only for their intended purpose, return them on time, clean and in the same condition. If something breaks or goes missing, tell the owner immediately. You are responsible for loss or damage beyond normal wear during your rental.',
      },
      {
        h: '6. Payments, service fee and deposits',
        p: 'Prices are set by owners and shown before you request. Renters pay the listed price. Rent a Thing keeps a 10% service fee from each rental (for example €1 on a €10 rental, €2 on €20) and the owner receives the rest. Deposits are refundable and should be returned promptly when the item comes back as agreed.',
      },
      {
        h: '7. Cancellations',
        p: 'Renters can withdraw requests anytime and cancel confirmed bookings before the start date. Owners can decline requests and cancel confirmed bookings before the start date. Repeated last-minute cancellations may lead to account restrictions.',
      },
      {
        h: '8. Reviews',
        p: 'Reviews must be honest and based on a real rental. We may remove reviews that are abusive, discriminatory, contain personal data or are unrelated to the rental.',
      },
      {
        h: '9. Things you must not do',
        p: 'Don’t list prohibited items (weapons, drugs, hazardous materials, stolen goods), harass other users, misuse personal information, try to avoid the app to dodge reviews, or interfere with the service.',
      },
      {
        h: '10. Liability',
        p: 'The app is provided “as is”. To the extent allowed by law we are not liable for the condition, safety or legality of listed items, or for disputes between users. Nothing in these terms limits rights you have under consumer law.',
      },
      {
        h: '11. Ending your use',
        p: 'You can stop using the app and delete your account at any time. We may suspend accounts that break these terms or put others at risk.',
      },
      {
        h: '12. Changes and contact',
        p: `We may update these terms; we’ll tell you in the app if changes are significant. Questions? Write to ${APP.supportEmail} or use Contact us in the app.`,
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        h: 'What we collect',
        p: 'Account details (name, email, password stored as a secure hash), your profile (photo, neighbourhood, bio), listings and their photos and 360° frames, bookings, messages you send to support and reviews.',
      },
      {
        h: 'Why we use it',
        p: 'To run the service: show listings, manage availability and bookings, display reviews, keep the community safe and answer support requests. We don’t sell your personal data.',
      },
      {
        h: 'What others can see',
        p: 'Other users see your name, photo, neighbourhood, bio, rating, reviews and your listings. Your email address is never shown publicly.',
      },
      {
        h: 'Camera, photos and motion',
        p: 'The app asks for camera and photo access only when you add photos or record a 360° walk-around. Motion sensors are used only while you use “twist your phone” in the 360° viewer and are not stored.',
      },
      {
        h: 'How long we keep it',
        p: 'We keep your data while your account is active. When you delete your account we remove your profile details and hide your listings. Past bookings and reviews are kept in anonymised form so the other person’s history stays accurate.',
      },
      {
        h: 'Your rights',
        p: `You can view and edit your profile at any time, delete your account in the app, and ask us for a copy of your data or to correct it by writing to ${APP.supportEmail}.`,
      },
      {
        h: 'Security',
        p: 'Passwords are hashed, and sign-in uses expiring tokens. No system is perfectly secure, so use a unique password and tell us if you notice anything suspicious.',
      },
      {
        h: 'Changes',
        p: 'If we change this policy in a meaningful way we’ll let you know in the app.',
      },
    ],
  },
  rules: {
    title: 'Rental rules',
    sections: [
      { h: 'Be honest', p: 'Show the real item, its real condition and any quirks. Use the 360° view — it builds trust and avoids disputes.' },
      { h: 'Be on time', p: 'Agree a pick-up and return time and stick to it. If plans change, message early or cancel before the start date.' },
      { h: 'Treat it like your own', p: 'Use things only as intended, keep them clean and dry, and return them with all accessories and chargers.' },
      { h: 'Check together', p: 'At pick-up and return, look over the item together. A quick photo protects both of you.' },
      { h: 'If something goes wrong', p: 'Tell the owner immediately and agree a fair fix. If you can’t agree, contact us and we’ll help mediate.' },
      { h: 'Respect each other', p: 'No harassment, discrimination or pressure. Report anything that feels unsafe from Contact us → Safety.' },
      { h: 'Not allowed', p: 'Weapons, drugs, hazardous chemicals, recalled or unsafe products, stolen goods and anything illegal to lend.' },
    ],
  },
};

/** Shown in the pop-up every time someone adds a product. `fee` is the current service fee in %. */
export function lenderTerms(fee: number): { icon: string; title: string; text: string }[] {
  const ex = (price: number) => {
    const v = (price * fee) / 100;
    return `€${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
  };
  return [
    {
      icon: 'cash-outline',
      title: `${fee}% service fee`,
      text: `Rent a Thing keeps ${fee}% of each rental: ${ex(10)} on a €10 rental, ${ex(20)} on €20. You receive the rest. Renters pay the price you set.`,
    },
    { icon: 'camera-outline', title: 'Show the real item', text: 'Photos and the 360° view must show your actual item and its real condition, including any damage.' },
    { icon: 'shield-checkmark-outline', title: 'Safe and legal only', text: 'No weapons, drugs, hazardous or recalled products, stolen or counterfeit goods. You must own the item or be allowed to lend it.' },
    { icon: 'construct-outline', title: 'Working and clean', text: 'Hand it over working, clean and with everything the listing mentions. Agree on the deposit before pick-up.' },
    { icon: 'calendar-outline', title: 'Keep your calendar honest', text: 'Block days you need it yourself. Cancelling confirmed bookings at the last minute can limit your account.' },
    { icon: 'chatbubbles-outline', title: 'Everything in the app', text: 'No contact details or payment requests in the listing. Admins review new listings before they go live.' },
  ];
}

# Saved design: "iOS liquid glass" (2026-11-21)

This folder is a snapshot of the app's look before the redesign:
iOS-style screens, floating frosted-glass tab bar, tangerine accent, light/dark themes,
and the desktop admin console styling.

Contents
- mobile/src, mobile/App.tsx, mobile/app.json  -> the whole phone app UI at that point
- backend/admin_web                             -> the web admin console at that point

To restore it (this replaces the current design; back up the current one first if you want it):
    cp -R design-archive/ios-glass-2026-11-21/mobile/src     mobile/
    cp    design-archive/ios-glass-2026-11-21/mobile/App.tsx mobile/
    cp -R design-archive/ios-glass-2026-11-21/backend/admin_web backend/
    cd mobile && npx expo export --platform web

Note: features added after this date (backend endpoints) still work with this UI as long as the
API hasn't changed; check `npx tsc --noEmit` after restoring.

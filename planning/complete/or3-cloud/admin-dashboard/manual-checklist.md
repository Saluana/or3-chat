# Manual Verification Checklist (Admin Dashboard)

Use this checklist during dev/staging validation of the Admin Dashboard.

- [ ] Install a plugin zip → plugin appears in `/admin/plugins`
- [ ] Enable plugin for workspace → plugin loads in the main app
- [ ] Update plugin settings → settings persist and reload
- [ ] Install a theme zip → theme appears in `/admin/themes`
- [ ] Set default theme → config updated; theme applied after rebuild/restart
- [ ] Edit config → validation passes; restart required
- [ ] Restart server → process restarts cleanly
- [ ] Rebuild + restart → build completes and server restarts

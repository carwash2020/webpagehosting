-- storage.objects had "anon can read job photos" and "anon can read
-- receipts" policies left over from before the private-bucket +
-- signed-URL migration. Confirmed before dropping: the app's only
-- public-URL function (getJobPhotoUrl in sync.js) had zero call sites
-- anywhere in the codebase. Run 2026-08-14.

drop policy "anon can read job photos" on storage.objects;
drop policy "anon can read receipts" on storage.objects;

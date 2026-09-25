-- 2026-09-23 backend audit, LOW (docs/ACTION-ITEMS.md manual item #17):
-- applied directly via the Supabase MCP migration tool, mirrored here
-- after the fact per this repo's convention.
--
-- The work-order-photos bucket's only INSERT policy,
-- "authenticated clients can upload work order photos"
-- (create_work_order_photos_bucket, 2026-09-03), checked
-- `bucket_id = 'work-order-photos'` and nothing else. With public
-- signup on, any signed-in account -- a portal client, staff, or a
-- stranger who signed up -- could upload any file, of any type and up
-- to the project-wide size limit, at any path in the bucket. A
-- rolled-back probe against the live policy (2026-09-25) confirmed a
-- client could write `anything/evil.exe` and into another client's
-- folder. There was never a read-back (SELECT is internal-only) or an
-- overwrite (no UPDATE policy, and uploads don't send x-upsert), so
-- this was upload spam and storage cost only.
--
-- The only uploader is portal/work-orders.html's uploadSelectedPhotos().
-- It uploads BEFORE the work-order row exists, on purpose (clients
-- have no UPDATE policy on client_portal_work_orders, so photos can't
-- be attached afterward), so there is no work-order id to scope the
-- path to at upload time. Its path was
--   submissions/<Date.now()>-<random>/<n>.<ext>
-- which carried nothing tied to the caller. Alongside this migration
-- the page now uploads to
--   submissions/<auth.uid()>/<Date.now()>-<random>/<n>.<ext>
-- and the policy below requires exactly that shape, with the second
-- segment equal to the caller's own user id. storage.foldername() is
-- Supabase's own helper: every path segment except the file name.
--
-- The existing object (one, uploaded 2026-09-03 under the old shape)
-- is untouched: this only governs new inserts, and staff still read
-- every path through "internal accounts can read work order photos".
--
-- The bucket also gets the same limits the page already enforces
-- client-side: 8 MB per file (MAX_WO_PHOTO_BYTES) and images only (the
-- file input's accept="image/*"). Before this it had neither.
--
-- Deploy order: the page change went live first. The old policy
-- accepts the new path shape too, so there was no window where a real
-- upload failed.
drop policy if exists "authenticated clients can upload work order photos" on storage.objects;

create policy "Accounts can upload work order photos to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'work-order-photos'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

update storage.buckets
   set file_size_limit = 8388608,
       allowed_mime_types = array['image/*']
 where id = 'work-order-photos';

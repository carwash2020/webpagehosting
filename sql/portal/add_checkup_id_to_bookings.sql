-- Self-scheduling from a check-up reminder (2026-09-02), the natural
-- next step flagged in docs/CLIENT-PORTAL.md's own phase 5 entry: "a
-- natural next step once wanted, reusing phase 3's scheduling UI."
-- checkup_id is a REAL foreign key, same reasoning as th_bookings'
-- existing quote_id -- client_portal_checkups is a real table, unlike
-- th_jobs (workspace_sync blob), so a proper FK is possible here too.
alter table th_bookings add column checkup_id bigint references client_portal_checkups(id);

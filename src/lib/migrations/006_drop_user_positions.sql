-- Drop user_positions as part of the Night's Watch feature removal (per-user manually-
-- logged options-position tracker, embedded in the /nighthawk page). The feature was
-- retired product-side and its UI/API/DB code deleted in the same change — 0DTE Command
-- took over the vacated /nighthawk slot instead. This table is not preserved/exported;
-- the site owner confirmed a hard drop (no migration path for existing saved positions).
--
-- Two indexes (idx_user_positions_user_status, idx_user_positions_user_created) drop
-- automatically with the table.

DROP TABLE IF EXISTS user_positions;

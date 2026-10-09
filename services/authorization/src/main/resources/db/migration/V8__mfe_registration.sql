-- Registration metadata for micro-frontends registered by network address (Operator Console wizard).
-- The executable artifact itself stays in the immutable artifact_revision rows; these columns only describe the module
-- and remember the address an operator registered, so a changed address is visible next to the active revision.

ALTER TABLE micro_app ADD COLUMN description varchar(1000);
ALTER TABLE micro_app ADD COLUMN icon varchar(80);
ALTER TABLE micro_app ADD COLUMN environment varchar(40);
ALTER TABLE micro_app ADD COLUMN entry_url varchar(2048);

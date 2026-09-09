-- Connect|API provider independence.
-- Compatibility rule for upgrades from 1.0.21:
-- do NOT rewrite legacy CONNECT instances and do NOT remove legacy settings.
-- Existing rows are intentionally preserved so an upgrade never forces a new
-- WhatsApp pairing or destroys data. New instances use the current providers.

SELECT 1;

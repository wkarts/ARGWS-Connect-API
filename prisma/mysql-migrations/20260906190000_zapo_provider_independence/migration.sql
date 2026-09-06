-- Connect|API provider independence: retire the legacy CONNECT bridge.
-- Existing CONNECT instances are moved to the native Zapo provider and forced
-- closed so the operator explicitly pairs the WhatsApp account with Zapo.
UPDATE `Instance`
SET `integration` = 'WHATSAPP-ZAPO', `connectionStatus` = 'close'
WHERE `integration` = 'CONNECT';

-- WavoIP is no longer part of Connect|API voice architecture.
SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'Setting'
    AND column_name = 'wavoipToken'
);

SET @sql := IF(
  @column_exists > 0,
  'ALTER TABLE `Setting` DROP COLUMN `wavoipToken`;',
  'SELECT "wavoipToken already absent";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

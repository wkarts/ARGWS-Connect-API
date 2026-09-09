-- Per-instance WhatsApp VoIP concurrency limit.
-- Additive and nullable for safe upgrades from 1.0.21.
SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'Setting'
    AND column_name = 'voipMaxConcurrentCalls'
);

SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `Setting` ADD COLUMN `voipMaxConcurrentCalls` INT NULL;',
  'SELECT "voipMaxConcurrentCalls already exists";'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

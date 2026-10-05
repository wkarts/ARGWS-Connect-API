SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'Webhook' AND column_name = 'additionalTargets'
);
SET @sql := IF(@column_exists = 0,
  'ALTER TABLE `Webhook` ADD COLUMN `additionalTargets` JSON NULL;',
  'SELECT "additionalTargets already exists";');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

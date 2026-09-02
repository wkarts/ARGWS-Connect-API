ALTER TABLE `MetaCompatibility` MODIFY `enabled` BOOLEAN NOT NULL DEFAULT true;
UPDATE `MetaCompatibility` SET `enabled` = true WHERE `enabled` = false;

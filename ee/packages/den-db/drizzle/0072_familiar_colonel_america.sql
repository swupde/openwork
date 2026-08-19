ALTER TABLE `connected_account` MODIFY COLUMN `connected_at` timestamp(3);--> statement-breakpoint
UPDATE `connected_account`
SET `connected_at` = NULL
WHERE `access_token` IS NULL;

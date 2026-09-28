CREATE TABLE `ManagerEmbeddingSetting` (
  `id` INTEGER NOT NULL,
  `configured` BOOLEAN NOT NULL DEFAULT false,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `allowedOrigins` JSON NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

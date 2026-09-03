import { installSensitiveConsoleGuard } from './console-redaction.config';

// This module must be imported before any provider/server module. Third-party
// dependencies such as Baileys/libsignal may write directly to console.* while
// their modules are being evaluated, before the application bootstrap runs.
installSensitiveConsoleGuard();

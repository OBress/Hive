# Changelog

## [0.1.0.0] - 2026-10-11

### Changed
- Save projects, task boards, transcripts, users, and history in Supabase alongside account approval.
- Keep local file storage for demos without Supabase configured; require a server secret key for hosted storage.
- Wait for pending persistence operations during shutdown and filter task-history reads in the database.

### Added
- Supabase schema setup with server-only application tables and approval profiles that preserve approval decisions on rerun.

### Removed
- MongoDB storage configuration and dependency.

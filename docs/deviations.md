# Current Deviations from `systemDesign.md`

The stored `samacsysFirefoxAuthorizationHeader` manual SamacSys sign-in override is still honored by backend auth resolution, but the settings page no longer exposes a field to create or edit it.

Resolve this by either removing backend/manual-override support or adding a deliberately advanced UI with clearer safety copy.

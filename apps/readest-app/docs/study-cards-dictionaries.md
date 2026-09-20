# Dictionaries for study cards

Readest uses the existing MDX importer and MDict provider. No dictionary files
are bundled with the application and the files in the repository root are
local/manual test assets; do not commit private dictionaries.

## Import and enable

1. Open Settings → Language → Dictionaries.
2. Choose **Import dictionary**, select an `.mdx` file, and wait for the import
   to finish.
3. Enable the imported dictionary in the dictionary list. Enable both imported
   dictionaries if you want Spanish definitions and English meanings in one
   study-card draft.

The supplied files are:

- `Diccionario de la Lengua Española V23.mdx` — Spanish–Spanish.
- `Collins Spanish-English Dictionary.mdx` — Spanish–English.

The first filename contains a decomposed accent in `Española`; use the actual
filesystem filename when selecting it. Readest keeps the imported dictionary
name as the source label shown in lookup results and study cards. Study-card
logic does not depend on filenames or provider IDs.

## Compatibility notes

MDX definitions are exported as portable text from the raw entry. Existing
MDX rendering remains responsible for images, audio, CSS, and other companion
resources. The supplied files currently have no listed `.mdd` or `.css`
companions, so definitions that depend on those resources may display without
their media or styling. Readest does not download replacements automatically.

The real supplied dictionaries are for local/manual compatibility checks only.
The automated test suite uses small synthetic MDX lookup results. The following
Android checks remain pending until a device or emulator with both dictionaries
is available: exact `comprar`, inflected `compré`, accented words, phrases,
redirects, long multisense entries, and comparison of rendered definitions with
portable text. If an inflected lookup misses, submit the lemma in the editable
dictionary query; this changes only the lookup query, not the captured reading
selection.

Unsupported/encrypted MDX files are reported by the existing provider as
unsupported. AnkiDroid is optional: copy remains available on web, desktop,
and devices without AnkiDroid.

The selected AnkiDroid deck/model IDs and field mapping are device-local and
versioned under `readest.studyCards.v1`; drafts, definitions, permission state,
and credentials are not persisted or synchronized. Android-device insertion
and real-dictionary compatibility remain pending until the stated manual
checks are run.

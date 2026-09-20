# Study cards from dictionary lookup: implementation plan

Status: ready for staged implementation; no implementation is included in this document.

## Goal and scope

While reading a Spanish EPUB, select a word or phrase, open Readest's dictionary,
review definitions, and create a cloze note containing the original sentence and
selected definitions. Review/edit before adding it directly to AnkiDroid. Copy
must also work on web, desktop, and devices without AnkiDroid.

Implement tasks in order. Finish and verify each task before beginning the next.
Do not interpret optional follow-ups as requirements for the first release. Do
not publish an issue, open a PR, install dictionaries, or modify AnkiDroid merely
because this plan mentions those activities. Follow the current repository agent
instructions and preserve unrelated changes.

First release includes:

- MDX results from Spanish–Spanish and Spanish–English dictionaries.
- Immutable EPUB selection/context capture with exact occurrence offsets.
- Manual query correction for Spanish forms, without changing the selected text.
- A review dialog, text-only portable definitions, copy, and confirmed AnkiDroid add.
- Device-local destination configuration and explicit send status.

Deferred: structured export for other dictionary formats, full Spanish morphological analysis, LLM assistance,
audio/images in notes, automatic sending, new toolbar buttons, other note types,
destination/plugin registries, companion apps, PDF context extraction, and
multi-section cloze generation. Do not change BookNote, CRDTs, reading position,
annotations, or synchronized book/settings schemas for this feature.

## Verified starting points (2026-09-19)

All Readest paths below are relative to `apps/readest-app/` unless stated otherwise.
Use symbols rather than old line numbers when locating code.

| File | Relevant behavior |
| --- | --- |
| `src/utils/sel.ts` | `TextSelection` contains a live range and optional cross-document `segments`. |
| `src/app/reader/components/annotator/Annotator.tsx` | `handleDictionary`, instant lookup, Word Lens lookup, and popup/sheet mounting. |
| `src/app/reader/components/annotator/DictionaryResultsView.tsx` | Shared results hook, query history, candidate fallback, aborts, provider outcomes. |
| `src/app/reader/components/annotator/DictionaryPopup.tsx` and `DictionarySheet.tsx` | Desktop/mobile wrappers around shared results. |
| `src/services/dictionaries/types.ts` | Provider lookup renders to a supplied container; success has no structured definitions. |
| `src/services/dictionaries/providers/mdictProvider.ts` | Raw headword/definition lookup, redirects, then resource resolution and rendering. |
| `src/services/dictionaries/lookupCandidates.ts` | Case variants then registered lemma candidates. |
| `src/services/dictionaries/lemmatize/index.ts` | Only English is registered. Spanish does not get a lemma fallback. |
| `src/services/dictionaries/dictionaryService.ts` | Existing MDX bundle import, including optional MDD and CSS companions. |
| `src/hooks/useFileSelector.ts` | Existing dictionary file selection includes MDX. |
| `src/utils/bridge.ts` | Existing TypeScript native bridge invocation conventions. |
| `src-tauri/plugins/tauri-plugin-native-bridge/` | Kotlin, Rust commands/models/mobile dispatch, permissions and registration. |

The user supplied these files under repository-root `dictionaries/`:

- `Diccionario de la Lengua Española V23.mdx`: Spanish–Spanish.
- `Collins Spanish-English Dictionary.mdx`: Spanish–English.

Both filenames were verified; their contents and Android lookup compatibility
have not yet been tested. Preserve the actual Unicode filename when opening the
Spanish–Spanish dictionary (its accent may be decomposed).
Ignore the old Oxford English–Spanish DSL/ANN files and all `:Zone.Identifier`
companions. They are outside scope; do not convert, import, modify, or delete them.
Do not add private dictionary assets to Git.

## Task 1: verify both supplied MDX dictionaries

Use Readest's existing MDX importer and provider. No dictionary converter, new
format parser, Python dependency, or StarDict provider change is required.

- [ ] Add `docs/study-cards-dictionaries.md` describing import and enabling both
  MDX dictionaries through the existing dictionary settings.
- [ ] Verify dictionary metadata and actual definitions for the language roles
  above. Keep those roles descriptive; do not hard-code provider IDs or filenames
  into study-card logic. Entries retain their actual dictionary source labels.
- [ ] Import and look up both dictionaries on Android. Record results for an exact
  headword (`comprar`), an inflected form (`compré`), an accented word, a multiword
  expression, a redirected entry where available, and a long multisense entry.
  If the inflected form misses, verify manual query correction to its lemma works.
  A dictionary lacking a phrase or inflection is not automatically a parser bug.
- [ ] Verify text remains readable without companion resources. No MDD/CSS files
  are currently listed with these assets; do not assume they exist or download
  replacements automatically. Report missing resources if they affect definitions.
- [ ] Compare visible definitions with portable text export after Task 4, including
  line breaks, sense numbering, examples, and grammar abbreviations. Preserve
  abbreviations as supplied; do not invent expansions or add a DSL abbreviation layer.
- [ ] Use small synthetic MDX lookup results for committed automated tests and
  the real dictionaries only for local/manual compatibility checks.
- [ ] Record any encrypted/unsupported file or device limitation explicitly.
  If Android verification is unavailable, mark it pending rather than passed.

## Task 2: establish data contracts and deterministic draft building

Create `src/services/studyCards/types.ts`, `draftBuilder.ts`, and
`src/__tests__/services/studyCards/draftBuilder.test.ts`.

Use the following contract shape. These are design contracts, not instructions to
copy unchecked code. Keep dictionary types in the dictionary module (Task 4).

```ts
type TextSpan = { start: number; end: number }; // UTF-16, end exclusive

type SelectionSnapshot = {
  id: string; // fresh capture identity; stale async results must not cross identities
  selectedText: string;
  language?: string;
  contextText: string;
  selectedSpan?: TextSpan; // offsets into contextText
  sentenceSpan?: TextSpan; // offsets into contextText, contains selectedSpan
  status: 'ready' | 'unsupported' | 'unmapped';
  reason?: string;
  source: {
    bookTitle?: string;
    chapterTitle?: string;
    bookHash?: string;
    sectionIndex?: number;
    cfi?: string;
    href?: string;
  };
};

type StudyCardDraft = {
  snapshotId: string;
  selectedText: string;
  contextText: string; // chosen sentence/paragraph, immutable for v1
  selectedSpan?: TextSpan; // rebased into this contextText
  definitions: Array<{
    entryId: string;
    providerId: string;
    sourceLabel: string;
    headword: string;
    text: string; // user-editable copy of entry text
    included: boolean;
  }>;
  gloss: string; // optional user-entered short meaning
  translation: string; // optional sentence translation, distinct from definition
  sourceText: string;
  tags: string[];
};
```

- [ ] Validate bounds and `contextText.slice(start, end) === selectedText`.
  Invalid/missing offsets disable cloze sending; never use the first `indexOf` hit.
- [ ] Prefer sentenceSpan when it contains the whole selection. Otherwise retain
  the enclosing paragraph/block. Rebase the selected offsets when slicing.
- [ ] Derive cloze text from prefix, exact selected slice, and suffix with one
  `{{c1::...}}`. Do not store a second independently mutable copy of the sentence.
- [ ] Copy output includes plain-text cloze, selected definitions with dictionary
  labels/headwords, gloss/translation if present, and source. Use clipboard
  conventions already present in Readest.
- [ ] Anki serialization escapes HTML in each plain-text component, converts line
  breaks deliberately, then inserts cloze delimiters. Treat literal Anki cloze
  delimiters in source/definitions as a validation case: reject an unsafe draft
  with an actionable message for v1 rather than accidentally generating extra cards.
- [ ] V1 permits editing definitions, gloss, translation, source text, and tags.
  Context is selectable for copying but not freely editable; use a sentence/paragraph
  toggle that recomputes spans. Arbitrary source edits and manual span repair are deferred.

Acceptance tests: second occurrence in a repeated-word sentence is the only cloze;
accented text survives unchanged; non-BMP characters before selection do not shift
UTF-16 offsets; HTML-looking book text is escaped; multiline fields preserve breaks;
bad bounds, unmatched selection and embedded cloze syntax cannot be sent.

## Task 3: capture context before dictionary UI opens

Create `src/services/studyCards/selectionContext.ts` and corresponding tests.
Modify `Annotator.tsx` only for capture and passing immutable data/callbacks.

- [ ] Implement a synchronous `captureSelectionSnapshot(selection, source)` boundary.
  Its result must JSON round-trip; no DOM nodes, ranges, or functions may escape.
- [ ] Support ordinary single-document EPUB selections first. Return an explicit
  unsupported snapshot for PDF, cross-document segments, and popup-footnote
  selections unless their context mapping is independently implemented and tested.
- [ ] Walk the smallest enclosing paragraph/block that contains both endpoints.
  Derive context and offsets in the SAME text walk; use DOM boundary comparisons
  to locate endpoints, including endpoints on element nodes. Preserve text node
  contents; account for `br` separators consistently. Exclude scripts/styles and
  annotation UI/ruby pronunciation nodes according to existing reader conventions.
- [ ] If filtering changes the selected slice so it no longer matches selectedText,
  return unmapped. Do not silently normalize accents, whitespace, or spelling.
- [ ] Bound capture size (for example 8,000 UTF-16 units). Reject an oversized
  block for v1 instead of truncating through the selection or freezing the reader.
- [ ] Segment the resulting string with `Intl.Segmenter(language, {granularity:
  'sentence'})` when available. Missing/invalid locale or a selection spanning
  multiple segments falls back to the paragraph. Never split solely on periods.
- [ ] Capture before native-handle suppression, deselection or popup mounting.
  Audit toolbar, instant quick action, and Word Lens paths. Assign a fresh snapshot
  when a new reader selection opens lookup, not when navigating dictionary links.
- [ ] Keep the snapshot when transferring from dictionary to study dialog. Update
  Annotator's overlay/selection suppression logic to recognize the new dialog.
  Closing either surface must not retrigger instant lookup.

Acceptance tests: inline `em`/`span` selection, element boundaries, repeated words,
paragraph fallback, accents, ruby exclusion, missing Segmenter, stale selection
replacement, and unsupported multi-section/PDF selection. At least one integration
test must prove snapshot capture precedes instant-lookup deselection.

## Task 4: export structured MDX entries

Modify dictionary `types.ts`, `providers/mdictProvider.ts`, and the shared results hook.
Create `src/services/dictionaries/entryText.ts` and tests.

```ts
// Lives in services/dictionaries/types.ts, not studyCards/types.ts.
type DictionaryEntry = {
  id: string; // unique within provider/result; stable for that lookup result
  providerId: string;
  sourceLabel: string;
  lookupQuery: string; // candidate actually passed to the provider
  headword: string; // final headword after redirect resolution
  definitionText: string;
};

// Extend only the existing successful DictionaryLookupOutcome branch:
// { ok: true; headword?: string; sourceLabel?: string;
//   entries?: DictionaryEntry[] }
```

- [ ] MDX: build structured text from the final raw definition after redirect
  resolution and before MDD/blob/CSS rewriting. Preserve existing render behavior.
  Cyclic/exhausted redirects must not export a literal `@@@LINK=` as a definition.
- [ ] Implement entryText with inert parsing and explicit traversal, not popup DOM
  scraping or mounting dictionary HTML. Remove script/style/resource content,
  preserve block/list/line boundaries, decode entities, and omit handlers/URLs.
  Do not fetch external resources. Reuse an existing sanitizer if appropriate.
- [ ] Keep entries in provider outcome state keyed to the current lookup generation.
  Collect only loaded outcomes whose loadKey matches the active query/language.
  Cancellation/generation checks must prevent late results from a previous lookup.
- [ ] Other providers remain compatible; absence of entries means no definition
  export, not failure of the dictionary or inability to draft a context-only card.
- [ ] Add an editable query to the shared dictionary header using existing history
  semantics. Original snapshot stays unchanged when the user changes `compré` to
  `comprar` or follows a headword link. Display original selection in the study UI.
- [ ] Show selected definitions with provider label and resolved headword; let the
  user exclude unrelated entries after dictionary navigation. Do not infer an
  entry's language from the book language or promise both Spanish and English.

Acceptance tests: redirect, plain-text MDX definition, entries from two MDX providers,
malicious HTML, block spacing, legacy provider, candidate fallback, query edit,
and out-of-order async responses. Existing dictionary tests must continue passing.

## Task 5: deliver review and copy without Android dependency

Create `src/app/reader/components/studyCards/StudyCardDialog.tsx`; extract a separate
preview component only if it improves clarity. Add shared “Create study card” UI
through DictionaryResultsView and wire both DictionaryPopup and DictionarySheet.

- [ ] Follow `DESIGN.md`, `docs/i18n.md`, and `docs/safe-area-insets.md` before UI work.
- [ ] Show original selected text, sentence/paragraph cloze preview, each definition
  with checkbox/editable text and provenance, optional gloss/translation, source,
  tags, Copy, and destination state. Use an explicit “Create study card” action.
- [ ] Allow including both the Spanish definition and English dictionary meaning
  in one draft, independently editable and labeled by dictionary. Do not require
  both dictionaries to return results. Keep English dictionary meaning separate
  from the optional translation of the whole source sentence.
- [ ] Enable context-only cards when no provider exports entries; explain that no
  definition was included. Do not scrape unsupported provider contents.
- [ ] Unsupported/unmapped context permits copying selected text and definitions,
  but displays the reason and disables Anki add.
- [ ] Transfer focus into the dialog, retain selection snapshot, handle Escape/back,
  restore focus on close, and prevent two overlapping modal surfaces. Use existing
  modal primitives and mobile keyboard/safe-area conventions.
- [ ] Ensure e-ink borders/contrast, narrow viewport layout, and scrollable long
  definitions. Keep all strings in the existing localization workflow.

Acceptance: copy creates the expected draft on web; desktop popup and Android
sheet both expose the action; closing does not reopen dictionary automatically;
definitions remain editable without changing original context.

## Task 6: implement and prove the AnkiDroid bridge

Use `/home/timdumol/devel/Anki-Android` for read-only API reference. Do not modify it
or add it as a build dependency. Choose and pin a published API artifact after
verifying its contract; local main may differ from the published library.

Files under `src-tauri/plugins/tauri-plugin-native-bridge/`:

- New `android/src/main/java/AnkiDroidAdapter.kt` (match existing package conventions).
- Thin delegation in `android/src/main/java/NativeBridgePlugin.kt`.
- API dependency in `android/build.gradle.kts`; package queries and permission in
  `android/src/main/AndroidManifest.xml` where supported by the plugin manifest merge.
- Rust models/commands/mobile dispatch/registration in `src/{models,commands,mobile,lib}.rs`.
- `build.rs`, plugin permissions, and app capability files if command exposure requires them.
- Non-Android dispatch returns unsupported; do not invoke missing iOS methods.
- TypeScript wrapper `src/utils/ankiDroidBridge.ts` beside `bridge.ts`.

Expose only these semantic operations (adapt spelling to bridge conventions):

| Operation | Result |
| --- | --- |
| `anki_get_status` | supported, installed, API available, permission state |
| `anki_request_permission` | permission result; only after user action |
| `anki_list_decks` | IDs as strings and names; exclude unusable decks |
| `anki_list_models` | IDs as strings, names, model type, ordered field names, cloze template fields |
| `anki_check_duplicate` | whether current first-field/model key already exists |
| `anki_add_note` | success note ID, definite error, or uncertain result |

- [ ] Use AddContentApi for add/deck/field operations where available. Query public
  FlashCardsContract for model TYPE and templates as necessary. TYPE=1 identifies
  cloze; a name containing “Cloze” is not validation. Confirm the mapped context
  field is referenced with a cloze filter; reject unsupported template structures
  clearly instead of pretending to understand arbitrary template syntax.
- [ ] Handle `com.ichi2.anki.permission.READ_WRITE_DATABASE`, Android package
  visibility, permission denial/revocation, absent/disabled API, and unavailable
  collection. Reuse the plugin's activity permission/callback conventions.
- [ ] Run blocking content-resolver calls off the UI thread. Do not request
  permission as a side effect of capability detection or dialog mounting.
- [ ] Never convert Kotlin Long IDs to JS numbers. Pass decimal strings over the
  bridge and validate/convert to Long inside Kotlin.
- [ ] For v1 target the standard AnkiDroid package. Report unsupported variants
  explicitly if the pinned API cannot resolve them; do not hard-code a working
  provider authority for a different package by guessing.
- [ ] Validate deck/model existence, cloze type, ordered field count and mapping
  immediately before insertion. Construct fields by current model order.
- [ ] Smoke-test one hard-coded cloze note on a device/emulator before coupling the
  bridge to the full dialog. Confirm the selected deck and actual review rendering.

Reference: [official AnkiDroid API documentation](https://github.com/ankidroid/Anki-Android/wiki/AnkiDroid-API).
Local reference files: `api/src/main/java/com/ichi2/anki/api/AddContentApi.kt` and
`api/src/main/java/com/ichi2/anki/FlashCardsContract.kt` in the AnkiDroid checkout.

## Task 7: configuration, serialization and send lifecycle

Create `src/services/studyCards/ankiDroidDestination.ts`,
`src/services/studyCards/localSettings.ts`, and focused tests.

- [ ] Add model/deck selection and named field mapping to the dialog. Require one
  context/cloze field. Let users map combined extra and source into other existing
  fields; combine source into extra by default for a standard two-field model.
  Do not create models/decks automatically or hard-code English field names.
- [ ] Persist versioned device-local settings under a dedicated key such as
  `readest.studyCards.v1`, using existing safe persistence helpers where suitable.
  Store IDs as strings, display names, and mapping by field name. Revalidate IDs
  and fields on use. Missing/deleted entities require reselection, not arbitrary
  substitution; names are recovery suggestions rather than sufficient identity.
- [ ] Audit backup/export/sync code for generic storage enumeration. Explicitly
  exclude this key where necessary. Do not persist permission state, drafts,
  definitions, or API credentials in this key. No `autoSend` option in v1.
- [ ] Show text previews of mapped fields. Serialize only at the destination
  boundary; a standard two-field model gets cloze context plus combined extra.
- [ ] Use a send state machine: editing -> checking -> duplicate confirmation or
  sending -> success / definite failure / uncertain. Disable concurrent sends
  and edits during check/send. A duplicate confirmation applies only to the exact
  checked fields/model; editing invalidates it.
- [ ] Check duplicates using the API's actual first-field/model semantics; do not
  present it as a global semantic duplicate detector. Allow an explicit add-anyway.
- [ ] On success show “Added to AnkiDroid” and retain the returned note ID in memory.
  Do not automatically send again. On failure retain the draft and show a useful error.
- [ ] On uncertain insertion, say “The note may have been added. Check AnkiDroid
  before retrying.” Do not retry automatically or claim rollback. The current
  AddContentApi inserts before card lookup/deck updates; errors after insertion
  can leave a note behind. Duplicate checks reduce risk but are not transactions.
- [ ] If the activity/bridge loses its response after dispatch, treat the result
  as uncertain. Ephemeral drafts need not survive app termination in v1.
- [ ] Copy remains available after permission denial or other destination failure.

## Task 8: verification and handoff

Commands run from `apps/readest-app/`. Read `docs/testing.md` for current harnesses.

- [ ] Run focused Vitest tests for new studyCards helpers and dictionary changes.
  Example: `pnpm test -- src/__tests__/services/studyCards/draftBuilder.test.ts`.
- [ ] Run existing DictionarySheet and Annotator lookup-surface regression tests.
- [ ] Run `pnpm lint`, `pnpm format:check`, and relevant Rust formatting/checks when
  native files change. Use repository Android build instructions to compile the
  native plugin; record the exact successful command and build variant.
- [ ] Native tests cover field order, Long ID round-trip, permission failure,
  invalid model/deck, duplicate path, and post-insertion uncertain result.
- [ ] Manual end-to-end: Spanish EPUB -> select second repeated occurrence ->
  dictionary -> correct query to lemma -> choose/edit Spanish–Spanish and
  Spanish–English MDX definitions -> preview -> add -> review correct cloze and
  both included definitions in chosen AnkiDroid deck. Repeat with one provider
  returning no entry; the other definition must still be usable.
- [ ] Also test no AnkiDroid, denied permission, API disabled, renamed/deleted
  deck/model, existing duplicate, double tap, app backgrounding during send,
  very long entry, mobile keyboard, and e-ink appearance.
- [ ] Confirm dictionary-only behavior remains unchanged and no study config is
  in sync/backup output. Document unverified device/file checks explicitly.
- [ ] Update `docs/study-cards-dictionaries.md` with user-facing setup and limitations.

Completion requires both a working copy workflow and a demonstrated Android add.
Unit tests alone do not establish native integration or real dictionary compatibility.
If a device or user dictionary is unavailable, finish independent implementation
and report exactly which acceptance checks remain pending.

## Optional follow-up: contextual AI suggestions

Do not implement until the deterministic workflow above passes acceptance.

Reuse `src/services/ai/` providers directly; do not depend on Reedy indexing.
Add `aiEnhancer.ts` with a separately triggered “Suggest meaning” action. Send only
the captured sentence/paragraph, selected form, and user-included definitions.
Make the configured provider/destination visible before sending book text.

Return validated `{ gloss?: string, translation?: string, grammarNote?: string }`
with length limits, cancellation and a timeout. Treat book/dictionary text as
untrusted data, give the request no tools, and ignore unknown response fields.
Do not accept rewritten source text or new cloze positions. Show suggestions for
explicit application; never replace edits automatically. Tie responses to a draft
revision; discard responses after changes/close. Failure leaves the deterministic
draft untouched. Mobile endpoint access must be verified independently of desktop
provider success. No specific model choice or quality guarantee is assumed.

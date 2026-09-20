# Readest language notes

Study-card creation defaults to **Recognition**: a compact card-type badge above the source
sentence with the selected text highlighted, followed by its contextual meaning on the answer side. Without AI,
enter a meaning or include a dictionary definition.

**Generate study content** makes one LLM request for the contextual meaning,
translation, learning target/base expression, grammatical form, explanations, and
the vocabulary production exercise. Recognition remains selected by default; the two
card types can be previewed and edited. Selecting or deselecting cards never regenerates content.

The existing dictionary pre-generation setting uses the same enriched response and
cache as automatic generation in the dialog. Manual generation deliberately requests
a fresh response. Changing sentence/paragraph context resets the exercises and selection.
Legacy setting keys keep their names for compatibility; required enrichment instructions
are appended to the configurable prompt.

## AnkiDroid setup

1. Grant AnkiDroid API permission.
2. Choose **Set up Readest note type** and a deck, then save the destination.
3. Select the cards to create and add the note.

Setup creates **Readest Language v1**, a standard (not native cloze) note type with
two card templates. Repeating setup reuses the named model and never overwrites its
fields, styling, or customized templates. Incompatible fields/templates produce an
error rather than overwriting an existing model. Existing legacy cloze notes remain
unchanged; their saved destination must be replaced with a Readest note type for this flow.

To apply Readest's current built-in templates after an existing type has been created,
click **Create updated Readest note type**. This creates the next available version
(`Readest Language v2`, then `v3`, and so on), selects it, and leaves the previous type
and its notes intact. Save the destination after the new version is selected. The older
type can remain in AnkiDroid for reviewing existing notes.

## Fields and customization

Shared fields: `LookupId`, `SchemaVersion`, `Sentence`, `SelectedText`, `SentenceBefore`,
`SentenceAfter`, `LearningTarget`, `Lemma`, `GrammaticalForm`, `Meaning`, `Explanation`,
`Translation`, `UsageNote`, `Definitions`, `SourceText`, `Book`, `Chapter`, `SourceReference`.

`Explanation` is an optional source-language explanation. Meanings, usage notes, and
exercise instructions use the translation target language (English by default).
`LearningTarget` may expand the selection to a source expression, while `SelectedText`
and the source sentence remain unchanged.

Recognition uses `EnableRecognition`. Vocabulary production uses the `Vocabulary` prefix
and fields:

- `Enable<Prefix>`
- `<Prefix>Prompt`, `<Prefix>Answer`, `<Prefix>Hint`
- `<Prefix>Alternatives`, `<Prefix>Explanation`

The vocabulary production content is exported even when its card is unchecked. Only chosen
enable fields contain `1`; the others are empty. The entire front template must remain
inside its `{{#Enable…}} … {{/Enable…}}` condition to suppress unchecked cards. Preserve
the two card template positions and field names when customizing. Other fields may
be reordered, except `LookupId`, which must stay first for duplicate detection.

The template fronts use a blue Recognition badge and a green Production badge so the card type
is identifiable immediately. Recognition uses the highlighted context as its cue without a
verbose question line. Production uses a compact prompt/answer layout with labeled sections.
Edit the templates/CSS in AnkiDroid to change presentation across existing notes without
an LLM call. Set `EnableVocabulary` to `1` in Anki to activate stored production content
later. Clearing an enable field does not delete an existing scheduled card;
use Anki's empty-card management if removing an already-created card.

Content is HTML-escaped before export. The templates own the layout; model output cannot
inject HTML. Answers, dictionary definitions, translations, and source context appear
only on the back. Hints on exercise fronts are revealable.

`LookupId` is a stable hash of the source identity, context, and selected position;
`SchemaVersion` is `1`. Repeated lookups can therefore detect an existing note even after
regeneration. Adding currently offers a duplicate warning, not automatic updates to
existing notes. Future content/schema migrations must be explicit.

The template definitions and field serialization live in
`src/services/studyCards/studyNote.ts`; structured generation and validation live in
`aiCloze.ts` and `learningContent.ts`.

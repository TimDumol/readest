'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdContentCopy, MdRefresh, MdSend } from 'react-icons/md';
import { PiArrowsClockwise, PiSpinner } from 'react-icons/pi';

import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_STUDY_CARD_CLOZE_BUDGET_USD,
  DEFAULT_STUDY_CARD_CLOZE_CONTEXT_CHARS,
  DEFAULT_STUDY_CARD_CLOZE_PROMPT,
} from '@/services/ai/constants';
import {
  fetchOpenRouterModels,
  filterOpenRouterModels,
  formatOpenRouterModelPrice,
  supportsOpenRouterStructuredOutputs,
  type OpenRouterModelInfo,
} from '@/services/ai/providers/OpenRouterProvider';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import { buildStudyCardDraft, validateDraftForAnki } from '@/services/studyCards/draftBuilder';
import {
  buildStudyCardPrompt,
  buildStudyCardAdditionalContext,
  checkOpenRouterConnection as checkOpenRouterConnectionRequest,
  estimateStudyCardCost,
  generateStudyCardCloze,
  generateStudyCardClozeCached,
  type StudyCardAIUsage,
} from '@/services/studyCards/aiCloze';
import {
  buildStudyNoteFields,
  buildStudyNoteCopy,
  getNextStudyNoteName,
  isReadestStudyNoteName,
  validateStudyNote,
  validateStudyNoteModel,
  STUDY_NOTE_NAME,
  STUDY_NOTE_FIELDS,
  STUDY_NOTE_TEMPLATES,
  STUDY_NOTE_CSS,
} from '@/services/studyCards/studyNote';
import StudyCardChoices from './StudyCardChoices';
import { LEARNING_INSTRUCTIONS } from '@/services/studyCards/learningContent';
import {
  clearStudyCardSettings,
  loadStudyCardSettings,
  saveStudyCardSettings,
} from '@/services/studyCards/localSettings';
import {
  addAnkiDroidNote,
  checkAnkiDroidDuplicate,
  getAnkiDroidStatus,
  listAnkiDroidDecks,
  listAnkiDroidModels,
  requestAnkiDroidPermission,
  ensureAnkiDroidStudyModel,
} from '@/utils/ankiDroidBridge';
import type { AnkiDroidDeck, AnkiDroidModel, AnkiDroidStatus } from '@/utils/ankiDroidBridge';
import type {
  AnkiDroidDestination,
  AnkiDroidFieldMapping,
} from '@/services/studyCards/ankiDroidDestination';
import type { SelectionSnapshot, StudyCardDefinition } from '@/services/studyCards/types';

interface StudyCardDialogProps {
  snapshot: SelectionSnapshot;
  entries: StudyCardDefinition[];
  onClose: () => void;
}

type SendRequest = {
  modelId: string;
  deckId: string;
  fields: string[];
  tags: string[];
  snapshotId: string;
};

type SendState =
  | { phase: 'editing' }
  | { phase: 'checking' }
  | { phase: 'duplicate'; request: SendRequest }
  | { phase: 'sending'; request: SendRequest }
  | { phase: 'success'; noteId?: string }
  | { phase: 'failure'; kind: 'definite_failure' | 'uncertain'; message: string };

type AIClozeState =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | { phase: 'success' }
  | { phase: 'failure'; message: string };

type AIConnectionState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'success'; message: string }
  | { phase: 'failure'; message: string };

const formatApproximateCost = (cost: number | null): string => {
  if (cost === null) return 'price unavailable';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(4)}`;
};

const formatExactCost = (cost: number | null): string => {
  if (cost === null) return 'unavailable';
  return `$${cost
    .toFixed(8)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')}`;
};

const formatUsage = (usage: StudyCardAIUsage): string => {
  const label = usage.costSource === 'provider' ? 'Actual request cost' : 'Calculated request cost';
  const tokens = [
    usage.promptTokens === null ? null : `${usage.promptTokens} input tokens`,
    usage.completionTokens === null ? null : `${usage.completionTokens} output tokens`,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${label}: ${formatExactCost(usage.cost)}${tokens ? ` (${tokens})` : ''}`;
};

const formatGenerationDuration = (durationMs: number): string =>
  durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(2)} s`;

const StudyCardDialog: React.FC<StudyCardDialogProps> = ({ snapshot, entries, onClose }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const aiSettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;
  const settingsRef = useRef(settings);
  const autoGenerateAttemptedRef = useRef(false);
  const [contextMode, setContextMode] = useState<'sentence' | 'paragraph'>('sentence');
  const [draft, setDraft] = useState(() => buildStudyCardDraft(snapshot, entries));
  const [openrouterKey, setOpenrouterKey] = useState(aiSettings.openrouterApiKey ?? '');
  const [openrouterModel, setOpenrouterModel] = useState(aiSettings.openrouterModel ?? '');
  const [openrouterModelSearch, setOpenrouterModelSearch] = useState('');
  const [openrouterModels, setOpenrouterModels] = useState<OpenRouterModelInfo[]>([]);
  const [openrouterFetchingModels, setOpenrouterFetchingModels] = useState(false);
  const [openrouterModelsError, setOpenrouterModelsError] = useState('');
  const [aiClozeState, setAIClozeState] = useState<AIClozeState>({ phase: 'idle' });
  const [aiUsage, setAIUsage] = useState<StudyCardAIUsage | null>(null);
  const [aiGenerationDurationMs, setAIGenerationDurationMs] = useState<number | null>(null);
  const [aiConnectionState, setAIConnectionState] = useState<AIConnectionState>({ phase: 'idle' });
  const [status, setStatus] = useState<AnkiDroidStatus | null>(null);
  const [decks, setDecks] = useState<AnkiDroidDeck[]>([]);
  const [models, setModels] = useState<AnkiDroidModel[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [mapping, setMapping] = useState<AnkiDroidFieldMapping>({ contextField: '' });
  const [destination, setDestination] = useState<AnkiDroidDestination | null>(
    () => loadStudyCardSettings().destination ?? null,
  );
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const [sendState, setSendState] = useState<SendState>({ phase: 'editing' });
  const validation = validateDraftForAnki(draft);
  const noteError = validateStudyNote(draft);

  const studyModels = useMemo(
    () => models.filter((model) => !validateStudyNoteModel(model)),
    [models],
  );
  const selectedModel = studyModels.find((model) => model.id === selectedModelId);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId);
  const mappingError = selectedModel ? validateStudyNoteModel(selectedModel) : null;
  const destinationReady =
    status?.permission === 'granted' &&
    !!destination &&
    !!selectedModel &&
    destination.modelId === selectedModel.id &&
    destination.deckId === selectedDeckId;
  const mappedFields = useMemo(() => {
    if (!selectedModel || noteError) return null;
    const fields = buildStudyNoteFields(draft, snapshot);
    return selectedModel.fieldNames.map((field) => fields[field] ?? '');
  }, [draft, noteError, selectedModel, snapshot]);
  const editingLocked =
    sendState.phase === 'checking' ||
    sendState.phase === 'sending' ||
    aiClozeState.phase === 'generating' ||
    aiConnectionState.phase === 'checking';

  const selectedAIModel = openrouterModels.find((model) => model.id === openrouterModel);
  const visibleOpenrouterModels = useMemo(
    () => filterOpenRouterModels(openrouterModels, openrouterModelSearch, openrouterModel),
    [openrouterModel, openrouterModelSearch, openrouterModels],
  );
  const targetLanguage = settings?.globalViewSettings?.translateTargetLang || 'EN';
  const additionalContext = useMemo(
    () =>
      contextMode === 'sentence'
        ? buildStudyCardAdditionalContext({
            contextText: snapshot.contextText,
            sentenceSpan: snapshot.sentenceSpan,
            beforeChars:
              aiSettings.studyCardClozeContextBeforeChars ?? DEFAULT_STUDY_CARD_CLOZE_CONTEXT_CHARS,
            afterChars:
              aiSettings.studyCardClozeContextAfterChars ?? DEFAULT_STUDY_CARD_CLOZE_CONTEXT_CHARS,
          })
        : { before: '', after: '' },
    [
      aiSettings.studyCardClozeContextAfterChars,
      aiSettings.studyCardClozeContextBeforeChars,
      contextMode,
      snapshot.contextText,
      snapshot.sentenceSpan,
    ],
  );
  const aiPrompt = useMemo(
    () =>
      buildStudyCardPrompt({
        contextText: draft.contextText,
        selectedText: draft.selectedText,
        sourceText: draft.sourceText,
        targetLanguage,
        additionalContextBefore: additionalContext.before,
        additionalContextAfter: additionalContext.after,
        definitions: draft.definitions
          .filter((definition) => definition.included)
          .map((definition) => ({
            sourceLabel: definition.sourceLabel,
            headword: definition.headword,
            text: definition.text,
          })),
      }),
    [
      additionalContext.after,
      additionalContext.before,
      draft.contextText,
      draft.definitions,
      draft.selectedText,
      draft.sourceText,
      targetLanguage,
    ],
  );
  const estimatedAICost = useMemo(
    () =>
      estimateStudyCardCost(
        `${aiSettings.studyCardClozePrompt || DEFAULT_STUDY_CARD_CLOZE_PROMPT}\n${LEARNING_INSTRUCTIONS}\n${aiPrompt}`,
        selectedAIModel?.pricing,
        1800,
      ),
    [aiPrompt, aiSettings.studyCardClozePrompt, selectedAIModel?.pricing],
  );

  const updateDraft = useCallback(
    (updater: (current: typeof draft) => typeof draft) => {
      if (editingLocked) return;
      setDraft(updater);
      setSendState({ phase: 'editing' });
    },
    [editingLocked],
  );

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const persistOpenRouterSettings = useCallback(
    async (patch: { openrouterApiKey?: string; openrouterModel?: string }) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const nextSettings = {
        ...currentSettings,
        aiSettings: {
          ...DEFAULT_AI_SETTINGS,
          ...currentSettings.aiSettings,
          ...patch,
        },
      };
      setSettings(nextSettings);
      await saveSettings(envConfig, nextSettings);
    },
    [envConfig, saveSettings, setSettings],
  );

  const refreshOpenrouterModels = useCallback(async () => {
    if (!openrouterKey.trim()) {
      setOpenrouterModels([]);
      setOpenrouterModelsError('');
      return;
    }
    setOpenrouterFetchingModels(true);
    setOpenrouterModelsError('');
    try {
      const models = await fetchOpenRouterModels(
        aiSettings.openrouterBaseUrl || DEFAULT_AI_SETTINGS.openrouterBaseUrl!,
        openrouterKey,
      );
      models.sort((a, b) => a.id.localeCompare(b.id));
      const structuredModels = models.filter(supportsOpenRouterStructuredOutputs);
      setOpenrouterModels(structuredModels);
      setOpenrouterModelsError(
        models.length > 0 && structuredModels.length === 0
          ? _('No OpenRouter models supporting structured JSON outputs were found.')
          : '',
      );
      setOpenrouterModel((current) => {
        if (current && structuredModels.some((model) => model.id === current)) return current;
        const nextModel = structuredModels[0]?.id ?? '';
        if (nextModel !== current) void persistOpenRouterSettings({ openrouterModel: nextModel });
        return nextModel;
      });
    } catch (error) {
      setOpenrouterModels([]);
      setOpenrouterModelsError(
        error instanceof Error ? error.message : _('Failed to fetch models'),
      );
    } finally {
      setOpenrouterFetchingModels(false);
    }
  }, [_, aiSettings.openrouterBaseUrl, openrouterKey, persistOpenRouterSettings]);

  const checkAIConnection = async () => {
    if (editingLocked) return;
    setAIConnectionState({ phase: 'checking' });
    try {
      await persistOpenRouterSettings({
        openrouterApiKey: openrouterKey,
        openrouterModel,
      });
      const result = await checkOpenRouterConnectionRequest({
        apiKey: openrouterKey,
        model: openrouterModel,
        baseUrl: aiSettings.openrouterBaseUrl,
      });
      await refreshOpenrouterModels();
      setAIConnectionState({
        phase: 'success',
        message:
          openrouterModel.trim() && !result.selectedModelSupportsStructuredOutputs
            ? `Connected to OpenRouter (${result.structuredModelCount} of ${result.modelCount} models support structured JSON), but the selected model cannot be used for study cards.`
            : `Connected to OpenRouter (${result.structuredModelCount} of ${result.modelCount} models support structured JSON).`,
      });
    } catch (error) {
      setAIConnectionState({
        phase: 'failure',
        message: error instanceof Error ? error.message : _('OpenRouter connection failed.'),
      });
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshOpenrouterModels(), 250);
    return () => window.clearTimeout(timer);
  }, [refreshOpenrouterModels]);

  const generateAICloze = async (useCache = false) => {
    if (!validation.ok || editingLocked) return;
    if (!selectedAIModel) {
      setAIClozeState({
        phase: 'failure',
        message: _('Choose a model that supports structured JSON output first.'),
      });
      return;
    }
    setAIClozeState({ phase: 'generating' });
    setAIUsage(null);
    setAIGenerationDurationMs(null);
    try {
      await persistOpenRouterSettings({
        openrouterApiKey: openrouterKey,
        openrouterModel,
      });
      const generationOptions = {
        enriched: true,
        apiKey: openrouterKey,
        model: openrouterModel,
        baseUrl: aiSettings.openrouterBaseUrl,
        contextText: draft.contextText,
        selectedText: draft.selectedText,
        prompt: aiSettings.studyCardClozePrompt || DEFAULT_STUDY_CARD_CLOZE_PROMPT,
        additionalContextBefore: additionalContext.before,
        additionalContextAfter: additionalContext.after,
        reasoningEffort:
          selectedAIModel.supported_parameters?.includes('reasoning_effort') ||
          selectedAIModel.supported_parameters?.includes('reasoning')
            ? ('low' as const)
            : undefined,
        budgetUsd: aiSettings.studyCardClozeBudgetUsd ?? DEFAULT_STUDY_CARD_CLOZE_BUDGET_USD,
        provider: aiSettings.studyCardClozeProvider,
        sourceText: draft.sourceText,
        targetLanguage,
        pricing: selectedAIModel.pricing,
        definitions: draft.definitions
          .filter((definition) => definition.included)
          .map((definition) => ({
            sourceLabel: definition.sourceLabel,
            headword: definition.headword,
            text: definition.text,
          })),
      };
      const generated = await (useCache
        ? generateStudyCardClozeCached(generationOptions)
        : generateStudyCardCloze(generationOptions));
      setDraft((current) => ({
        ...current,
        clozeText: generated.clozeText,
        gloss: generated.gloss,
        translation: generated.translation,
        sourceText: generated.sourceText,
        tags: generated.tags,
        learning: generated.learning,
        cardTypes: current.cardTypes.filter(
          (kind) => kind === 'recognition' || generated.learning?.exercises[kind].applicable,
        ),
      }));
      setAIUsage(generated.usage);
      setAIGenerationDurationMs(generated.generationDurationMs);
      setAIClozeState({ phase: 'success' });
    } catch (error) {
      setAIClozeState({
        phase: 'failure',
        message: error instanceof Error ? error.message : _('Failed to generate study content.'),
      });
    }
  };

  useEffect(() => {
    if (
      !aiSettings.studyCardAutoGenerateOnOpen ||
      autoGenerateAttemptedRef.current ||
      !selectedAIModel ||
      !openrouterKey.trim() ||
      !openrouterModel.trim() ||
      !validation.ok ||
      editingLocked
    ) {
      return;
    }
    autoGenerateAttemptedRef.current = true;
    void generateAICloze(true);
    // This effect is intentionally one-shot per dialog. The ref prevents
    // model/settings updates after the first eligible render from re-running it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    aiSettings.studyCardAutoGenerateOnOpen,
    editingLocked,
    openrouterKey,
    openrouterModel,
    selectedAIModel,
    validation.ok,
  ]);

  const refreshDestination = useCallback(async () => {
    setSetupBusy(true);
    setSetupMessage('');
    try {
      const nextStatus = await getAnkiDroidStatus();
      setStatus(nextStatus);
      if (nextStatus.permission !== 'granted') {
        setDecks([]);
        setModels([]);
        return;
      }
      const [nextDecks, nextModels] = await Promise.all([
        listAnkiDroidDecks(),
        listAnkiDroidModels(),
      ]);
      setDecks(nextDecks);
      setModels(nextModels);
      const saved = loadStudyCardSettings().destination;
      const savedDeck = saved && nextDecks.some((deck) => deck.id === saved.deckId);
      const savedModel =
        saved &&
        nextModels.some((model) => model.id === saved.modelId && !validateStudyNoteModel(model));
      if (saved && savedDeck && savedModel) {
        setDestination(saved);
        setSelectedDeckId(saved.deckId);
        setSelectedModelId(saved.modelId);
        setMapping(saved.mapping);
      } else {
        if (saved) clearStudyCardSettings();
        setDestination(null);
        setSelectedDeckId(nextDecks[0]?.id ?? '');
        const firstCloze = nextModels.find((model) => !validateStudyNoteModel(model));
        setSelectedModelId(firstCloze?.id ?? '');
        setMapping({ contextField: 'Sentence' });
        if (saved)
          setSetupMessage(
            _('The saved AnkiDroid deck or model is no longer available. Please select it again.'),
          );
      }
    } catch (error) {
      setStatus({
        supported: false,
        installed: false,
        apiAvailable: false,
        permission: 'unavailable',
      });
      setSetupMessage(error instanceof Error ? error.message : _('AnkiDroid is not available.'));
    } finally {
      setSetupBusy(false);
    }
  }, [_]);

  useEffect(() => {
    void refreshDestination();
  }, [refreshDestination]);

  useEffect(() => {
    if (!selectedModel) return;
    if (destination?.modelId === selectedModel.id) return;
    setMapping({ contextField: 'Sentence' });
  }, [destination?.modelId, selectedModel]);

  const requestPermission = async () => {
    setSetupBusy(true);
    try {
      await requestAnkiDroidPermission();
      await refreshDestination();
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : _('Permission request failed.'));
    } finally {
      setSetupBusy(false);
    }
  };

  const saveDestination = () => {
    if (!selectedDeck || !selectedModel) {
      setSetupMessage(_('Choose an AnkiDroid deck and Readest note type first.'));
      return;
    }
    const error = validateStudyNoteModel(selectedModel);
    if (error) {
      setSetupMessage(error);
      return;
    }
    const nextDestination: AnkiDroidDestination = {
      deckId: selectedDeck.id,
      deckName: selectedDeck.name,
      modelId: selectedModel.id,
      modelName: selectedModel.name,
      mapping: { ...mapping },
    };
    saveStudyCardSettings({ version: 1, destination: nextDestination });
    setDestination(nextDestination);
    setSetupMessage(_('AnkiDroid destination saved.'));
  };

  const createStudyModel = async (name = STUDY_NOTE_NAME, recreated = false) => {
    setSetupBusy(true);
    setSetupMessage('');
    try {
      const modelId = await ensureAnkiDroidStudyModel({
        name,
        fieldNames: STUDY_NOTE_FIELDS,
        templates: STUDY_NOTE_TEMPLATES,
        css: STUDY_NOTE_CSS,
      });
      const nextModels = await listAnkiDroidModels();
      setModels(nextModels);
      const model = nextModels.find((candidate) => candidate.id === modelId);
      if (!model)
        throw new Error(_('The new note type was not found. Refresh AnkiDroid destinations.'));
      const error = validateStudyNoteModel(model);
      if (error) throw new Error(error);
      setSelectedModelId(modelId);
      setMapping({ contextField: 'Sentence' });
      setDestination(null);
      setSetupMessage(
        recreated
          ? _(
              'Created an updated Readest note type. Existing notes were preserved. Save your destination.',
            )
          : _('Readest note type ready. Save your destination.'),
      );
    } catch (error) {
      setSetupMessage(
        error instanceof Error ? error.message : _('Could not create the Readest note type.'),
      );
    } finally {
      setSetupBusy(false);
    }
  };

  const recreateStudyModel = async () => {
    setSetupBusy(true);
    setSetupMessage('');
    try {
      const latestModels = await listAnkiDroidModels();
      setModels(latestModels);
      await createStudyModel(getNextStudyNoteName(latestModels), true);
    } catch (error) {
      setSetupMessage(
        error instanceof Error ? error.message : _('Could not create the Readest note type.'),
      );
      setSetupBusy(false);
    }
  };

  const makeSendRequest = (): SendRequest | null => {
    if (!destination || !selectedModel || destination.modelId !== selectedModel.id) {
      setSetupMessage(_('Save an AnkiDroid destination before adding a card.'));
      return null;
    }
    if (
      !validation.ok ||
      noteError ||
      mappingError ||
      !mappedFields ||
      destination.deckId !== selectedDeckId
    )
      return null;
    return {
      modelId: destination.modelId,
      deckId: destination.deckId,
      fields: mappedFields,
      tags: draft.tags,
      snapshotId: draft.snapshotId,
    };
  };

  const sendRequest = async (request: SendRequest, checkForDuplicate: boolean) => {
    if (checkForDuplicate) {
      setSendState({ phase: 'checking' });
      try {
        const duplicate = await checkAnkiDroidDuplicate(request.modelId, request.fields[0] ?? '');
        if (duplicate) {
          setSendState({ phase: 'duplicate', request });
          return;
        }
      } catch (error) {
        setSendState({
          phase: 'failure',
          kind: 'uncertain',
          message:
            error instanceof Error
              ? error.message
              : _('Duplicate check failed. The note was not sent.'),
        });
        return;
      }
    }
    setSendState({ phase: 'sending', request });
    try {
      const result = await addAnkiDroidNote(request);
      if (result.status === 'success') {
        setSendState({ phase: 'success', noteId: result.noteId });
      } else {
        setSendState({
          phase: 'failure',
          kind: result.status,
          message:
            result.error ??
            (result.status === 'uncertain'
              ? _('The note may have been added. Check AnkiDroid before retrying.')
              : _('AnkiDroid rejected the note.')),
        });
      }
    } catch (error) {
      setSendState({
        phase: 'failure',
        kind: 'uncertain',
        message:
          error instanceof Error
            ? error.message
            : _('The note may have been added. Check AnkiDroid before retrying.'),
      });
    }
  };

  const addToAnki = () => {
    const request = makeSendRequest();
    if (request) void sendRequest(request, true);
  };

  const copy = async () => {
    const ok = await writeTextToClipboard(buildStudyNoteCopy(draft, snapshot));
    eventDispatcher.dispatch('toast', {
      type: ok ? 'info' : 'warning',
      message: ok ? _('Copied to clipboard') : _('Failed to copy study card'),
      timeout: 2000,
    });
  };
  const setField = (field: 'gloss' | 'translation' | 'sourceText' | 'tags', value: string) =>
    updateDraft((current) => ({
      ...current,
      [field]:
        field === 'tags'
          ? value
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : value,
    }));
  const updateDefinition = (entryId: string, patch: Partial<StudyCardDefinition>) =>
    updateDraft((current) => ({
      ...current,
      definitions: current.definitions.map((definition) =>
        definition.entryId === entryId ? { ...definition, ...patch } : definition,
      ),
    }));
  const changeContextMode = (nextMode: 'sentence' | 'paragraph') => {
    if (editingLocked) return;
    setContextMode(nextMode);
    setAIClozeState({ phase: 'idle' });
    setAIUsage(null);
    setAIGenerationDurationMs(null);
    updateDraft((current) =>
      buildStudyCardDraft(snapshot, current.definitions, {
        contextMode: nextMode,
        gloss: current.gloss,
        translation: current.translation,
        sourceText: current.sourceText,
        tags: current.tags,
      }),
    );
  };

  return (
    <Dialog
      isOpen
      dismissible
      title={_('Create study card')}
      useOverlayScroll
      contentClassName='px-4!'
      onClose={onClose}
    >
      <div className='flex min-h-0 flex-col gap-4 pb-4' data-testid='study-card-dialog'>
        <div>
          <h2 className='text-lg font-semibold tracking-tight'>{_('Create study card')}</h2>
          <p className='text-base-content/70 text-sm leading-relaxed'>
            {_('Review the captured sentence and definitions before copying or sending the card.')}
          </p>
        </div>

        <section className='flex flex-col gap-2'>
          <h3 className='font-semibold'>{_('Selected text')}</h3>
          <p className='bg-base-200/50 eink-bordered rounded-lg p-3 text-sm'>
            {snapshot.selectedText}
          </p>
          <div className='join w-full'>
            <button
              type='button'
              className='btn btn-sm join-item flex-1'
              aria-pressed={contextMode === 'sentence'}
              onClick={() => changeContextMode('sentence')}
            >
              {_('Sentence')}
            </button>
            <button
              type='button'
              className='btn btn-sm join-item flex-1'
              aria-pressed={contextMode === 'paragraph'}
              onClick={() => changeContextMode('paragraph')}
            >
              {_('Paragraph')}
            </button>
          </div>
          <div className='eink-bordered rounded-lg border border-base-200 p-3 text-sm'>
            {draft.contextText.slice(0, draft.selectedSpan?.start ?? 0)}
            <strong className='underline'>{draft.selectedText}</strong>
            {draft.contextText.slice(draft.selectedSpan?.end ?? draft.contextText.length)}
          </div>
          {snapshot.status !== 'ready' && <p className='text-warning text-sm'>{snapshot.reason}</p>}
        </section>

        <section className='flex flex-col gap-3'>
          <h3 className='font-semibold'>{_('Definitions')}</h3>
          {draft.definitions.length === 0 ? (
            <p className='text-base-content/70 text-sm'>
              {_('No portable definition was exported. This will be a context-only card.')}
            </p>
          ) : (
            draft.definitions.map((definition) => (
              <div
                key={definition.entryId}
                className='eink-bordered flex flex-col gap-2 rounded-lg border border-base-200 p-3'
              >
                <label className='flex items-center gap-2 text-sm font-medium'>
                  <input
                    type='checkbox'
                    disabled={editingLocked}
                    checked={definition.included}
                    onChange={(event) =>
                      updateDefinition(definition.entryId, { included: event.target.checked })
                    }
                  />
                  <span>
                    {definition.sourceLabel} · {definition.headword}
                  </span>
                </label>
                <textarea
                  disabled={editingLocked}
                  aria-label={`${definition.sourceLabel} ${definition.headword}`}
                  value={definition.text}
                  onChange={(event) =>
                    updateDefinition(definition.entryId, { text: event.target.value })
                  }
                  className='textarea textarea-bordered min-h-24 w-full text-sm'
                />
              </div>
            ))
          )}
        </section>

        <section className='eink-bordered flex flex-col gap-3 rounded-lg border border-base-200 p-3'>
          <div className='flex items-start justify-between gap-2'>
            <div>
              <h3 className='font-semibold'>{_('AI study cards')}</h3>
              <p className='text-base-content/70 text-sm'>
                {_(
                  'Generate meanings and exercises in one request. Choose which cards to study below.',
                )}
              </p>
            </div>
            <button
              type='button'
              className='btn btn-ghost btn-sm'
              disabled={openrouterFetchingModels || editingLocked || !openrouterKey.trim()}
              onClick={() => void refreshOpenrouterModels()}
              title={_('Refresh OpenRouter models')}
              aria-label={_('Refresh OpenRouter models')}
            >
              {openrouterFetchingModels ? (
                <PiSpinner className='size-4 animate-spin' />
              ) : (
                <PiArrowsClockwise className='size-4' />
              )}
            </button>
          </div>
          <div className='flex flex-col gap-1 text-sm'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-medium'>{_('OpenRouter token')}</span>
              <a
                href='https://openrouter.ai/keys'
                target='_blank'
                rel='noopener noreferrer'
                className='link text-xs'
              >
                {_('Get token')}
              </a>
            </div>
            <input
              type='password'
              className='input input-bordered w-full'
              value={openrouterKey}
              onChange={(event) => {
                setOpenrouterKey(event.target.value);
                setAIConnectionState({ phase: 'idle' });
                setAIUsage(null);
                setAIGenerationDurationMs(null);
              }}
              onBlur={() => void persistOpenRouterSettings({ openrouterApiKey: openrouterKey })}
              placeholder='sk-or-...'
              autoComplete='off'
              disabled={editingLocked}
            />
          </div>
          <label className='flex flex-col gap-1 text-sm'>
            <span className='font-medium'>{_('LLM model')}</span>
            {openrouterModels.length > 0 || openrouterModel ? (
              <>
                {openrouterModels.length > 0 && (
                  <input
                    type='search'
                    className='input input-bordered w-full'
                    value={openrouterModelSearch}
                    onChange={(event) => setOpenrouterModelSearch(event.target.value)}
                    placeholder={_('Search models')}
                    aria-label={_('Search LLM models')}
                    autoComplete='off'
                    disabled={editingLocked}
                  />
                )}
                <select
                  className='select select-bordered w-full'
                  value={openrouterModel}
                  onChange={(event) => {
                    setOpenrouterModel(event.target.value);
                    setOpenrouterModelSearch('');
                    setAIConnectionState({ phase: 'idle' });
                    setAIUsage(null);
                    setAIGenerationDurationMs(null);
                    void persistOpenRouterSettings({ openrouterModel: event.target.value });
                  }}
                  disabled={editingLocked}
                >
                  {!openrouterModels.some((model) => model.id === openrouterModel) &&
                    openrouterModel && (
                      <option value={openrouterModel} disabled>
                        {openrouterModel} · {_('structured JSON unsupported')}
                      </option>
                    )}
                  <option value=''>
                    {openrouterModels.length > 0
                      ? _('Choose a model')
                      : _('No structured-output models available')}
                  </option>
                  {visibleOpenrouterModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name ? `${model.name} (${model.id})` : model.id} ·{' '}
                      {formatOpenRouterModelPrice(model.pricing)}
                    </option>
                  ))}
                  {openrouterModels.length > 0 && visibleOpenrouterModels.length === 0 && (
                    <option value='' disabled>
                      {_('No models match the search')}
                    </option>
                  )}
                </select>
              </>
            ) : (
              <input
                type='text'
                className='input input-bordered w-full'
                value={_('Enter a token to load structured-output models')}
                readOnly
                disabled={editingLocked}
              />
            )}
          </label>
          <p className='text-base-content/60 text-xs'>
            {_('Model price')}: {formatOpenRouterModelPrice(selectedAIModel?.pricing)} ·{' '}
            {_('Approximate request cost')}: {formatApproximateCost(estimatedAICost)}
          </p>
          {aiUsage && <p className='text-success text-xs'>{formatUsage(aiUsage)}</p>}
          {aiGenerationDurationMs !== null && (
            <p className='text-success text-xs'>
              {_('Generation time: {{time}}', {
                time: formatGenerationDuration(aiGenerationDurationMs),
              })}
            </p>
          )}
          {openrouterModelsError && <p className='text-error text-xs'>{openrouterModelsError}</p>}
          {!openrouterKey.trim() && (
            <p className='text-base-content/60 text-xs'>
              {_('Enter an OpenRouter token to load models and generate study content.')}
            </p>
          )}
          {aiClozeState.phase === 'failure' && (
            <p className='text-error text-sm'>{aiClozeState.message}</p>
          )}
          {aiConnectionState.phase === 'failure' && (
            <p className='text-error text-sm'>{aiConnectionState.message}</p>
          )}
          {aiConnectionState.phase === 'success' && (
            <p className='text-success text-sm'>{aiConnectionState.message}</p>
          )}
          {aiClozeState.phase === 'success' && (
            <p className='text-success text-sm'>
              {_('Study content generated. Review it and choose your cards before sending.')}
            </p>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              className='btn btn-sm btn-ghost'
              disabled={!openrouterKey.trim() || editingLocked}
              onClick={() => void checkAIConnection()}
            >
              {aiConnectionState.phase === 'checking' ? (
                <PiSpinner className='size-4 animate-spin' />
              ) : null}
              {_('Check connection')}
            </button>
            <button
              type='button'
              className='btn btn-sm btn-contrast'
              disabled={
                !validation.ok ||
                !openrouterKey.trim() ||
                !openrouterModel.trim() ||
                !selectedAIModel ||
                editingLocked
              }
              onClick={() => void generateAICloze()}
            >
              {aiClozeState.phase === 'generating' ? (
                <PiSpinner className='size-4 animate-spin' />
              ) : null}
              {_('Generate study content')}
            </button>
          </div>
        </section>

        <StudyCardChoices draft={draft} disabled={editingLocked} onChange={updateDraft} />

        <label className='flex flex-col gap-1 text-sm'>
          <span className='font-medium'>{_('Contextual meaning')}</span>
          <input
            disabled={editingLocked}
            className='input input-bordered w-full'
            value={draft.gloss}
            onChange={(event) => setField('gloss', event.target.value)}
          />
        </label>
        <label className='flex flex-col gap-1 text-sm'>
          <span className='font-medium'>{_('Sentence translation')}</span>
          <textarea
            disabled={editingLocked}
            className='textarea textarea-bordered min-h-20 w-full'
            value={draft.translation}
            onChange={(event) => setField('translation', event.target.value)}
          />
        </label>
        <label className='flex flex-col gap-1 text-sm'>
          <span className='font-medium'>{_('Source text')}</span>
          <textarea
            disabled={editingLocked}
            className='textarea textarea-bordered min-h-20 w-full'
            value={draft.sourceText}
            onChange={(event) => setField('sourceText', event.target.value)}
          />
        </label>

        <label className='flex flex-col gap-1 text-sm'>
          <span className='font-medium'>{_('Tags')}</span>
          <input
            disabled={editingLocked}
            className='input input-bordered w-full'
            value={draft.tags.join(', ')}
            onChange={(event) => setField('tags', event.target.value)}
            placeholder={_('Optional, comma-separated')}
          />
        </label>

        <section className='eink-bordered flex flex-col gap-3 rounded-lg border border-base-200 p-3'>
          <div className='flex items-center justify-between gap-2'>
            <div>
              <h3 className='font-semibold'>{_('AnkiDroid destination')}</h3>
              <p className='text-base-content/70 text-sm'>
                {_('Choose where this card will be added. Nothing is sent automatically.')}
              </p>
            </div>
            <button
              type='button'
              className='btn btn-ghost btn-sm'
              disabled={setupBusy}
              onClick={() => void refreshDestination()}
              title={_('Refresh AnkiDroid destinations')}
            >
              <MdRefresh size={18} />
            </button>
          </div>
          {!status?.supported && (
            <p className='text-base-content/70 text-sm'>
              {setupMessage || _('AnkiDroid is available on Android only.')}
            </p>
          )}
          {status?.supported && !status.installed && (
            <p className='text-base-content/70 text-sm'>
              {_('Install AnkiDroid to enable direct adding.')}
            </p>
          )}
          {status?.supported && status.installed && !status.apiAvailable && (
            <p className='text-warning text-sm'>
              {_('Enable AnkiDroid API access, then refresh.')}
            </p>
          )}
          {status?.supported && status.apiAvailable && status.permission !== 'granted' && (
            <div className='flex flex-wrap items-center gap-2'>
              <p className='text-warning flex-1 text-sm'>
                {_('AnkiDroid permission is required before decks and models can be listed.')}
              </p>
              <button
                type='button'
                className='btn btn-sm btn-contrast'
                disabled={setupBusy}
                onClick={() => void requestPermission()}
              >
                {_('Request permission')}
              </button>
            </div>
          )}
          {status?.permission === 'granted' && (
            <>
              <label className='flex flex-col gap-1 text-sm'>
                <span className='font-medium'>{_('Deck')}</span>
                <select
                  className='select select-bordered w-full'
                  disabled={setupBusy || editingLocked}
                  value={selectedDeckId}
                  onChange={(event) => {
                    setSelectedDeckId(event.target.value);
                    setDestination(null);
                    setSendState({ phase: 'editing' });
                  }}
                >
                  <option value=''>{_('Choose a deck')}</option>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className='flex flex-col gap-1 text-sm'>
                <span className='font-medium'>{_('Readest note type')}</span>
                <select
                  className='select select-bordered w-full'
                  disabled={setupBusy || editingLocked}
                  value={selectedModelId}
                  onChange={(event) => {
                    setSelectedModelId(event.target.value);
                    setDestination(null);
                    setMapping({ contextField: 'Sentence' });
                    setSendState({ phase: 'editing' });
                  }}
                >
                  <option value=''>{_('Choose a Readest note type')}</option>
                  {studyModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type='button'
                className='btn btn-sm btn-ghost self-start'
                disabled={setupBusy || editingLocked}
                onClick={() => void createStudyModel()}
              >
                {_('Set up Readest note type')}
              </button>
              {models.some((model) => isReadestStudyNoteName(model.name)) && (
                <button
                  type='button'
                  className='btn btn-sm btn-ghost self-start'
                  disabled={setupBusy || editingLocked}
                  onClick={() => void recreateStudyModel()}
                >
                  {_('Create updated Readest note type')}
                </button>
              )}
              <p className='text-sm'>
                {_(
                  'Dedicated fields keep the generated card content. Setup reuses an existing note type. Create updated Readest note type makes a new version with the latest templates and preserves the old type and notes.',
                )}
              </p>
              {selectedModel && (
                <>
                  {mappingError && <p className='text-error text-sm'>{mappingError}</p>}
                  {mappedFields && (
                    <details className='eink-bordered rounded-md border border-base-200 p-2 text-xs'>
                      <summary className='font-medium'>{_('Note fields')}</summary>
                      {selectedModel.fieldNames.map((field, index) => (
                        <div key={field}>
                          <span className='font-medium'>{field}:</span>{' '}
                          {mappedFields[index] || _('Empty')}
                        </div>
                      ))}
                    </details>
                  )}
                  <button
                    type='button'
                    className='btn btn-sm self-start'
                    disabled={setupBusy || editingLocked || !!mappingError || !selectedDeck}
                    onClick={saveDestination}
                  >
                    {_('Save destination')}
                  </button>
                </>
              )}
              {setupMessage && <p className='text-base-content/70 text-sm'>{setupMessage}</p>}
            </>
          )}
        </section>

        <div className='text-base-content/70 text-sm'>
          {[snapshot.source.bookTitle, snapshot.source.chapterTitle].filter(Boolean).join(' — ') ||
            _('Reading selection')}
        </div>
        {!validation.ok && <p className='text-error text-sm'>{validation.message}</p>}
        {validation.ok && noteError && <p className='text-warning text-sm'>{_(noteError)}</p>}
        {sendState.phase === 'checking' && (
          <p className='text-base-content/70 text-sm'>{_('Checking for an existing note…')}</p>
        )}
        {sendState.phase === 'sending' && (
          <p className='text-base-content/70 text-sm'>{_('Adding note to AnkiDroid…')}</p>
        )}
        {sendState.phase === 'duplicate' && (
          <div className='border-warning bg-warning/10 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm'>
            <span className='flex-1'>
              {_('AnkiDroid already has a note with the same first field for this model.')}
            </span>
            <button
              type='button'
              className='btn btn-sm btn-contrast'
              onClick={() => void sendRequest(sendState.request, false)}
            >
              {_('Add anyway')}
            </button>
            <button
              type='button'
              className='btn btn-sm btn-ghost'
              onClick={() => setSendState({ phase: 'editing' })}
            >
              {_('Cancel')}
            </button>
          </div>
        )}
        {sendState.phase === 'success' && (
          <p className='text-success text-sm'>
            {_('Added to AnkiDroid')}
            {sendState.noteId ? ` · ${sendState.noteId}` : ''}
          </p>
        )}
        {sendState.phase === 'failure' && (
          <p className='text-error text-sm'>
            {sendState.kind === 'uncertain'
              ? _('The note may have been added. Check AnkiDroid before retrying.')
              : sendState.message}
          </p>
        )}
        <div className='flex flex-wrap justify-end gap-2'>
          <button type='button' className='btn btn-ghost' onClick={onClose}>
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-contrast'
            disabled={editingLocked || !!noteError}
            onClick={() => void copy()}
          >
            <MdContentCopy size={18} /> {_('Copy')}
          </button>
          <button
            type='button'
            className='btn btn-contrast'
            disabled={
              !validation.ok ||
              !!noteError ||
              !!mappingError ||
              !destinationReady ||
              editingLocked ||
              sendState.phase === 'success'
            }
            onClick={addToAnki}
          >
            <MdSend size={18} /> {_('Add to AnkiDroid')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default StudyCardDialog;

'use client';

import React from 'react';
import type { DictionaryEntry } from '@/services/dictionaries/types';
import type { SelectionSnapshot } from '@/services/studyCards/types';

import Dialog from '@/components/Dialog';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';

interface DictionarySheetProps {
  word: string;
  lang?: string;
  onDismiss: () => void;
  onManage?: () => void;
  selectionSnapshot?: SelectionSnapshot;
  onCreateStudyCard?: (snapshot: SelectionSnapshot, entries: DictionaryEntry[]) => void;
  autoGenerateStudyCard?: boolean;
  onAutoGenerateStudyCard?: (snapshot: SelectionSnapshot, entries: DictionaryEntry[]) => void;
}

const DictionarySheet: React.FC<DictionarySheetProps> = ({
  word,
  lang,
  onDismiss,
  onManage,
  selectionSnapshot,
  onCreateStudyCard,
  autoGenerateStudyCard,
  onAutoGenerateStudyCard,
}) => {
  const state = useDictionaryResults({ word, lang, selectionSnapshot });
  return (
    <Dialog
      isOpen
      snapHeight={0.75}
      dismissible
      header={
        <DictionaryResultsHeader
          // The -mt-4 compensates for Dialog's drag handle, which is `sm:hidden`
          // (shown only below sm). Mirror that breakpoint so on sm+ (no handle)
          // the header isn't pulled up into the top edge.
          headerClassName='-mt-4 sm:mt-0'
          currentWord={state.currentWord}
          setQuery={state.setQuery}
          canGoBack={state.canGoBack}
          goBack={state.goBack}
          onManage={onManage}
          onSpeak={state.speakWord}
          speaking={state.isSpeaking}
        />
      }
      contentClassName='px-0! mt-0!'
      onClose={onDismiss}
    >
      <DictionaryResultsBody
        {...state}
        onCreateStudyCard={onCreateStudyCard}
        autoGenerateStudyCard={autoGenerateStudyCard}
        onAutoGenerateStudyCard={onAutoGenerateStudyCard}
      />
    </Dialog>
  );
};

export default DictionarySheet;

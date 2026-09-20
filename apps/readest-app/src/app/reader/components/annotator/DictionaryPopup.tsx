'use client';

import React from 'react';

import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import type { DictionaryEntry } from '@/services/dictionaries/types';
import type { SelectionSnapshot } from '@/services/studyCards/types';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';

interface DictionaryPopupProps {
  word: string;
  lang?: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
  /**
   * Invoked when the user clicks the header gear. The host (Annotator)
   * decides how to navigate — typically by opening the SettingsDialog and
   * deep-linking to the dictionaries sub-page.
   */
  onManage?: () => void;
  selectionSnapshot?: SelectionSnapshot;
  onCreateStudyCard?: (snapshot: SelectionSnapshot, entries: DictionaryEntry[]) => void;
  autoGenerateStudyCard?: boolean;
  onAutoGenerateStudyCard?: (snapshot: SelectionSnapshot, entries: DictionaryEntry[]) => void;
}

const DictionaryPopup: React.FC<DictionaryPopupProps> = ({
  word,
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onManage,
  selectionSnapshot,
  onCreateStudyCard,
  autoGenerateStudyCard,
  onAutoGenerateStudyCard,
}) => {
  const state = useDictionaryResults({ word, lang, selectionSnapshot });
  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={trianglePosition}
      className='select-text'
      onDismiss={onDismiss}
    >
      {/* `overflow-hidden rounded-lg` clips the body's section backgrounds /
          borders to the Popup's rounded shape. */}
      <div className='flex h-full flex-col overflow-hidden rounded-lg pt-4'>
        <DictionaryResultsHeader
          headerClassName='-mt-2'
          currentWord={state.currentWord}
          setQuery={state.setQuery}
          canGoBack={state.canGoBack}
          goBack={state.goBack}
          onManage={onManage}
          onSpeak={state.speakWord}
          speaking={state.isSpeaking}
        />
        <div className='min-h-0 flex-1'>
          <DictionaryResultsBody
            {...state}
            onCreateStudyCard={onCreateStudyCard}
            autoGenerateStudyCard={autoGenerateStudyCard}
            onAutoGenerateStudyCard={onAutoGenerateStudyCard}
          />
        </div>
      </div>
    </Popup>
  );
};

export default DictionaryPopup;

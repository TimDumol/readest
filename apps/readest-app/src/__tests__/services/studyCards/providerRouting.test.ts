import { describe, expect, it } from 'vitest';

import { buildStudyCardProviderRequest } from '@/services/studyCards/providerRouting';

describe('study card provider routing', () => {
  it('keeps the structured-output requirement and normalizes provider lists', () => {
    expect(
      buildStudyCardProviderRequest({
        only: [' google-ai-studio ', 'google-ai-studio', ''],
        ignore: [' deepinfra '],
        sort: 'throughput',
      }),
    ).toEqual({
      require_parameters: true,
      only: ['google-ai-studio'],
      ignore: ['deepinfra'],
      sort: 'throughput',
    });
  });

  it('omits empty and invalid preferences', () => {
    expect(
      buildStudyCardProviderRequest({
        only: [' ', ''],
        ignore: [],
        sort: 'invalid' as never,
      }),
    ).toEqual({ require_parameters: true });
  });
});

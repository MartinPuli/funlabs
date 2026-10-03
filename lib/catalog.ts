/** Shared vocabulary: labels, consent texts and bounty templates from FUNLABS.md. */

export const STUDY_FLOW = ['draft', 'published', 'collecting', 'analyzing', 'evidence_ready', 'comparing', 'completed'] as const;
export type StudyStatus = (typeof STUDY_FLOW)[number] | 'archived';

export const STATUS_LABEL: Record<StudyStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  collecting: 'Collecting material',
  analyzing: 'Analyzing',
  evidence_ready: 'Evidence ready',
  comparing: 'Comparison in progress',
  completed: 'Completed',
  archived: 'Archived',
};

export const OBJECTIVE_LABEL: Record<string, string> = {
  clarity: 'Clarity',
  fun: 'Fun',
  challenge: 'Challenge',
  pacing: 'Pacing',
  controls: 'Control responsiveness',
};

/** What each objective collects, fixed before the study (FUNLABS.md §4). */
export const OBJECTIVE_MEASURE: Record<string, string> = {
  clarity: 'Stated understanding and evidence that the person completed the task.',
  fun: 'Preference and stated reason.',
  challenge: 'Stated difficulty, attempts and whether the person wants to keep the challenge.',
  pacing: 'Stated and observed moments of waiting or rushing.',
  controls: 'Actions that did not respond the way the person expected.',
};

export const CATEGORY_LABEL: Record<string, string> = {
  clarity: 'Clarity',
  difficulty: 'Difficulty',
  enjoyment: 'Enjoyment',
  controls: 'Controls',
  pacing: 'Pacing',
  bug: 'Bug',
  other: 'Other',
};

export const REVIEW_LABEL: Record<string, string> = {
  unreviewed: 'Unreviewed',
  confirmed: 'Confirmed',
  corrected: 'Corrected',
  rejected: 'Rejected',
};

export const STRUCTURAL_LABEL: Record<string, string> = {
  verified: 'Verified sources',
  partial: 'Partial sources',
  unsupported: 'No verifiable source: hypothesis',
};

export const ORIGIN_LABEL: Record<string, string> = {
  model: 'Gemini',
  human: 'Team member',
  agent: 'Participating agent',
};

export const BOUNTY_KIND_LABEL: Record<string, string> = {
  human_playtest: 'Human: experience and explain',
  agent_prediction: 'Agent: predict a preference',
  agent_analysis: 'Agent: analyze evidence',
  agent_intervention: 'Agent: propose and check an improvement',
};

export const FINAL_QUESTIONS = [
  { key: 'enjoyed', text: 'What did you enjoy?' },
  { key: 'confusing', text: 'Where did you not know how to continue, or what was hard to understand?' },
  { key: 'change', text: 'What would you change?' },
] as const;

/** Labels are tied to the presentation position, never to version A or B. */
export const NEUTRAL_LABELS = ['Amber version', 'Sky version'] as const;

export const CONSENT_TEXTS = {
  participation_recording: {
    version: 'participation-v1',
    text:
      'I agree to take part in this private test and to have only the game tab recorded while I play. The microphone is optional and no camera is used. I can stop recording at any time and choose the written alternative.',
  },
  research_sharing: {
    version: 'research-v1',
    text:
      'Optional. I allow game events, my comments and reviewed findings from this test to be included in a private export for research. Video is not included unless separately authorized. I can withdraw this permission before each export.',
  },
  model_training: {
    version: 'training-v1',
    text: 'Optional and separate. I allow that same data to be used to train or evaluate models.',
  },
} as const;

export const CREATOR_CONSENT_TEXT = {
  version: 'creator-research-v1',
  text:
    'As the product owner, I authorize that examples from this study that have each participant\'s permission and have been reviewed be included in a private export for research.',
};

export type BountyTemplate = {
  kind: 'human_playtest' | 'agent_prediction' | 'agent_analysis' | 'agent_intervention';
  title: string;
  instructions: string;
  deliverable: string;
  criteria: string[];
};

export const BOUNTY_TEMPLATES: Record<BountyTemplate['kind'], BountyTemplate> = {
  human_playtest: {
    kind: 'human_playtest',
    title: 'Play and explain',
    instructions: 'Play this experience for two minutes. Tell us what you enjoyed and where you did not know how to continue.',
    deliverable: 'Tab recording, optional spoken or written comment, final answers and a comparison of versions when applicable.',
    criteria: [
      'Usable material: a recording or the written alternative.',
      'Attempted the requested task.',
      'Comments related to the session.',
      'Saying something is boring, choosing the earlier version or having no preference are valid submissions.',
      'Positive comments are not paid for, and neither is agreeing with other people.',
    ],
  },
  agent_prediction: {
    kind: 'agent_prediction',
    title: 'Predict a preference',
    instructions: 'For this audience and these two versions, anticipate which one will be preferred, why and with what uncertainty.',
    deliverable: 'A choice (one version or no preference), the reasons and the uncertainty, recorded before seeing human results.',
    criteria: [
      'Recorded with a timestamp before results are revealed. If the agent has already seen them, it counts as retrospective analysis.',
      'Compared with human preferences, including disagreement and no preference.',
      'A single hit or a small sample does not prove general judgment.',
    ],
  },
  agent_analysis: {
    kind: 'agent_analysis',
    title: 'Analyze evidence',
    instructions: 'Find moments where the instructions were hard to understand. Attach the interval and the source that support each finding.',
    deliverable: 'Observations, related comments, hypotheses and notes on what is worth keeping.',
    criteria: [
      'Correspondence with the material.',
      'Intervals inside the recording.',
      'Verifiable quotes: each quote references a real comment.',
      'Coverage of the available sessions.',
      'Separation between observation and interpretation.',
      'Another model\'s opinion is not the only reference.',
    ],
  },
  agent_intervention: {
    kind: 'agent_intervention',
    title: 'Propose and check an improvement',
    instructions: 'Improve the clarity of the opening while keeping the challenge. Deliver a variant and explain which evidence motivated the change.',
    deliverable: 'Runnable version, traceable change and working checks. The later human preference is recorded separately.',
    criteria: [
      'Only editable regions change: levels and rules stay identical.',
      'Passes the checks fixed before the change.',
      'Cites the evidence that motivated it and says what it keeps.',
    ],
  },
};

export const CAPABILITIES = {
  'evidence:read': 'Read studies and evidence for the product',
  'study:create': 'Prepare draft studies',
  'study:publish': 'Publish studies within the spending policy',
  'work:submit': 'Submit predictions, analyses or interventions',
  'results:read': 'See human preferences (marks later predictions as retrospective)',
  'export:request': 'Request private research exports',
} as const;

export type Capability = keyof typeof CAPABILITIES;

export const CREATOR_AGENT_CAPABILITIES: Capability[] = ['evidence:read', 'study:create', 'study:publish', 'work:submit', 'results:read', 'export:request'];
export const PREDICTION_AGENT_CAPABILITIES: Capability[] = ['evidence:read', 'work:submit'];
export const ANALYSIS_AGENT_CAPABILITIES: Capability[] = ['evidence:read', 'work:submit'];

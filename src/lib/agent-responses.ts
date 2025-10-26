import { ScenarioType, Agent, DifficultyLevel } from '@/types';

// Lightweight integration context for agent prompting
export interface AgentPromptContext {
  scenarioBasePrompt: string;
  userExtras?: string;
  talkingPoints?: Array<{ text: string; importance: number }>;
  presentational?: boolean;
}

// Lead-up phrases for different scenarios
const leadUpPhrases: Record<ScenarioType, string[]> = {
  party: [
    "So, I was wondering...",
    "Oh, by the way...",
    "I just wanted to ask...",
    "Hey, quick question...",
    "You know what...",
    "Actually...",
    "I'm curious...",
  ],
  classroom: [
    "I have a question...",
    "Let me think...",
    "Actually, I believe...",
    "From what I understand...",
    "If I may add...",
    "I was thinking...",
    "In my opinion...",
  ],
  'job-interview': [
    "That's a great question...",
    "Let me explain...",
    "I'd like to know...",
    "To clarify...",
    "Building on that...",
    "I'm curious about...",
  ],
  'de-escalation': [
    "I understand, but...",
    "Let me see if I get this...",
    "I hear what you're saying...",
    "Can we talk about...",
    "I feel like...",
    "Help me understand...",
  ],
  presentation: [
    "I was wondering...",
    "Can you clarify...",
    "This is interesting, but...",
    "I'd like to know more about...",
    "Going back to your point...",
    "Just to confirm...",
  ]
};

const responseTemplates: Record<ScenarioType, string[]> = {
  party: [
    "Hey! Great to meet you! What brings you here tonight?",
    "I love this music! Have you tried the appetizers yet?",
    "So, what do you do for fun?",
    "This is such a nice venue, right?",
    "Do you know many people here?"
  ],
  classroom: [
    "Can you elaborate on that point?",
    "What's your reasoning behind that answer?",
    "Interesting perspective. Can you explain further?",
    "I'm not sure I follow. Could you clarify?",
    "That's a good start. What else can you add?"
  ],
  'job-interview': [
    "Tell me about yourself and your background.",
    "What interests you about this position?",
    "Can you describe a challenging situation you've faced?",
    "Where do you see yourself in five years?",
    "What are your greatest strengths?",
    "Why should we hire you?"
  ],
  'de-escalation': [
    "I'm really frustrated with this situation!",
    "This isn't what I expected at all.",
    "Can you help me understand what's going on?",
    "I need this resolved immediately.",
    "I appreciate you taking the time to talk."
  ],
  presentation: [
    "Could you explain that slide in more detail?",
    "What data supports that conclusion?",
    "How does this compare to other approaches?",
    "Can you give us a real-world example?",
    "What are the potential limitations?"
  ]
};

const followUpQuestions: Record<ScenarioType, string[]> = {
  party: [
    "That's interesting! How did you get into that?",
    "Oh really? Tell me more!",
    "I've always wanted to try that. Any tips?"
  ],
  classroom: [
    "Can you provide an example?",
    "What evidence supports that?",
    "How does that relate to what we discussed earlier?"
  ],
  'job-interview': [
    "Can you give me a specific example?",
    "How did you handle that situation?",
    "What did you learn from that experience?"
  ],
  'de-escalation': [
    "I understand, but can we find a solution?",
    "What would make this better for you?",
    "Let's work through this together."
  ],
  presentation: [
    "Could you clarify that point?",
    "What's your source for that information?",
    "How confident are you in these results?"
  ]
};

// --- Utilities for on-topic question generation ---
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','if','then','else','for','to','of','in','on','at','by','with','from','as','is','are','was','were','be','been','being','it','this','that','these','those','i','you','he','she','we','they','me','him','her','us','them','my','your','his','her','our','their','mine','yours','ours','theirs','do','does','did','doing','have','has','had','having','so','not','no','yes','just','like'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function lastUserUtterance(history: string[]): string | null {
  if (!history?.length) return null;
  // Prefer entries explicitly marked as user
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i];
    if (typeof content === 'string' && content.startsWith('You:')) {
      return content.replace(/^You:\s*/, '').trim();
    }
  }
  // Fallback: return last non-empty string
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i];
    if (content && typeof content === 'string' && content.trim()) return content.trim();
  }
  return null;
}

function pointAddressed(point: string, history: string[]): boolean {
  if (!history?.length) return false;
  const pointTokens = new Set(tokenize(point));
  if (pointTokens.size === 0) return false;
  const historyText = history.join(' \n ');
  const histTokens = new Set(tokenize(historyText));
  let overlap = 0;
  for (const t of pointTokens) if (histTokens.has(t)) overlap++;
  // Consider addressed if there is some overlap of keywords
  return overlap >= Math.min(2, Math.max(1, Math.floor(pointTokens.size * 0.2)));
}

function chooseNextPoint(points: Array<{ text: string; importance: number }>, history: string[]) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const unaddressed = points
    .filter((p) => p && typeof p.text === 'string' && p.text.trim().length > 0)
    .filter((p) => !pointAddressed(p.text, history))
    .sort((a, b) => (b.importance || 0) - (a.importance || 0));
  return unaddressed[0] || null;
}

function formatQuestionForPoint(
  scenarioType: ScenarioType,
  pointText: string,
  presentational: boolean | undefined,
  lastUtterance: string | null
): string {
  const base = pointText.trim().replace(/[?!.]+$/g, '');
  const lastTokens = lastUtterance ? tokenize(lastUtterance) : [];
  const salient = lastTokens.slice(0, 3); // up to 3 keywords to echo
  const echo = salient.length ? `You mentioned ${salient.join(', ')}. ` : '';
  if (presentational) {
    // Tailor for presentational scenarios
    const variants = [
      `${echo}Where in your presentation will you cover "${base}"?`,
      `${echo}How will you explain "${base}" to your audience?`,
      `${echo}Could you outline how you plan to address "${base}"?`,
    ];
    return variants[Math.floor(Math.random() * variants.length)];
  }
  const variants = [
    `${echo}Could you talk a bit about "${base}"?`,
    `${echo}What are your thoughts on "${base}"?`,
    `${echo}How are you thinking about "${base}" right now?`,
    `${echo}Can you clarify your approach to "${base}"?`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function maybeAddLeadUpText(scenarioType: ScenarioType, difficulty: DifficultyLevel, text: string): string {
  if (!shouldAddLeadUp(difficulty)) return text;
  const leadUp = getRandomLeadUp(scenarioType);
  return `${leadUp} ${text}`;
}

const shouldAddLeadUp = (difficulty: DifficultyLevel): boolean => {
  const chances = {
    easy: 0.4,
    medium: 0.3,
    hard: 0.2
  };
  return Math.random() < chances[difficulty];
};

const getRandomLeadUp = (scenarioType: ScenarioType): string => {
  const phrases = leadUpPhrases[scenarioType];
  return phrases[Math.floor(Math.random() * phrases.length)];
};


export const generateAgentResponse = (
  scenarioType: ScenarioType,
  agent: Agent,
  difficulty: DifficultyLevel,
  conversationHistory: string[],
  context?: AgentPromptContext
): string => {
  const presentational = context?.presentational;
  const points = context?.talkingPoints || [];

  // Prefer asking questions derived from highest-importance unaddressed talking points
  const nextPoint = chooseNextPoint(points, conversationHistory);
  let response: string | null = null;
  if (nextPoint) {
    response = formatQuestionForPoint(
      scenarioType,
      nextPoint.text,
      presentational,
      lastUserUtterance(conversationHistory)
    );
  }

  // If no talking points or all covered, ask a contextual follow-up grounded in user history
  if (!response) {
    const lastUtter = lastUserUtterance(conversationHistory);
    const extrasText = `${context?.userExtras || ''} ${context?.scenarioBasePrompt || ''}`.trim();
    const allTokens = tokenize(`${lastUtter || ''} ${extrasText}`);
    if (allTokens.length > 0) {
      const salient = Array.from(new Set(allTokens)).slice(0, 4).join(', ');
      const base = salient ? `You mentioned ${salient}. ` : '';
      const fu = followUpQuestions[scenarioType] || [];
      const fallback = fu.length ? fu[Math.floor(Math.random() * fu.length)] : 'Could you elaborate?';
      response = `${base}${fallback}`;
    }
  }

  // As a final fallback, use existing templates but ensure it's a question to keep the agent asking rather than asserting
  if (!response) {
    const templates = responseTemplates[scenarioType] || [];
    const followUps = followUpQuestions[scenarioType] || [];
    const pool = conversationHistory.length > 2 ? [...templates, ...followUps] : templates;
    const candidate = pool[Math.floor(Math.random() * Math.max(1, pool.length))] || 'Could you tell me more?';
    response = /\?$/.test(candidate) ? candidate : `${candidate}?`;
  }

  // Add optional lead-up, then the emotion prefix for TTS
  response = maybeAddLeadUpText(scenarioType, difficulty, response);
  if (agent.emotionPrefix) {
    response = `${agent.emotionPrefix} ${response}`;
  }
  return response;
};

export const getResponseDelay = (difficulty: DifficultyLevel): number => {
  const delays = {
    easy: 8000,    // 8 seconds
    medium: 5000,  // 5 seconds
    hard: 3000     // 3 seconds
  };
  
  return delays[difficulty] + Math.random() * 2000; // Add some randomness
};

export const calculateScore = (
  messageCount: number,
  duration: number,
  difficulty: DifficultyLevel
): number => {
  const baseScore = messageCount * 10;
  const timeBonus = Math.max(0, 100 - duration / 10);
  const difficultyMultiplier = difficulty === 'hard' ? 1.5 : difficulty === 'medium' ? 1.2 : 1;
  
  return Math.round((baseScore + timeBonus) * difficultyMultiplier);
};
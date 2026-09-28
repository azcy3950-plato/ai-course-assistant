export type PetAction = 'praise' | 'rest' | 'tea';

export type PetState = {
  version: 1;
  level: number;
  xp: number;
  affection: number;
  energy: number;
  interactions: number;
  lastAction: PetAction | null;
  lastActionAt: string | null;
  celebratedSteps: string[];
};

export type PetActionResult = {
  state: PetState;
  message: string;
};

export const PET_LEVEL_XP = 40;

export const emptyPetState = (): PetState => ({
  version: 1,
  level: 1,
  xp: 0,
  affection: 0,
  energy: 3,
  interactions: 0,
  lastAction: null,
  lastActionAt: null,
  celebratedSteps: [],
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeState = (value: Partial<PetState>): PetState => {
  const rawXp = Math.max(0, Number.isFinite(value.xp) ? Number(value.xp) : 0);
  const rawLevel = Math.max(1, Number.isFinite(value.level) ? Number(value.level) : 1);
  const level = clamp(rawLevel + Math.floor(rawXp / PET_LEVEL_XP), 1, 99);
  const xp = clamp(rawXp % PET_LEVEL_XP, 0, PET_LEVEL_XP - 1);
  return {
    version: 1,
    level,
    xp,
    affection: clamp(Number.isFinite(value.affection) ? Number(value.affection) : 0, 0, 999),
    energy: clamp(Number.isFinite(value.energy) ? Number(value.energy) : 3, 0, 3),
    interactions: clamp(Number.isFinite(value.interactions) ? Number(value.interactions) : 0, 0, 99999),
    lastAction: value.lastAction === 'praise' || value.lastAction === 'rest' || value.lastAction === 'tea' ? value.lastAction : null,
    lastActionAt: typeof value.lastActionAt === 'string' ? value.lastActionAt : null,
    celebratedSteps: Array.isArray(value.celebratedSteps)
      ? value.celebratedSteps.filter((item): item is string => typeof item === 'string').slice(-120)
      : [],
  };
};

export const restorePetState = (value: unknown): PetState => {
  if (!value || typeof value !== 'object') return emptyPetState();
  const candidate = value as Partial<PetState>;
  return candidate.version === 1 ? normalizeState(candidate) : emptyPetState();
};

const gainXp = (state: PetState, amount: number): PetState => {
  let level = state.level;
  let xp = state.xp + amount;
  while (xp >= PET_LEVEL_XP && level < 99) {
    xp -= PET_LEVEL_XP;
    level += 1;
  }
  return {...state, level, xp};
};

export const applyPetAction = (state: PetState, action: PetAction, now = new Date().toISOString()): PetActionResult => {
  if (action === 'tea') {
    return {state: {...state, affection: state.affection + 2, energy: 3, interactions: state.interactions + 1, lastAction: action, lastActionAt: now}, message: '茶温刚好。你慢慢想，我慢慢喝。'};
  }
  if (action === 'praise') {
    const next = gainXp({
      ...state,
      affection: state.affection + 3,
      energy: clamp(state.energy + 1, 0, 3),
      interactions: state.interactions + 1,
      lastAction: action,
      lastActionAt: now,
    }, 5);
    return {state: next, message: '收到你的鼓励了。今天也一起把一个问题想清楚吧。'};
  }

  return {
    state: {
      ...state,
      energy: 3,
      interactions: state.interactions + 1,
      lastAction: action,
      lastActionAt: now,
    },
    message: '我们先坐一会儿。准备好了，再继续往下追问。',
  };
};

export const celebratePetStep = (state: PetState, stepKey: string): PetState => {
  if (!stepKey || state.celebratedSteps.includes(stepKey)) return state;
  return gainXp({
    ...state,
    affection: state.affection + 2,
    energy: clamp(state.energy + 1, 0, 3),
    celebratedSteps: [...state.celebratedSteps, stepKey].slice(-120),
  }, 10);
};

export const petXpProgress = (state: PetState) => Math.round((state.xp / PET_LEVEL_XP) * 100);

export const petBondLabel = (affection: number) => affection >= 80 ? '默契老友' : affection >= 25 ? '熟悉的伙伴' : '初识的朋友';

"use client";

import LegacyGuidedWorkspace from '@/components/guided/LegacyGuidedWorkspace';
import FloatingWenshuiPet from '@/components/guided/FloatingWenshuiPet';
import { CompanionProvider } from '@/contexts/CompanionContext';

export default function GuidedPage() {
  return <CompanionProvider><LegacyGuidedWorkspace/><FloatingWenshuiPet/></CompanionProvider>;
}

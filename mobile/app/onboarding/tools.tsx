import React from 'react';

import { OnboardingStepSkeleton } from '../../src/nav/OnboardingStep';

/** Step 3: your tools, the harness picker. Skeleton; the design is DESIGN-DIRECTION 5. */
export default function ToolsStep() {
  return (
    <OnboardingStepSkeleton
      step="tools"
      title="Your tools"
      note="Claude Code, Codex, Cursor, Gemini, Cline, opencode, Aider. Pick the ones you use."
    />
  );
}

import { makeMutable } from 'react-native-reanimated';

/**
 * Where the flow stands for the chrome, in steps (`chromeIndex`): 0 on hello, 6 on the
 * finale, and between two whole numbers while a transition carries the page. Written on the
 * UI thread by the step frames (`StepFrame`) from react-native-screens' transition progress,
 * read by `OnboardingChrome`, which is drawn once above the stack and so has no transition of
 * its own to read.
 */
export const chromeAt = makeMutable(0);

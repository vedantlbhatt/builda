/**
 * Every sentence the phone writes from the engine's ids and numbers (docs/overnight-
 * integration.md 1.5). The report and the session wire carry no rendered string; these do
 * the rendering, each a port of the Python that says the same thing on the Mac.
 *
 *   wrapped   renderCard, renderCards        the fifteen Wrapped cards and their refusals
 *   burn      explainBurn, corpusBurnLine    where a session's tokens went; the corpus fact
 *   money     moneyHeadline, dollars, ...    dollars at API list prices, tokens, lines
 *   title     renderTitle                    a session's engineer voice title
 *   vocab     term, stackName, lockedLine    the glossary and the stack
 *   live      decisionSentence, etaRefusal   the decision feed, the ETA's refusals
 *   numbers   n, count, pct, mins, human     numbers said exactly as Python says them
 *   plain     spoken, ordinal, hasDash       plain.py: words for numbers, one dash rule
 */

export * from './burn';
export * from './live';
export * from './money';
export * from './numbers';
export * from './plain';
export * from './title';
export * from './vocab';
export * from './wrapped';

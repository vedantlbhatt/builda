/**
 * Which repository an `existing_repo` move runs in. The person chooses; nothing else can.
 *
 * THE PLANNER NEVER NAMES A REPOSITORY. It has never seen one: `spec/drops.v1.json` gives a move
 * `target: existing_repo` and no field to put a repository in, and the wire carries the salted
 * key rather than a name at every point after that. So a move that says "add this to one of your
 * repos" is not startable until somebody says which, and this is where they say it.
 *
 * IT IS THE PROJECTS TAB'S OWN LIST, not a second one. The keys come from the Mac's report
 * (`data/reportProjects.ts`), the numbers from the register the Projects tab keeps, and the words
 * from `projectLabel`, so a project called "Private project 4" here is called that everywhere.
 * A private repository's NAME is not on this phone and is not needed: the key is what travels,
 * and the runner resolves it back to a checkout by hashing the machine's own repositories
 * (`drops/workspace.repo_for_key`).
 *
 * WHEN THERE ARE NONE. A phone that has never had a report has nothing to offer, and the row says
 * that rather than showing an empty list: the fix is to run the Mac agent, not to tap harder.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { reportProjects, type ListedProject } from '../data/reportProjects';
import { useRepoNames } from '../data/repoNames';
import { projectChoices, type RepoChoice } from './repos';
import { Hairline } from '../ui/Hairline';
import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import { useColors } from '../ui/scheme';

export interface RepoPickerProps {
  /** The key already chosen, or null. */
  chosen: string | null;
  onChoose: (key: string) => void;
  /** The move's hue, so the chosen row reads as part of the move it belongs to. */
  ink: string;
  onFill: string;
}

/** `projectChoices` over the phone's own report and register. */
export function useProjectChoices(): RepoChoice[] | null {
  const names = useRepoNames();
  const [listed, setListed] = useState<ListedProject[] | null>(null);
  useEffect(() => {
    let alive = true;
    void reportProjects().then((l) => {
      if (alive) setListed(l);
    });
    return () => {
      alive = false;
    };
  }, []);
  return projectChoices(listed, names);
}

export function RepoPicker({ chosen, onChoose, ink, onFill }: RepoPickerProps) {
  const c = useColors();
  const choices = useProjectChoices();

  if (choices === null) {
    return (
      <T role="meta" style={{ color: c.textFaint, marginTop: 10 }}>
        Reading your projects
      </T>
    );
  }
  if (choices.length === 0) {
    return (
      <T role="meta" style={{ color: c.textFaint, marginTop: 10 }}>
        This phone has no projects yet. Run the Mac agent once and they appear here.
      </T>
    );
  }

  return (
    <View style={styles.list}>
      <T role="meta" weight={600} style={{ color: c.textDim, marginBottom: 2 }}>
        Which repo
      </T>
      {choices.map((p) => {
        const on = p.key === chosen;
        return (
          <View key={p.key}>
            <Hairline />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.label}
              onPress={() => {
                select();
                onChoose(p.key);
              }}
              style={[styles.row, on && { backgroundColor: ink }]}
            >
              <T role="row" style={{ color: on ? onFill : c.text }}>
                {p.label}
              </T>
              {/* The key's head, in mono. It is what actually travels, and printing it is how a
                  person can tell two "Private project" rows apart when the numbers have not
                  landed yet. */}
              <T role="mono" style={{ color: on ? onFill : c.textFaint }}>
                {p.key.slice(0, 7)}
              </T>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
});

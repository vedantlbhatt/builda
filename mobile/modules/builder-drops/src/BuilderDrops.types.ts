/** One thing the share extension put in the App Group, waiting for the app to send it. */
export interface PendingDrop {
  /** The link, exactly as the sharing app handed it over. Normalised by JS, not by Swift. */
  url: string;
  /** Whatever text came with it. TikTok sometimes sends the caption; Instagram sends nothing. */
  text: string;
  /** Seconds since the epoch, when the share happened. */
  at: number;
}

/** What the share extension would find in the App Group's keychain (`BuilderDropsCredential`). */
export type CredentialStatus =
  | { present: false }
  | { present: true; usable: boolean; secondsLeft: number; baseURL: string };

/** The share extension's own send, as the debug route runs it. */
export type DirectShareResult = { sent: true; dropId: string } | { sent: false; why: string };

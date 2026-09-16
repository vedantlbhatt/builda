/** One thing the share extension put in the App Group, waiting for the app to send it. */
export interface PendingDrop {
  /** The link, exactly as the sharing app handed it over. Normalised by JS, not by Swift. */
  url: string;
  /** Whatever text came with it. TikTok sometimes sends the caption; Instagram sends nothing. */
  text: string;
  /** Seconds since the epoch, when the share happened. */
  at: number;
}

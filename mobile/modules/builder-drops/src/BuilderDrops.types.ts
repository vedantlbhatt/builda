/** One thing the share extension put in the App Group, waiting for the app to send it. */
export interface PendingDrop {
  /** The link, exactly as the sharing app handed it over. Normalised by JS, not by Swift. */
  url: string;
  /** Whatever text came with it. TikTok sometimes sends the caption; Instagram sends nothing. */
  text: string;
  /** Seconds since the epoch, when the share happened. */
  at: number;
}

/** What the share sheet did with a ship kit's files (`shareItems`). */
export interface ShareItemsResult {
  /** The person picked a destination and it took the items. */
  shared: boolean;
  /** The activity type iOS reports (`com.apple.UIKit.activity.Message`, an app's extension id), or null. */
  activity: string | null;
  /** Files that were not on disk when the sheet opened, so were not offered. */
  missing: number;
}

import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import styles from "./privacy.module.css";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <PageShell title="Privacy">
      <article className={styles.article}>
        <p className={styles.lead}>Aura is designed so that what you do stays with you. There are no accounts, no analytics, no advertising and no trackers.</p>

        <h2>Camera</h2>
        <ul>
          <li>The camera is used only when you choose camera interaction, and only after your browser asks for permission.</li>
          <li>Video frames are analysed on your device by the MediaPipe hand (and optional pose) model. Frames are never uploaded, recorded, stored or logged.</li>
          <li>Aura keeps only the instantaneous positions of your hands needed to draw; no biometric profile is created or saved.</li>
          <li>The camera stops when you turn it off, leave the studio or close the app. When the app is in the background, tracking pauses.</li>
          <li>Aura never requests microphone access.</li>
        </ul>

        <h2>Sound</h2>
        <p>All sound is synthesised live on your device with the Web Audio API. Nothing is recorded unless you choose “Record a clip”, which saves a video file directly to your device.</p>

        <h2>Your creations</h2>
        <ul>
          <li>Saved creations, thumbnails and recovery drafts are stored in your browser (IndexedDB) on this device only.</li>
          <li>Exported files (.png, .aura.json, video) go wherever you save them. Aura doesn’t upload them anywhere.</li>
          <li>Imported project files are validated as data; they can never run code.</li>
          <li>Settings → “Clear all local data” deletes everything Aura stored on this device.</li>
        </ul>

        <h2>Network requests</h2>
        <p>
          Aura loads its own files from the site you opened it on. The only third-party request is the optional download of the MediaPipe tracking models from Google’s public model storage
          (storage.googleapis.com) when you first enable camera interaction. That request contains no information about you beyond what any web request includes (such as your IP address). After
          downloading, models are kept on your device for offline use.
        </p>

        <h2>Third-party components & licences</h2>
        <ul>
          <li>MediaPipe Tasks Vision runtime and models — Apache License 2.0, © Google LLC.</li>
          <li>Three.js — MIT License. React Three Fiber — MIT License. React and Next.js — MIT License.</li>
          <li>Fonts: Manrope and Instrument Serif — SIL Open Font License 1.1, self-hosted.</li>
          <li>All artwork, icons and sounds in Aura are generated procedurally or drawn for this project.</li>
        </ul>
        <p className={styles.small}>
          Aura is a creative tool. It makes no claims of clinical or therapeutic benefit.
        </p>
      </article>
    </PageShell>
  );
}

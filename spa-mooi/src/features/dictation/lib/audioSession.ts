interface AudioSessionNavigator {
  audioSession?: { type: string };
}

let users = 0;
let previousType = 'auto';

/** Routing is leased across captures, including pending permission requests. */
export const acquireAudioSession = (): (() => void) => {
  const session = (navigator as Navigator & AudioSessionNavigator).audioSession;
  if (users++ === 0) {
    previousType = session?.type ?? 'auto';
    setAudioSessionType('play-and-record');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users === 0) setAudioSessionType(previousType);
  };
};

const setAudioSessionType = (type: string): void => {
  const session = (navigator as Navigator & AudioSessionNavigator).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    // Older browsers may expose the API without supporting every routing type.
  }
};

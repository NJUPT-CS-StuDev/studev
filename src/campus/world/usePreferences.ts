import { useEffect, useState } from 'react';
import { readPreferences, subscribePreferences, type Preferences } from './preferences';
import { startSync } from './sync';

/**
 * The visitor's settings, read after mount (the server render knows none) and
 * kept current when they change here, in another tab, or on another device.
 */
export function usePreferences(): { prefs: Preferences; ready: boolean } {
    const [state, setState] = useState<{ prefs: Preferences; ready: boolean }>({ prefs: {}, ready: false });
    useEffect(() => {
        startSync();
        const sync = () => setState({ prefs: readPreferences(), ready: true });
        sync();
        return subscribePreferences(sync);
    }, []);
    return state;
}
